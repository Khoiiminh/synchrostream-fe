import { RemotePlaybackGuard } from "../services/RemotePlaybackGuard";
import { SyncEngine } from "../services/SyncEngine";
import { WatchPartyGatewayEngine } from "../services/WatchPartyGatewayEngine";
import { SyncMetrics } from "./SyncMetrics";

type RemotePlaybackAction = "PLAY" | "PAUSE" | "SEEK";

interface RemotePlaybackPayload {
    action: RemotePlaybackAction;
    playhead: number;
    originatorId: string;
    serverExecutionTime: number;
}

type ExpectedPlaybackState = "PLAYING" | "PAUSED";

export class PlaybackCoordinator {
    private unsubscribe: (() =>  void) | null = null;
    private disposed = false;
    private playbackCommandVersion = 0;
    private isReconcilingPlayback = false;

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

    /**
     * Frequency at which synchronization measurements are collected.
     *
     * 500 ms gives us enough observations for statistical analysis
     * without producing an excessive number of samples.
     */
    private readonly metricsIntervalMs = 500;

    /**
     * Timer used only for performance measurements
     */
    private metricsInterval: ReturnType<typeof setInterval> | null = null;

    /**
     * The latest playback state received from the synchronization source
     */
    private expectedPlaybackState: ExpectedPlaybackState = "PAUSED";

    /**
     * Playhead at the server execution time of the latest synchronization event
     */
    private expectedPlayheadSeconds = 0;

    /**
     * Server timestamp associated with expectedPlayheadSeconds.
     * 
     * For PLAY, playback advances from this timestamp.
     * For PAUSE and SEEK, the playhead remains fixed.
     */
    private expectedPlayheadTimestamp = 0;

    constructor(
        private readonly engine: SyncEngine,
        private readonly gateway: WatchPartyGatewayEngine,
        private readonly localUserId: string,
        private readonly remotePlaybackGuard: RemotePlaybackGuard,
        private readonly metrics: SyncMetrics,
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

        this.startMetricsCollection();
        console.log("[PlaybackCoordinator] Metrics collection started", {
            intervalMs: this.metricsIntervalMs,
            participantId: this.localUserId,
        });
    }

    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;

        this.stopMetricsCollection();

