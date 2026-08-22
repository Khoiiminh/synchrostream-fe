import { ISyncAdapter } from "./ISyncAdapter";

export class MediaSyncController {
    private attached = false;

    constructor(private adapter: ISyncAdapter) {}

    attach(video: HTMLVideoElement) {
        if (this.attached) {
            console.warn('MediaSyncController already attached');

            return;
        }

        this.adapter.attachVideo(video);
        this.attached = true;
    }

    async play() {
        if (!this.attached) {
            console.warn('Cannot play before attaching video');
            return;
        }

        await this.adapter.play();
    }

    async pause() {
        if (!this.attached) {
            return;
        }

        await this.adapter.pause();
    }

    seek(seconds: number) {
        if (!this.attached) return;

        this.adapter.seek(seconds);
    }

    dispose() {
        this.adapter.dispose();

        this.attached = false;
    }

    detach() {
        if (!this.attached) {
            return;
        }

        this.adapter.detachVideo();
        this.attached = false;
    }

    getQualityLevels() {
        return this.adapter.getQualityLevels();
    }

    setQualityLevel(level:number) {
        this.adapter.setQualityLevel(level);
    }

    getCurrentTime() {
        return this.adapter.getCurrentTime();
    }

    getCurrentQualityIndex() {
        return this.adapter.getCurrentQualityIndex();
    }
}