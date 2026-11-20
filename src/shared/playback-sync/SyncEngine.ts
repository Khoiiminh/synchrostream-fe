import { updatePlaybackSnapshot } from "@/shared/playback-sync/playbackSlice";
import { Store } from "@reduxjs/toolkit";
import Hls from "hls.js";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("SyncEngine");

interface QualityLevel {
    index: number;
    height: number;
    bitrate: number;
    name: string;
}

export class SyncEngine {
    private videoElement: HTMLVideoElement | null = null;
    private hlsInstance: Hls | null = null;
    private store!: Store;
    private unsubscribeListeners: (() => void)[] = [];

    // Keep track of the active play promise to prevent lifecycle crashes
    private playPromise: Promise<void> | null = null;

    // Core check guarding against interacting with an unparsed HLS manifest
    private isManifestReady = false;

    // play() calls made before the manifest was parsed (e.g. the room snapshot
    // right after a page reload) wait here instead of failing.
    private manifestWaiters: {
        resolve: () => void;
        reject: (error: Error) => void;
    }[] = [];

    constructor(store: Store) {
        this.store = store;
    }

    /**
     * Initializes player and mounts HLS streaming if needed
     */
    public attachElement(p: {
        element: HTMLVideoElement;
        streamUrl: string;
    }): void {
        this.videoElement = p.element;

        if (Hls.isSupported()) {
            this.hlsInstance = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
            });
            this.hlsInstance.loadSource(p.streamUrl);
            this.hlsInstance.attachMedia(p.element);