        console.log("[PlaybackCoordinator] Stopped");
    }

    dispose(): void {
        this.disposed = true;
        this.stop();
    }

    private handleRemotePlayback(payload: RemotePlaybackPayload): void {
        this.playbackCommandVersion = this.playbackCommandVersion + 1;

        /**
         * Every participant uses the server broadcast to establish the expected playback state.
         * 
         * This is required for synchronization metrics, including on the room owner.
         */
        this.updateExpectedPlaybackState(payload);

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

        switch (payload.action) {
            case "PLAY":
                break;

            case "PAUSE":
                this.remotePlaybackGuard.run(() => {
                    void this.engine.pause().catch((error) => {
                        console.error(
                            "[PlaybackCoordinator] Immediate PAUSE failed",
                            error
                        );
                    });
                });
                break;

            case "SEEK":
                this.remotePlaybackGuard.run(() => {
                    this.engine.seek(payload.playhead);
                });
                break;
        }

        void this.reconcilePlaybackCommands();
    }

    // private async handleRemotePlay(payload: RemotePlaybackPayload, commandVersion: number): Promise<void> {
    //     console.log("[PlaybackCoordinator] Remote PLAY", {
    //         receivedPlayhead: payload.playhead,
    //         localPlayhead: this.engine.getCurrentTime(),
    //         serverExecutionTime: payload.serverExecutionTime,
    //     });

    //     try {
    //         await this.remotePlaybackGuard.runAsync(async () => {
    //             if (this.disposed) return;

    //             await this.engine.play();

    //             if (this.disposed) return;

    //             /**
    //              * A newer playback command version arrived while the PLAY
    //              * operation was waiting for local playback to start.
    //              */
    //             if (commandVersion !== this.playbackCommandVersion) {
    //                 console.log(
    //                     "[PlaybackCoordinator] Stale PLAY detected; reconciling latest state",
    //                     {
    //                         commandVersion,
    //                         latestCommandVersion: this.playbackCommandVersion,
    //                     }
    //                 );

    //                 return;
    //             }

    //             const targetPlayhead = this.calculateTargetPlayhead(payload);

    //             this.correctDrift(targetPlayhead);
    //         });

    //         if (!this.disposed) {
    //             console.log(
    //                 "[PlaybackCoordinator] Local playback started"
    //             );
    //         }

    //     } catch (error) {
    //         console.error(
    //             "[PlaybackCoordinator] Failed to start local playback",
    //             error
    //         );
    //     }
    // }

    // private async handleRemotePause(payload: RemotePlaybackPayload, commandVersion: number): Promise<void> {
    //     console.log("[PlaybackCoordinator] Remote PAUSE", {
    //         receivedPlayhead: payload.playhead,
    //         localPlayhead: this.engine.getCurrentTime(),
    //     });

    //     try {
    //         await this.remotePlaybackGuard.runAsync(async () => {
    //             if (this.disposed) return;

    //             if (commandVersion !== this.playbackCommandVersion) {
    //                 console.log(
    //                     "[PlaybackCoordinator] Ignoring stale PAUSE",
    //                     {
    //                         commandVersion,
    //                         lastestCommandVersion: this.playbackCommandVersion,
    //                     }
    //                 );

    //                 return;
    //             }
                
    //             const targetPlayhead = this.calculateTargetPlayhead(payload);

    //             this.correctDrift(targetPlayhead);

    //             await this.engine.pause();

    //             if (commandVersion !== this.playbackCommandVersion) {
    //                 console.log(
    //                     "[PlaybackCoordinator] PAUSE completed after a newer command arrived",
    //                     {
    //                         commandVersion,
    //                         latestCommandVersion: this.playbackCommandVersion,
    //                     }
    //                 );

    //                 return;
    //             }
    //         });
    //     } catch (error) {
    //         console.error(
    //             "[PlaybackCoordinator] Failed to pause local playback",
    //             error
    //         );
    //     }
    // }

    // private handleRemoteSeek(payload: RemotePlaybackPayload, commandVersion: number): void {
    //     if (this.disposed) {
    //         return;
    //     }

    //     if (commandVersion !== this.playbackCommandVersion) {
    //         console.log(
    //             "[PlaybackCoordinator] Ignoring stale SEEK",
    //             {
    //                 commandVersion,
    //                 latestCommandVersion: this.playbackCommandVersion,
    //             }
    //         );

    //         return;
    //     }
    //     const targetPlayhead = payload.playhead;
    //     const localPlayhead = this.engine.getCurrentTime();

    //     console.log("[PlaybackCoordinator] Remote SEEK", {
    //         receivedPlayhead: payload.playhead,
    //         targetPlayhead,
    //         localPlayhead,
    //         drift: targetPlayhead - localPlayhead,
    //     });

    //     this.remotePlaybackGuard.run(() => this.engine.seek(targetPlayhead));
    // }

    private updateExpectedPlaybackState(payload: RemotePlaybackPayload): void {
        this.expectedPlayheadSeconds = payload.playhead;
        this.expectedPlayheadTimestamp = payload.serverExecutionTime;

        switch (payload.action) {
            case "PLAY":
                this.expectedPlaybackState = 'PLAYING';
                break;
            
            case "PAUSE":
                this.expectedPlaybackState = 'PAUSED';
                break;
            case "SEEK":
                // Preserve the current playback state
                break;
        }
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

        const elapsedSeconds = Math.max(
            0, 
            (Date.now() - payload.serverExecutionTime) / 1000
        );

        const targetPlayhead = Math.max(
            0, 
            payload.playhead + elapsedSeconds,
        );

        console.log("[PlaybackCoordinator] Target playhead calculated", {
            originalPlayhead: payload.playhead,
            elapsedSeconds,
            targetPlayhead,
        });

        return targetPlayhead;
    }

    /**
     * Calculates the expected playhead for the current local time
     */
    private calculateExpectedPlaybackPosition(): number {
        if (this.expectedPlaybackState !== 'PLAYING') {
            return this.expectedPlayheadSeconds;
        }

        const elapsedSeconds = Math.max(
            0, 
            (Date.now() - this.expectedPlayheadTimestamp) / 1000,
        );

        return Math.max(
            0,
            this.expectedPlayheadSeconds + elapsedSeconds
        );
    }

    /**
     * Collects continuous synchronization measurements;
     */
    private collectPlaybackDriftSample(): void{
        if (this.disposed) return;

        console.log("[PlaybackCoordinator] Metrics sample tick", {
            expectedPlayheadTimestamp: this.expectedPlayheadTimestamp,
            expectedPlaybackState: this.expectedPlaybackState,
            actualPositionSeconds: this.engine.getCurrentTime(),
        });

        /**
         * We cannot calculate meaningful synchronization drift
         * until at least one remote synchronization event has
         * established an expected playback position.
         */
        if (this.expectedPlayheadTimestamp === 0) return;

        const actualPositionSeconds = this.engine.getCurrentTime();
        const expectedPositionSeconds = this.calculateExpectedPlaybackPosition();
        const driftSeconds = expectedPositionSeconds - actualPositionSeconds;

        const driftMs = Math.abs(driftSeconds) * 1000;

        this.metrics.recordPlaybackDrift({
            timestamp: Date.now(),
            participantId: this.localUserId,
            actualPositionSeconds,
            expectedPositionSeconds,
            driftMs,
            playbackState: this.expectedPlaybackState,
        });
    }

    private async reconcilePlaybackCommands(): Promise<void> {
        if (this.disposed || this.isReconcilingPlayback) {
            return;
        }

        this.isReconcilingPlayback = true;

        try {
            while (!this.disposed) {
                const commandVersion = this.playbackCommandVersion;
                const expectedState = this.expectedPlaybackState;

                try {
                    if (expectedState === "PLAYING") {
                        await this.remotePlaybackGuard.runAsync(async () => {
                            await this.engine.play();
                        });
                    } else {
                        await this.remotePlaybackGuard.runAsync(async () => {
                            await this.engine.pause();
                        });
                    }
                } catch (error) {
                    if (this.disposed) {
                        return;
                    }

                    // A newer command superseded this failed operation.
                    if (commandVersion !== this.playbackCommandVersion) {
                        continue;
                    }

                    console.error(
                        "[PlaybackCoordinator] Playback reconciliation failed",
                        {
                            expectedState,
                            commandVersion,
                            error,
                        }
                    );

                    return;
                }

                if (this.disposed) {
                    return;
                }

                // Never apply an old command's target position.
                if (commandVersion !== this.playbackCommandVersion) {
                    console.log(
                        "[PlaybackCoordinator] Command superseded during reconciliation",
                        {
                            commandVersion,
                            latestCommandVersion: this.playbackCommandVersion,
                        }
                    );

                    continue;
                }

                // Calculate the target from the latest expected timeline.
                const targetPlayhead = this.calculateExpectedPlaybackPosition();

                try {
                    await this.correctDrift(targetPlayhead);
                } catch (error) {
                    if (this.disposed) {
                        return;
                    }

                    if (commandVersion !== this.playbackCommandVersion) {
                        continue;
                    }

                    console.error(
                        "[PlaybackCoordinator] Failed to complete playback seek",
                        {
                            commandVersion,
                            targetPlayhead,
                            error,
                        }
                    );

                    return;
                }

                if (this.disposed) {
                    return;
                }

                if (commandVersion !== this.playbackCommandVersion) {
                    continue;
                }

                return;
            }
        } finally {
            this.isReconcilingPlayback = false;
        }
    }

    private startMetricsCollection(): void {
        if (this.metricsInterval) return;

        this.metricsInterval = setInterval(
            () => this.collectPlaybackDriftSample(),
            this.metricsIntervalMs,
        );
    }

    private stopMetricsCollection(): void {
        if (!this.metricsInterval) return;

        clearInterval(this.metricsInterval);
        this.metricsInterval = null;
    }

    /**
     * Correct local playback only when the difference is meaningful.
     */
    private async correctDrift(targetPlayhead: number): Promise<void> {
        const localPlayhead = this.engine.getCurrentTime();

        const drift = targetPlayhead - localPlayhead;

        console.log("[PlaybackCoordinator] Drift check", {
            localPlayhead,
            targetPlayhead,
            drift,
            tolerance: this.driftToleranceSeconds,
        });

        if (Math.abs(drift) > this.driftToleranceSeconds) {
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

        // Wait even when drift is within tolerance: an earlier seek
        // may still be in progress.
        await this.engine.waitForSeekCompletion();
    }

    private isRemoteEvent(payload: RemotePlaybackPayload): boolean {
        return payload.originatorId !== this.localUserId;
    }
}