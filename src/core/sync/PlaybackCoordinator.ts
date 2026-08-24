import { RemotePlaybackGuard } from "../services/RemotePlaybackGuard";
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
    private disposed = false;

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
        private readonly localUserId: string,
        private readonly remotePlaybackGuard: RemotePlaybackGuard,
    ) {}

    start(): void {
        if (this.disposed) {
            throw new Error(
                "[PlaybackCoordinator] Cannot start a disposed coordinator"
            );
        }
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

    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;

        console.log("[PlaybackCoordinator] Stopped");
    }

    dispose(): void {
        this.disposed = true;
        this.stop();
    }

    private handleRemotePlayback(
        payload: RemotePlaybackPayload
    ): void {

        /**
         * Avoid self-originated events
         */
        if (!this.isRemoteEvent(payload)) {
            console.log(
                "[PlaybackCoordinator] Ignoring self-originated playback",
                {
                    action: payload.action,
                    originatorId: payload.originatorId,
                }
            );

            return;
        }

        console.log(
            "[PlaybackCoordinator] Handling remote action",
            payload.action
        );

        const { action } = payload;

        switch(action) {
            case "PLAY":
                void this.handleRemotePlay(payload);
                break;
            case "PAUSE":
                void this.handleRemotePause(payload);
                break;
            case "SEEK":
                this.handleRemoteSeek(payload);
                break;
        }
    }

    private async handleRemotePlay(payload: RemotePlaybackPayload): Promise<void> {
        console.log("[PlaybackCoordinator] Remote PLAY", {
            receivedPlayhead: payload.playhead,
            localPlayhead: this.engine.getCurrentTime(),
            serverExecutionTime: payload.serverExecutionTime,
        });

        try {
            await this.remotePlaybackGuard.runAsync(async () => {
                if (this.disposed) return;

                await this.engine.play();

                if (this.disposed) return;

                const targetPlayhead =
                    this.calculateTargetPlayhead(payload);

                this.correctDrift(targetPlayhead);
            });

            if (!this.disposed) {
                console.log(
                    "[PlaybackCoordinator] Local playback started"
                );
            }

        } catch (error) {
            console.error(
                "[PlaybackCoordinator] Failed to start local playback",
                error
            );
        }
    }

    private async handleRemotePause(payload: RemotePlaybackPayload): Promise<void> {
        console.log("[PlaybackCoordinator] Remote PAUSE", {
            receivedPlayhead: payload.playhead,
            localPlayhead: this.engine.getCurrentTime(),
        });

        try {
            await this.remotePlaybackGuard.runAsync(async () => {
                const targetPlayhead =
                    this.calculateTargetPlayhead(payload);

                this.correctDrift(targetPlayhead);

                await this.engine.pause();
            });
        } catch (error) {
            console.error(
                "[PlaybackCoordinator] Failed to pause local playback",
                error
            );
        }
    }

    private handleRemoteSeek(payload: RemotePlaybackPayload): void {
        const targetPlayhead = payload.playhead;
        const localPlayhead = this.engine.getCurrentTime();

        console.log("[PlaybackCoordinator] Remote SEEK", {
            receivedPlayhead: payload.playhead,
            targetPlayhead,
            localPlayhead,
            drift: targetPlayhead - localPlayhead,
        });

        this.remotePlaybackGuard.run(() => this.engine.seek(targetPlayhead));
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

        const elapsedSeconds = Math.max(0, (Date.now() - payload.serverExecutionTime) / 1000);

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
                "[PlaybackCoordinator] Drift within tolerance — no seek required"
            );

            return;
        }

        console.log(
            "[PlaybackCoordinator] Drift exceeds tolerance — seeking",
            {
                from: localPlayhead,
                to: targetPlayhead,
                drift,
            }
        );

        this.engine.seek(targetPlayhead);
    }

    private isRemoteEvent(payload: RemotePlaybackPayload): boolean {
        return payload.originatorId !== this.localUserId;
    }
}