            // Wait for HLS to parse the manifest fragments before setting up sync handlers
            this.hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                this.isManifestReady = true;
                this.setupListeners();
                this.emitSnapshot();
                this.settleManifestWaiters(null);
            });

            // Diagnostics listeners to log stream source retrieval problems
            this.hlsInstance.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal) {
                    log.error(
                        `Fatal HLS Engine error: ${data.type} - ${data.details}`,
                    );
                }
            });
        } else if (p.element.canPlayType("application/vnd.apple.mpegurl")) {
            // Native Safari fallback
            p.element.src = p.streamUrl;

            const onMetadata = () => {
                this.isManifestReady = true;
                this.setupListeners();
                this.emitSnapshot();
                this.settleManifestWaiters(null);
                p.element.removeEventListener("loadedmetadata", onMetadata);
            };

            p.element.addEventListener("loadedmetadata", onMetadata);
        }
    }

    public getQualityLevels(): QualityLevel[] {
        if (!this.hlsInstance) return [];

        return this.hlsInstance.levels.map((level, idx) => ({
            index: idx,
            height: level.height,
            bitrate: level.bitrate,
            name: level.name || `${level.height}p`,
        }));
    }

    public getCurrentQualityIndex(): number {
        if (!this.hlsInstance) return -1;

        return this.hlsInstance.currentLevel;
    }

    public setQualityLevel(levelIndex: number): void {
        if (this.hlsInstance) {
            this.hlsInstance.currentLevel = levelIndex;
        }
    }

    public detachElement(): void {
        log.debug("Detaching video element", {
            currentTime: this.videoElement?.currentTime,
            paused: this.videoElement?.paused,
            readyState: this.videoElement?.readyState,
            src: this.videoElement?.currentSrc,
        });

        this.unsubscribeListeners.forEach((cleanup) => cleanup());
        this.unsubscribeListeners = [];

        if (this.videoElement) {
            this.videoElement.pause();
            this.videoElement.removeAttribute("src");
            this.videoElement.load();
        }

        if (this.hlsInstance) {
            this.hlsInstance.destroy();
            this.hlsInstance = null;
        }

        this.videoElement = null;

        this.playPromise = null; // Clean up memory reference
        this.isManifestReady = false;
        this.settleManifestWaiters(
            new Error("[SyncEngine] Video element was detached"),
        );
    }

    private settleManifestWaiters(error: Error | null): void {
        const waiters = this.manifestWaiters;
        this.manifestWaiters = [];
        for (const waiter of waiters) {
            if (error) waiter.reject(error);
            else waiter.resolve();
        }
    }

    /** Resolves once the stream manifest is parsed and play() can start. */
    private waitForManifestReady(timeoutMs = 20_000): Promise<void> {
        if (this.isManifestReady) return Promise.resolve();

        return new Promise<void>((resolve, reject) => {
            const waiter = {
                resolve: () => {
                    clearTimeout(timeout);
                    resolve();
                },
                reject: (error: Error) => {
                    clearTimeout(timeout);
                    reject(error);
                },
            };
            const timeout = setTimeout(() => {
                this.manifestWaiters = this.manifestWaiters.filter(
                    (w) => w !== waiter,
                );
                reject(
                    new Error(
                        "[SyncEngine] PLAY rejected: HLS manifest was not ready in time",
                    ),
                );
            }, timeoutMs);
            this.manifestWaiters.push(waiter);
        });
    }

    public async play(): Promise<void> {
        if (!this.videoElement) {
            throw new Error(
                "[SyncEngine] PLAY rejected: video element is not attached",
            );
        }

        const video = this.videoElement;

        if (!this.isManifestReady) {
            log.debug("PLAY waiting for the HLS manifest");
            await this.waitForManifestReady();
            if (this.videoElement !== video) {
                throw new Error(
                    "[SyncEngine] PLAY rejected: video element changed while loading",
                );
            }
        }

        if (this.playPromise) {
            return this.playPromise;
        }

        log.debug("PLAY requested", {
            currentTime: video.currentTime,
            paused: video.paused,
            readyState: video.readyState,
        });

        this.playPromise = video
            .play()
            .then(() => {
                if (this.videoElement === video) {
                    this.emitSnapshot();

                    log.debug("PLAY completed", {
                        currentTime: video.currentTime,
                        paused: video.paused,
                        isPlaying: !video.paused,
                    });
                }
            })
            .catch((error) => {
                log.error("PLAY failed", {
                    error,
                    name:
                        error instanceof DOMException ? error.name : undefined,
                    message:
                        error instanceof Error ? error.message : String(error),
                    currentTime: video.currentTime,
                    paused: video.paused,
                    readyState: video.readyState,
                });

                throw error;
            })
            .finally(() => {
                this.playPromise = null;
            });

        return this.playPromise;
    }

    public async pause(): Promise<void> {
        if (!this.videoElement) {
            log.warn("Cannot PAUSE: video element is not attached");
            return;
        }

        log.debug("PAUSE", {
            currentTime: this.videoElement.currentTime,
            paused: this.videoElement.paused,
        });

        this.videoElement.pause();
        // Immediately project the actual DOM state into Redux.
        this.emitSnapshot();

        log.debug("PAUSE completed", {
            currentTime: this.videoElement.currentTime,
            paused: this.videoElement.paused,
        });
    }

    public seek(seconds: number): void {
        if (!this.videoElement) {
            log.warn("Cannot SEEK: video element is not attached");
            return;
        }

        const target = Math.max(0, seconds);

        log.debug("SEEK", {
            from: this.videoElement.currentTime,
            to: target,
        });

        this.videoElement.currentTime = target;
        // Immediately project the actual DOM state into Redux.
        this.emitSnapshot();
    }

    public waitForSeekCompletion(): Promise<void> {
        const video = this.videoElement;

        if (!video || !video.seeking) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve, reject) => {
            const timeoutMs = 5000;

            const cleanup = (): void => {
                video.removeEventListener("seeked", handleSeeked);
                video.removeEventListener("emptied", handleEmptied);
                clearTimeout(timeout);
            };

            const handleSeeked = (): void => {
                cleanup();
                resolve();
            };

            const handleEmptied = (): void => {
                cleanup();
                reject(
                    new Error(
                        "[SyncEngine] Video was emptied before seeking completed.",
                    ),
                );
            };

            const timeout = setTimeout(() => {
                cleanup();
                reject(
                    new Error(
                        "[SyncEngine] Timed out waiting for the video seek to complete.",
                    ),
                );
            }, timeoutMs);

            video.addEventListener("seeked", handleSeeked);
            video.addEventListener("emptied", handleEmptied);

            // Check again in case seeking finished while listeners were being set up.
            if (!video.seeking) {
                cleanup();
                resolve();
            }
        });
    }

    private setupListeners(): void {
        if (!this.videoElement) return;

        const el = this.videoElement;

        const handler = () => this.emitSnapshot();

        el.addEventListener("timeupdate", handler);
        el.addEventListener("play", handler);
        el.addEventListener("pause", handler);
        el.addEventListener("waiting", handler);
        el.addEventListener("playing", handler);

        this.unsubscribeListeners.push(() => {
            el.removeEventListener("timeupdate", handler);
            el.removeEventListener("play", handler);
            el.removeEventListener("pause", handler);
            el.removeEventListener("waiting", handler);
            el.removeEventListener("playing", handler);
        });
    }

    private emitSnapshot(): void {
        if (!this.videoElement) return;

        this.store.dispatch(
            updatePlaybackSnapshot({
                currentTime: this.videoElement.currentTime,
                isPlaying: !this.videoElement.paused,
                playbackRate: this.videoElement.playbackRate,
                driftMs: 0, // Will handle sync clock drift calculations later during Watch Party,
            }),
        );
    }

    public getCurrentTime(): number {
        return this.videoElement?.currentTime ?? 0;
    }

    /**
     * True when a corrective seek is reasonable: an element is attached, not
     * already seeking, and has data beyond the current position
     * (HAVE_FUTURE_DATA). False while rebuffering.
     */
    public isReadyForCorrection(): boolean {
        const video = this.videoElement;
        if (!video || video.seeking) return false;
        return video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
    }

    /** Actual paused state of the attached element (true when none is attached). */
    public isPaused(): boolean {
        return this.videoElement?.paused ?? true;
    }

    public dispose(): void {
        this.detachElement();
    }
}
