    import { SyncEngine } from "../services/SyncEngine";
    import { ISyncAdapter, QualityLevel } from "./ISyncAdapter";

    export class SoloSyncAdapter implements ISyncAdapter {
        constructor(
            private readonly engine: SyncEngine,
            private readonly streamUrl: string
        ) {}

        attachVideo(video: HTMLVideoElement) {
            this.engine.attachElement({
                element: video,
                streamUrl: this.streamUrl
            });
        }

        detachVideo() {
            this.engine.detachElement();
        }

        play() {
            return this.engine.play();
        }

        pause() {
            return this.engine.pause();
        }

        seek(seconds: number) {
            this.engine.seek(seconds);
        }

        dispose() {
            this.engine.dispose();
        }

        getQualityLevels(): QualityLevel[] {
            return this.engine.getQualityLevels();
        }

        getCurrentQualityIndex(): number {
            return this.engine.getCurrentQualityIndex();
        }

        setQualityLevel(level: number): void {
            this.engine.setQualityLevel(level);
        }

        getCurrentTime(): number {
            return this.engine.getCurrentTime();
        }
    }