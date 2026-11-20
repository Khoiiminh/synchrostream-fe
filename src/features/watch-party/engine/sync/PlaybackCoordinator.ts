import { RemotePlaybackGuard } from "@/shared/playback-sync/RemotePlaybackGuard";
import { SyncEngine } from "@/shared/playback-sync/SyncEngine";
import { WatchPartyGatewayEngine } from "../WatchPartyGatewayEngine";
import { ClockSync } from "@/shared/playback-sync/ClockSync";
import { SyncEventType, SyncMetrics } from "@/shared/playback-sync/SyncMetrics";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("PlaybackCoordinator");

type RemotePlaybackAction = "PLAY" | "PAUSE" | "SEEK";

interface RemotePlaybackPayload {
    action: RemotePlaybackAction;
    playhead: number;
    originatorId: string;
    serverExecutionTime: number;
}

type ExpectedPlaybackState = "PLAYING" | "PAUSED";

/** What triggered a reconciliation (recorded on correction events). */
type ReconcileOrigin = "command" | "snapshot" | "periodic";

/** Playback part of the room snapshot (room:state_update), same meaning as a broadcast. */
export interface RoomPlaybackSnapshot {
    status: "PLAYING" | "PAUSED";
    /** Playhead at lastUpdated, seconds. */
    playhead: number;
    /** Server time of the last playback change. */
    lastUpdated: number;
}

export interface PlaybackCoordinatorOptions {
    /**
     * When true, playback control computes "now" on the estimated server
     * clock, the same clock serverExecutionTime is stamped with. When false,
     * the client's local clock is used (the original behaviour), which turns
     * any clock skew into playback offset. Switchable so both modes can be
     * measured.
     */
    clockCorrection: boolean;
    /**
     * When true, drift that develops between commands (stalls, background
     * tabs, slow devices, local seeks) is corrected by a periodic check.
     * When false, playback is only reconciled when a command or snapshot
     * arrives (the original behaviour).
     */
    periodicCorrection: boolean;
}

