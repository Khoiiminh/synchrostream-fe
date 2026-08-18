import { SyncEngine } from "../services/SyncEngine";
import { WatchPartyGatewayEngine } from "../services/WatchPartyGatewayEngine";
import { ISyncAdapter, QualityLevel } from "./ISyncAdapter";
import { PlaybackCoordinator } from "./PlaybackCoordinator";

export class PartySyncAdapter implements ISyncAdapter {
    private readonly coordinator: PlaybackCoordinator;
    
    constructor(
        private readonly localEngine: SyncEngine,
        private readonly gateway: WatchPartyGatewayEngine,
        private readonly streamUrl: string,
        private readonly roomId: string,
        private readonly roomCode: string,
        private readonly userId: string
    ) {
        this.coordinator = new PlaybackCoordinator(this.localEngine, this.gateway);
    }

    attachVideo(video: HTMLVideoElement): void {
        this.localEngine.attachElement({
            element: video,
            streamUrl: this.streamUrl
        });

        this.coordinator.start();
    }
    
    detachVideo(): void {
        this.coordinator.stop();

        this.localEngine.detachElement();
    }

    async play(): Promise<void> {
        const playhead = this.localEngine.getCurrentTime();

        console.log("[PartySyncAdapter] PLAY requested", {
            roomId: this.roomId,
            roomCode: this.roomCode,
            userId: this.userId,
            playhead,
        });

        this.gateway.emitPlaybackPulse({
            roomId: this.roomId,
            roomCode: this.roomCode,
            userId: this.userId,
            action: "PLAY",
            playhead: this.localEngine.getCurrentTime()
        });
    }

    async pause(): Promise<void> {
        const playhead = this.localEngine.getCurrentTime();

        console.log("[PartySyncAdapter] PAUSE requested", {
            roomId: this.roomId,
            roomCode: this.roomCode,
            userId: this.userId,
            playhead,
        });

        this.gateway.emitPlaybackPulse({
            roomId: this.roomId,
            roomCode: this.roomCode,
            userId: this.userId,
            action: "PAUSE",
            playhead:  this.localEngine.getCurrentTime()
        });
    }

    seek(seconds: number): void {
        console.log("[PartySyncAdapter] SEEK requested", {
            roomId: this.roomId,
            roomCode: this.roomCode,
            userId: this.userId,
            playhead: seconds,
        });

        this.gateway.emitPlaybackPulse({
            roomId: this.roomId,
            roomCode: this.roomCode,
            userId: this.userId,
            action: "SEEK",
            playhead: seconds
        });
    }

    dispose(): void {
        this.coordinator.dispose();
        
        this.localEngine.dispose();
    }

    getQualityLevels(): QualityLevel[] {
        return this.localEngine.getQualityLevels();
    }

    getCurrentQualityIndex(): number {
        return this.localEngine.getCurrentQualityIndex();
    }

    setQualityLevel(level: number): void {
        this.localEngine.setQualityLevel(level);
    }

    getCurrentTime(): number {
        return this.localEngine.getCurrentTime();
    }
}