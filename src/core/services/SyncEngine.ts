import { updatePlaybackSnapshot } from '@/store/slices/playbackSlice';
import { Store } from '@reduxjs/toolkit';
import Hls from 'hls.js';

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

    constructor(store: Store) {
        this.store = store;
    }

    /**
     * Initializes player and mounts HLS streaming if needed
     */
    public attachElement(p: {element: HTMLVideoElement, streamUrl: string}): void {
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
            });

            // Diagnostics listeners to log stream source retrieval problems
            this.hlsInstance.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal) {
                    console.error(`Fatal HLS Engine error: ${data.type} - ${data.details}`);
                }
            });

        } else if (p.element.canPlayType('application/vnd.apple.mpegurl')) {
            // Native Safari fallback
            p.element.src = p.streamUrl;

            const onMetadata = () => {
                this.isManifestReady = true;
                this.setupListeners();
                this.emitSnapshot();
                p.element.removeEventListener('loadedmetadata', onMetadata);
            };

            p.element.addEventListener('loadedmetadata', onMetadata);
        }
    }

    public getQualityLevels(): QualityLevel[] {
        if (!this.hlsInstance) return [];

        return this.hlsInstance.levels.map((level, idx) => ({
            index: idx,
            height: level.height,
            bitrate: level.bitrate,
            name: level.name || `${level.height}p`
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
        console.trace("[SyncEngine] DETACHING VIDEO ELEMENT", {
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

        this.playPromise = null;    // Clean up memory reference
        this.isManifestReady = false;
    }

    public async play(): Promise<void> {
        if (!this.videoElement) {
            throw new Error(
                "[SyncEngine] PLAY rejected: video element is not attached"
            );
        }

        if (!this.isManifestReady) {
            throw new Error(
                "[SyncEngine] PLAY rejected: HLS manifest is not ready"
            );
        }

        if (this.playPromise) {
            return this.playPromise;
        }

        const video = this.videoElement;

        console.log("[SyncEngine] PLAY requested", {
            currentTime: video.currentTime,
            paused: video.paused,
            readyState: video.readyState,
        });

        this.playPromise = video.play()
            .then(() => {
                if (this.videoElement === video) {
                    this.emitSnapshot();

                    console.log("[SyncEngine] PLAY completed", {
                        currentTime: video.currentTime,
                        paused: video.paused,
                        isPlaying: !video.paused,
                    });
                }
            })
            .catch((error) => {
                console.error("[SyncEngine] PLAY failed", {
                    error,
                    name:
                        error instanceof DOMException
                            ? error.name
                            : undefined,
                    message:
                        error instanceof Error
                            ? error.message
                            : String(error),
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
            console.warn("[SyncEngine] Cannot PAUSE: video element is not attached");
            return;
        }

        console.log("[SyncEngine] PAUSE", {
            currentTime: this.videoElement.currentTime,
            paused: this.videoElement.paused,
        });

        this.videoElement.pause();
        // Immediately project the actual DOM state into Redux.
        this.emitSnapshot();

        console.log("[SyncEngine] PAUSE completed", {
            currentTime: this.videoElement.currentTime,
            paused: this.videoElement.paused,
        });
    }

    public seek(seconds: number): void {
        if (!this.videoElement) {
            console.warn("[SyncEngine] Cannot SEEK: video element is not attached");
            return;
        }

        const target = Math.max(0, seconds);

        console.log("[SyncEngine] SEEK", {
            from: this.videoElement.currentTime,
            to: target,
        });

        this.videoElement.currentTime = target;
        // Immediately project the actual DOM state into Redux.
        this.emitSnapshot();
    }

    private setupListeners(): void {
        if (!this.videoElement) return;

        const el = this.videoElement;

        const handler = () => this.emitSnapshot();

        el.addEventListener('timeupdate', handler);
        el.addEventListener('play', handler);
        el.addEventListener('pause', handler);
        el.addEventListener('waiting', handler);
        el.addEventListener('playing', handler);

        this.unsubscribeListeners.push(() => {
            el.removeEventListener('timeupdate', handler);
            el.removeEventListener('play', handler);
            el.removeEventListener('pause', handler);
            el.removeEventListener('waiting', handler);
            el.removeEventListener('playing', handler);
        });
    }

    private emitSnapshot(): void {
        if (!this.videoElement) return;

        this.store.dispatch(
            updatePlaybackSnapshot({
                currentTime: this.videoElement.currentTime,
                isPlaying: !this.videoElement.paused,
                playbackRate: this.videoElement.playbackRate,
                driftMs: 0 // Will handle sync clock drift calculations later during Watch Party,
            })
        );
    }

    public getCurrentTime(): number {
        return this.videoElement?.currentTime ?? 0;
    }

    public dispose(): void {
        this.detachElement();
    }
}