export class PlaybackCoordinator {
    private unsubscribe: (() => void) | null = null;
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
     * Right after a sync command the drift changes quickly, so sampling is
     * raised to 10 Hz for a short window to measure recovery time precisely.
     */
    private readonly burstSampleIntervalMs = 100;
    private readonly burstWindowMs = 3_000;
    private lastCommandLocalTime = 0;
    private lastSampleLocalTime = 0;

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
        private readonly clockSync: ClockSync | null = null,
        private readonly options: PlaybackCoordinatorOptions = {
            clockCorrection: true,
            periodicCorrection: true,
        },
    ) {}

    private get clockCorrectionEnabled(): boolean {
        return this.options.clockCorrection;
    }

    /** Clock used by playback control (target positions). */
    private controlNow(): number {
        return this.clockCorrectionEnabled ? this.serverNow() : Date.now();
    }

    /** Last command version whose reconciliation completed (for samples). */
    private appliedCommandVersion = 0;

    /** Local time at which each pending command version was received. */
    private readonly commandReceivedAt = new Map<
        number,
        {
            localTime: number;
            action: RemotePlaybackAction;
            origin: ReconcileOrigin;
        }
    >();

    /** Trigger of the reconciliation currently running or about to run. */
    private reconcileOrigin: ReconcileOrigin = "command";

    // ---- Periodic correction (drift that develops between commands) ----

    /** How often the periodic check runs. */
    private readonly periodicCheckIntervalMs = 1_000;
    /**
     * No periodic correction this soon after a command, snapshot, local
     * owner action or previous correction: those are still settling, and
     * the owner's own command has not come back from the server yet.
     */
    private readonly periodicGraceMs = 2_000;
    /** Consecutive out-of-tolerance checks required (ignores one-off noise). */
    private readonly periodicConsecutiveRequired = 2;
    /** Back-off after a failed reconciliation (e.g. autoplay blocked). */
    private readonly periodicFailureBackoffMs = 10_000;
    private periodicInterval: ReturnType<typeof setInterval> | null = null;
    private lastControlActivity = 0;
    private lastReconcileFailureAt = 0;
    private outOfToleranceCount = 0;

    private unsubscribeSnapshot: (() => void) | null = null;

    /**
     * Set while play() is blocked by the browser autoplay policy (typically
     * right after a page reload, before any click). The next user gesture
     * retries the reconciliation.
     */
    private removeAutoplayUnlock: (() => void) | null = null;

    private serverNow(): number {
        return this.clockSync ? this.clockSync.serverNow() : Date.now();
    }

    private recordEvent(
        type: SyncEventType,
        details: Record<string, unknown> = {},
    ): void {
        this.metrics.recordEvent({
            type,
            timestamp: Date.now(),
            serverTimestamp: this.serverNow(),
            participantId: this.localUserId,
            ...details,
        });
    }

    start(): void {
        if (this.disposed) {
            throw new Error(
                "[PlaybackCoordinator] Cannot start a disposed coordinator",
            );
        }
        if (this.unsubscribe) return;

        log.debug("Starting");

        this.unsubscribe = this.gateway.onPlaybackSync(
            (payload: RemotePlaybackPayload) => {
                log.debug("Remote playback received", {
                    action: payload.action,
                    playhead: payload.playhead,
                    originatorId: payload.originatorId,
                    serverExecutionTime: payload.serverExecutionTime,
                });

                this.handleRemotePlayback(payload);
            },
        );

        /**
         * The room snapshot carries the current playback state. Apply it on
         * start (late join, page reload, coordinator re-created) and whenever
         * a newer one arrives (reconnect after missed broadcasts).
         */
        const cached = this.gateway.getLastPlaybackSnapshot();
        if (cached) this.applyRoomSnapshot(cached, "initial");
        this.unsubscribeSnapshot = this.gateway.on({
            event: "room:state_update",
            callback: (snapshot) => {
                if (snapshot.playback)
                    this.applyRoomSnapshot(snapshot.playback, "update");
            },
        });

        if (this.options.periodicCorrection) {
            this.periodicInterval = setInterval(
                () => this.periodicCheck(),
                this.periodicCheckIntervalMs,
            );
        }

        this.startMetricsCollection();
        log.debug("Metrics collection started", {
            intervalMs: this.metricsIntervalMs,
            controlClock: this.clockCorrectionEnabled ? "server" : "local",
            periodicCorrection: this.options.periodicCorrection,
            burstIntervalMs: this.burstSampleIntervalMs,
            participantId: this.localUserId,
        });
    }

    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.unsubscribeSnapshot?.();
        this.unsubscribeSnapshot = null;

        if (this.periodicInterval) {
            clearInterval(this.periodicInterval);
            this.periodicInterval = null;
        }

        this.stopMetricsCollection();
        this.removeAutoplayUnlock?.();
        this.removeAutoplayUnlock = null;

        log.debug("Stopped");
    }

    dispose(): void {
        this.disposed = true;
        this.stop();
    }

    /**
     * Called by the adapter right before the owner's own play/pause/seek is
     * sent, so the periodic check does not pull the owner back to the old
     * timeline while the command is on its way to the server.
     */
    noteLocalControl(): void {
        this.lastControlActivity = Date.now();
        this.outOfToleranceCount = 0;
    }

    /**
     * Applies the room snapshot's playback state when it is newer than the
     * timeline this client already follows. Snapshot application is recorded
     * as SNAPSHOT_APPLIED (not as a command), so it does not distort command
     * latency or recovery statistics.
     */
    private applyRoomSnapshot(
        playback: RoomPlaybackSnapshot,
        trigger: "initial" | "update",
    ): void {
        if (this.disposed) return;
        if (
            typeof playback.lastUpdated !== "number" ||
            typeof playback.playhead !== "number"
        )
            return;
        if (playback.lastUpdated <= this.expectedPlayheadTimestamp) return;

        const action: RemotePlaybackAction =
            playback.status === "PLAYING" ? "PLAY" : "PAUSE";
        this.playbackCommandVersion = this.playbackCommandVersion + 1;
        this.lastCommandLocalTime = Date.now();
        this.lastControlActivity = Date.now();
        this.commandReceivedAt.set(this.playbackCommandVersion, {
            localTime: Date.now(),
            action,
            origin: "snapshot",
        });

        this.recordEvent("SNAPSHOT_APPLIED", {
            trigger,
            action,
            playhead: playback.playhead,
            serverExecutionTime: playback.lastUpdated,
            commandVersion: this.playbackCommandVersion,
            localPositionSeconds: this.engine.getCurrentTime(),
        });

        this.updateExpectedPlaybackState({
            action,
            playhead: playback.playhead,
            originatorId: "room-snapshot",
            serverExecutionTime: playback.lastUpdated,
        });

        this.reconcileOrigin = "snapshot";
        void this.reconcilePlaybackCommands();
    }

    /**
     * Corrects drift that develops between commands: a stall, a background
     * tab, a slow device, or a member seeking their own player. Runs the
     * same reconciliation as a command, after two consecutive
     * out-of-tolerance checks, and never while the player is buffering.
     */
    private periodicCheck(): void {
        if (this.disposed || this.isReconcilingPlayback) return;
        if (this.expectedPlayheadTimestamp === 0) return;

        const now = Date.now();
        if (now - this.lastControlActivity < this.periodicGraceMs) return;
        if (now - this.lastReconcileFailureAt < this.periodicFailureBackoffMs)
            return;

        // Seeking to "now" while still rebuffering would only start another stall.
        if (!this.engine.isReadyForCorrection()) {
            this.outOfToleranceCount = 0;
            return;
        }

        const expected = this.calculateExpectedPlaybackPosition(
            this.controlNow(),
        );
        const actual = this.engine.getCurrentTime();
        const driftSeconds = expected - actual;
        const shouldPlay = this.expectedPlaybackState === "PLAYING";
        const stateMismatch = shouldPlay === this.engine.isPaused();

        if (
            !stateMismatch &&
            Math.abs(driftSeconds) <= this.driftToleranceSeconds
        ) {
            this.outOfToleranceCount = 0;
            return;
        }

        this.outOfToleranceCount += 1;
        if (this.outOfToleranceCount < this.periodicConsecutiveRequired) return;

        this.outOfToleranceCount = 0;
        this.lastControlActivity = now;

        this.recordEvent("PERIODIC_CORRECTION", {
            signedDriftMs: driftSeconds * 1000,
            stateMismatch,
            expectedState: this.expectedPlaybackState,
            localPaused: this.engine.isPaused(),
        });

        this.reconcileOrigin = "periodic";
        void this.reconcilePlaybackCommands();
    }

    private handleRemotePlayback(payload: RemotePlaybackPayload): void {
        this.playbackCommandVersion = this.playbackCommandVersion + 1;

        const receivedServerTime = this.serverNow();
        this.lastCommandLocalTime = Date.now();
        this.lastControlActivity = Date.now();
        this.commandReceivedAt.set(this.playbackCommandVersion, {
            localTime: Date.now(),
            action: payload.action,
            origin: "command",
        });
        this.recordEvent("COMMAND_RECEIVED", {
            action: payload.action,
            playhead: payload.playhead,
            originatorId: payload.originatorId,
            serverExecutionTime: payload.serverExecutionTime,
            commandVersion: this.playbackCommandVersion,
            selfOriginated: payload.originatorId === this.localUserId,
            /** Server stamp -> client receive, on the server clock. */
            deliveryDelayMs: receivedServerTime - payload.serverExecutionTime,
            clockRttMs: this.clockSync?.getState().rttMs ?? null,
        });

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
            log.debug("Ignoring self-originated playback", {
                action: payload.action,
                originatorId: payload.originatorId,
            });

            return;
        }

        log.debug("Handling remote action", payload.action);

        switch (payload.action) {
            case "PLAY":
                break;

            case "PAUSE":
                this.remotePlaybackGuard.run(() => {
                    void this.engine.pause().catch((error) => {
                        log.error("Immediate PAUSE failed", error);
                    });
                });
                break;

            case "SEEK":
                this.remotePlaybackGuard.run(() => {
                    this.engine.seek(payload.playhead);
                });
                break;
        }

        this.reconcileOrigin = "command";
        void this.reconcilePlaybackCommands();
    }

    private updateExpectedPlaybackState(payload: RemotePlaybackPayload): void {
        this.expectedPlayheadSeconds = payload.playhead;
        this.expectedPlayheadTimestamp = payload.serverExecutionTime;

        switch (payload.action) {
            case "PLAY":
                this.expectedPlaybackState = "PLAYING";
                break;

            case "PAUSE":
                this.expectedPlaybackState = "PAUSED";
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
        if (payload.action !== "PLAY") return payload.playhead;

        const elapsedSeconds = Math.max(
            0,
            (this.controlNow() - payload.serverExecutionTime) / 1000,
        );

        const targetPlayhead = Math.max(0, payload.playhead + elapsedSeconds);

        log.debug("Target playhead calculated", {
            originalPlayhead: payload.playhead,
            elapsedSeconds,
            targetPlayhead,
        });

        return targetPlayhead;
    }

    /**
     * Calculates the expected playhead for the current local time
     */
    private calculateExpectedPlaybackPosition(
        nowMs: number = this.controlNow(),
    ): number {
        if (this.expectedPlaybackState !== "PLAYING") {
            return this.expectedPlayheadSeconds;
        }

        const elapsedSeconds = Math.max(
            0,
            (nowMs - this.expectedPlayheadTimestamp) / 1000,
        );

        return Math.max(0, this.expectedPlayheadSeconds + elapsedSeconds);
    }

    /**
     * Collects continuous synchronization measurements;
     */
    private collectPlaybackDriftSample(): void {
        if (this.disposed) return;

        /**
         * We cannot calculate meaningful synchronization drift
         * until at least one remote synchronization event has
         * established an expected playback position.
         */
        if (this.expectedPlayheadTimestamp === 0) return;

        const localNow = Date.now();
        const inBurst =
            localNow - this.lastCommandLocalTime < this.burstWindowMs;
        // The timer ticks at the burst rate; outside a burst keep the base 2 Hz.
        if (
            !inBurst &&
            localNow - this.lastSampleLocalTime <
                this.metricsIntervalMs - this.burstSampleIntervalMs / 2
        ) {
            return;
        }
        this.lastSampleLocalTime = localNow;

        const serverNow = this.serverNow();
        const actualPositionSeconds = this.engine.getCurrentTime();

        /**
         * The expected timeline is anchored at serverExecutionTime (server
         * clock), so "now" must be on the server clock as well. The local-clock
         * value is kept to show how much clock skew alone would distort it.
         */
        const expectedPositionSeconds =
            this.calculateExpectedPlaybackPosition(serverNow);
        const uncorrectedExpectedSeconds =
            this.calculateExpectedPlaybackPosition(localNow);

        const signedDriftMs =
            (expectedPositionSeconds - actualPositionSeconds) * 1000;
        const clock = this.clockSync?.getState();

        this.metrics.recordPlaybackDrift({
            timestamp: localNow,
            participantId: this.localUserId,
            actualPositionSeconds,
            expectedPositionSeconds,
            driftMs: Math.abs(signedDriftMs),
            playbackState: this.expectedPlaybackState,
            serverTimestamp: serverNow,
            signedDriftMs,
            uncorrectedDriftMs:
                Math.abs(uncorrectedExpectedSeconds - actualPositionSeconds) *
                1000,
            clockOffsetMs: clock?.offsetMs ?? 0,
            clockRttMs: clock?.rttMs,
            clockSynced: clock?.synced ?? false,
            localPaused: this.engine.isPaused(),
            commandVersion: this.appliedCommandVersion,
            controlClock: this.clockCorrectionEnabled ? "server" : "local",
            periodicCorrection: this.options.periodicCorrection,
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

                    this.lastReconcileFailureAt = Date.now();
                    this.recordEvent("RECONCILE_FAILED", {
                        commandVersion,
                        origin: this.reconcileOrigin,
                        stage: "play_pause",
                        /** NotAllowedError = browser autoplay policy blocked play(). */
                        errorName: (error as { name?: string })?.name ?? null,
                        error: String(error),
                    });

                    const errorName =
                        (error as { name?: string })?.name ?? null;
                    if (errorName === "NotAllowedError") {
                        log.warn(
                            "Autoplay blocked by the browser; playback resumes on the next click or key press",
                            { expectedState, commandVersion },
                        );
                        this.armAutoplayUnlock();
                    } else {
                        log.error("Playback reconciliation failed", {
                            expectedState,
                            commandVersion,
                            errorName,
                            errorMessage:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        });
                    }

                    return;
                }

                if (this.disposed) {
                    return;
                }

                // Never apply an old command's target position.
                if (commandVersion !== this.playbackCommandVersion) {
                    log.debug("Command superseded during reconciliation", {
                        commandVersion,
                        latestCommandVersion: this.playbackCommandVersion,
                    });

                    continue;
                }

                // Calculate the target from the latest expected timeline.
                const targetPlayhead = this.calculateExpectedPlaybackPosition(
                    this.controlNow(),
                );

                try {
                    await this.correctDrift(targetPlayhead);
                } catch (error) {
                    if (this.disposed) {
                        return;
                    }

                    if (commandVersion !== this.playbackCommandVersion) {
                        continue;
                    }

                    this.lastReconcileFailureAt = Date.now();
                    log.error("Failed to complete playback seek", {
                        commandVersion,
                        targetPlayhead,
                        error,
                    });

                    return;
                }

                if (this.disposed) {
                    return;
                }

                if (commandVersion !== this.playbackCommandVersion) {
                    continue;
                }

                // A periodic correction re-applies an already applied version:
                // its CORRECTION_SEEK / PERIODIC_CORRECTION events describe it.
                if (commandVersion !== this.appliedCommandVersion) {
                    this.markCommandApplied(commandVersion, expectedState);
                }
                return;
            }
        } finally {
            this.isReconcilingPlayback = false;
        }
    }

    /** Retries reconciliation on the first user gesture after an autoplay block. */
    private armAutoplayUnlock(): void {
        if (this.removeAutoplayUnlock || typeof window === "undefined") return;

        const events = ["pointerdown", "keydown", "touchend"] as const;
        const onGesture = () => {
            this.removeAutoplayUnlock?.();
            this.removeAutoplayUnlock = null;
            if (this.disposed) return;
            this.lastReconcileFailureAt = 0;
            this.reconcileOrigin = "snapshot";
            void this.reconcilePlaybackCommands();
        };

        for (const event of events) {
            window.addEventListener(event, onGesture, { capture: true });
        }
        this.removeAutoplayUnlock = () => {
            for (const event of events) {
                window.removeEventListener(event, onGesture, { capture: true });
            }
        };
    }

    /**
     * Records that the local player finished applying a command version.
     * Superseded versions are reported too, so command coalescing under
     * rapid seeks is visible in the data.
     */
    private markCommandApplied(
        commandVersion: number,
        expectedState: ExpectedPlaybackState,
    ): void {
        const received = this.commandReceivedAt.get(commandVersion);
        const supersededVersions: number[] = [];
        for (const version of this.commandReceivedAt.keys()) {
            if (version < commandVersion) supersededVersions.push(version);
        }
        supersededVersions.forEach((v) => this.commandReceivedAt.delete(v));
        this.commandReceivedAt.delete(commandVersion);

        this.appliedCommandVersion = commandVersion;
        const actualPositionSeconds = this.engine.getCurrentTime();

        this.recordEvent("COMMAND_APPLIED", {
            commandVersion,
            action: received?.action ?? null,
            /** "command" = broadcast, "snapshot" = room state on join/reconnect. */
            origin: received?.origin ?? "command",
            expectedState,
            /** Receive -> local player settled (play/pause + optional seek), local clock. */
            applyDurationMs: received ? Date.now() - received.localTime : null,
            supersededCount: supersededVersions.length,
            actualPositionSeconds,
            residualDriftMs:
                Math.abs(
                    this.calculateExpectedPlaybackPosition(this.serverNow()) -
                        actualPositionSeconds,
                ) * 1000,
        });
    }

    private startMetricsCollection(): void {
        if (this.metricsInterval) return;

        this.metricsInterval = setInterval(
            () => this.collectPlaybackDriftSample(),
            this.burstSampleIntervalMs,
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

        log.debug("Drift check", {
            localPlayhead,
            targetPlayhead,
            drift,
            tolerance: this.driftToleranceSeconds,
        });

        if (Math.abs(drift) > this.driftToleranceSeconds) {
            log.debug("Drift exceeds tolerance — seeking", {
                from: localPlayhead,
                to: targetPlayhead,
                drift,
            });

            this.recordEvent("CORRECTION_SEEK", {
                fromSeconds: localPlayhead,
                toSeconds: targetPlayhead,
                signedDriftMs: drift * 1000,
                commandVersion: this.playbackCommandVersion,
                origin: this.reconcileOrigin,
            });

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
