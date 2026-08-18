import { SyncEngine } from "../services/SyncEngine";
import { WatchPartyGatewayEngine } from "../services/WatchPartyGatewayEngine";

type RemotePlaybackAction = "PLAY" | "PAUSE" | "SEEK";

interface RemotePlaybackPayload {
    action: RemotePlaybackAction;
    playhead: number;
    originatorId: string;
    serverExecutionTime: number;
}

export class PlaybackCoordinator {
    private unsubscribe: (() =>  void) | null = null;

    /**
     * Maximum drift that we tolerate without correcting playback.
     *
     * Example:
     * local = 100.00s
     * remote = 100.25s
     * drift = 0.25s
     *
     * We consider this small enough to leave alone.
     */
    private readonly driftToleranceSeconds = 0.25;

    constructor(
        private readonly engine: SyncEngine,
        private readonly gateway: WatchPartyGatewayEngine,
    ) {}

    start() {
        if (this.unsubscribe) return;

        console.log("[PlaybackCoordinator] Starting");

        this.unsubscribe = this.gateway.onPlaybackSync((payload: RemotePlaybackPayload) => {
            console.log(
                "[PlaybackCoordinator] Remote playback received",
                {
                    action: payload.action,
                    playhead: payload.playhead,
                    originatorId: payload.originatorId,
                    serverExecutionTime: payload.serverExecutionTime,
                }
            );

            this.handleRemotePlayback(payload);
        });
    }

    stop() {
        this.unsubscribe?.();
        this.unsubscribe = null;

        console.log("[PlaybackCoordinator] Stopped");
    }

    dispose(): void {
        this.stop();
    }

    private handleRemotePlayback(
        payload: RemotePlaybackPayload
    ): void {
        console.log(
            "[PlaybackCoordinator] Handling remote action",
            payload.action
        );

        const { action } = payload;

        switch(action) {
            case "PLAY":
                this.handleRemotePlay(payload);
                break;
            case "PAUSE":
                this.handleRemotePause(payload);
                break;
            case "SEEK":
                this.handleRemoteSeek(payload);
                break;
        }
    }

    private handleRemotePlay(payload: RemotePlaybackPayload): void {
        const targetPlayhead = this.calculateTargetPlayhead(payload);

        console.log("[PlaybackCoordinator] Remote PLAY", {
            receivedPlayhead: payload.playhead,
            targetPlayhead,
            localPlayhead: this.engine.getCurrentTime(),
        });

        this.correctDrift(targetPlayhead);
        void this.engine.play();
    }

    private handleRemotePause(payload: RemotePlaybackPayload): void {
        const targetPlayhead = this.calculateTargetPlayhead(payload);

        console.log("[PlaybackCoordinator] Remote PAUSE", {
            receivedPlayhead: payload.playhead,
            targetPlayhead,
            localPlayhead: this.engine.getCurrentTime(),
        });

        this.correctDrift(targetPlayhead); 
        void this.engine.pause();
    }

    private handleRemoteSeek(payload: RemotePlaybackPayload): void {
        const targetPlayhead = this.calculateTargetPlayhead(payload);
        const localPlayhead = this.engine.getCurrentTime();

        console.log("[PlaybackCoordinator] Remote SEEK", {
            receivedPlayhead: payload.playhead,
            targetPlayhead,
            localPlayhead,
            drift: targetPlayhead - localPlayhead,
        });

        this.engine.seek(targetPlayhead);
    }

    /**
     * Calculates where playback should be at the current moment.
     *
     * For PLAY:
     *
     * serverExecutionTime = when server processed PLAY
     * playhead             = playback position at that moment
     *
     * Therefore:
     *
     * target = playhead + elapsed time
     */
    private calculateTargetPlayhead(payload: RemotePlaybackPayload): number {
        if ( payload.action !== "PLAY" ) return payload.playhead;

        const elapsedSeconds = (Date.now() - payload.serverExecutionTime) / 1000;

        const targetPlayhead = Math.max(0, payload.playhead + elapsedSeconds,);

        console.log("[PlaybackCoordinator] Target playhead calculated", {
            originalPlayhead: payload.playhead,
            elapsedSeconds,
            targetPlayhead,
        });

        return targetPlayhead;
    }

    /**
     * Correct local playback only when the difference is meaningful.
     */
    private correctDrift(targetPlayhead: number): void {
        const localPlayhead = this.engine.getCurrentTime();

        const drift = targetPlayhead - localPlayhead;

        console.log("[PlaybackCoordinator] Drift check", {
            localPlayhead,
            targetPlayhead,
            drift,
            tolerance: this.driftToleranceSeconds,
        });

        if (Math.abs(drift) <= this.driftToleranceSeconds) {
            console.log(
                "[PlaybackCoordinator] Drift within tolerance — no correction"
            );

            return;
        }

        console.log(
            "[PlaybackCoordinator] Drift exceeds tolerance — correcting",
            {
                from: localPlayhead,
                to: targetPlayhead,
                drift,
            }
        );

        this.engine.seek(targetPlayhead);
    }
}