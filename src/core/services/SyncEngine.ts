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
        this.unsubscribeListeners.forEach((cleanup) => cleanup());
        this.unsubscribeListeners = [];

        if (this.hlsInstance) {
            this.hlsInstance.destroy();
            this.hlsInstance = null;
        }

        if (this.videoElement) {
            this.videoElement.src = '';
            this.videoElement = null;
        }

        this.playPromise = null;    // Clean up memory reference
        this.isManifestReady = false;
    }

    public async play(): Promise<void> {
        if (!this.videoElement || !this.isManifestReady) return;

        try {
            this.playPromise = this.videoElement.play();
            await this.playPromise;
        } catch (error) {
            // Suppress standard abort errors from overlapping engine events
            if (error instanceof DOMException && error.name === 'AbortError') {
                console.warn('Playback play() was safely intercepted by an intentional pause sequence.');
            } else {
                console.error('Core media playback failure:', error);
            }
        } finally {
            this.playPromise = null;
        }
    }

    public async pause(): Promise<void> {
        if (!this.videoElement) return;

        this.videoElement.pause();
    }

    public seek(seconds: number): void {
        if (this.videoElement) {
            this.videoElement.currentTime = seconds;
        }
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

    public dispose(): void {
        this.detachElement();
    }
}