import { RemotePlaybackGuard } from "@/shared/playback-sync/RemotePlaybackGuard";
import { SyncEngine } from "@/shared/playback-sync/SyncEngine";
import { WatchPartyGatewayEngine } from "../WatchPartyGatewayEngine";
import {
    ISyncAdapter,
    QualityLevel,
} from "@/shared/playback-sync/ISyncAdapter";
import { PlaybackCoordinator } from "./PlaybackCoordinator";
import { ClockSync } from "@/shared/playback-sync/ClockSync";
import { SyncMetrics } from "@/shared/playback-sync/SyncMetrics";
import { SyncMetricsUploader } from "@/shared/playback-sync/SyncMetricsUploader";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("PartySyncAdapter");

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Measurement run identity. Every participant of a room shares the default
 * run id (room-<roomId>), so their data lands in one dataset. Append
 * `?run=<id>&scenario=<name>` to the watch URL on every client to label a
 * specific experiment (e.g. run=lan-3clients-01&scenario=rapid_seek).
 */
function resolveRunContext(roomId: string): {
    runId: string;
    scenario: string | null;
    clockCorrection: boolean;
    periodicCorrection: boolean;
} {
    let runId = `room-${roomId}`.slice(0, 80);
    let scenario: string | null = null;
    let clockCorrection = true;
    let periodicCorrection = true;

    if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const run = params.get("run");
        const scen = params.get("scenario");
        if (run && SAFE_ID.test(run)) runId = run;
        if (scen && SAFE_ID.test(scen)) scenario = scen;
        // Baseline mode for before/after comparisons: ?clockCorrection=off
        if (params.get("clockCorrection") === "off") clockCorrection = false;
        // Baseline: only reconcile on commands/snapshots: ?periodicCorrection=off
        if (params.get("periodicCorrection") === "off")
            periodicCorrection = false;
    }

    if (!SAFE_ID.test(runId)) runId = runId.replace(/[^A-Za-z0-9_-]/g, "_");
    return { runId, scenario, clockCorrection, periodicCorrection };
}

export class PartySyncAdapter implements ISyncAdapter {
    private coordinator: PlaybackCoordinator | null = null;
    private readonly metrics: SyncMetrics;
    private readonly clockSync: ClockSync;
    private readonly uploader: SyncMetricsUploader;
    private unsubscribeClockSync: (() => void) | null = null;

    constructor(
        private readonly localEngine: SyncEngine,
        private readonly gateway: WatchPartyGatewayEngine,
        private readonly streamUrl: string,
        private readonly roomId: string,
        private readonly roomCode: string,
        private readonly userId: string,
        private readonly ownerId: string,
        private readonly remotePlaybackGuard: RemotePlaybackGuard,
    ) {
        this.metrics = new SyncMetrics();
        this.metrics.setRunContext({
            ...resolveRunContext(this.roomId),
            roomId: this.roomId,
        });

        this.clockSync = new ClockSync((t0) => this.gateway.probeClock(t0));
        this.unsubscribeClockSync = this.clockSync.onSync((state) => {
            this.metrics.recordEvent({
                type: "CLOCK_SYNC",
                timestamp: Date.now(),
                serverTimestamp: this.clockSync.serverNow(),
                participantId: this.userId,
                offsetMs: state.offsetMs,
                rttMs: state.rttMs,
                probeCount: state.probeCount,
            });
        });

        this.uploader = new SyncMetricsUploader(this.metrics);

        log.debug("Created", {
            userId: this.userId,
            ownerId: this.ownerId,
            isOwner: this.isOwner,
        });
    }

    private createCoordinator(): PlaybackCoordinator {
        return new PlaybackCoordinator(
            this.localEngine,
            this.gateway,
            this.userId,
            this.remotePlaybackGuard,
            this.metrics,
            this.clockSync,
            {
                clockCorrection:
                    this.metrics.getRunContext()?.clockCorrection ?? true,
                periodicCorrection:
                    this.metrics.getRunContext()?.periodicCorrection ?? true,
            },
        );
    }

    attachVideo(video: HTMLVideoElement): void {
        this.localEngine.attachElement({
            element: video,
            streamUrl: this.streamUrl,
        });

        if (this.coordinator) {
            this.coordinator.dispose();
        }

        this.coordinator = this.createCoordinator();
        this.coordinator.start();

        // Both are idempotent across re-attachments.
        this.clockSync.start();
        this.uploader.start();
    }

    detachVideo(): void {
        if (this.coordinator) {
            this.coordinator.stop();
        }

        this.localEngine.detachElement();
    }

    async play(): Promise<void> {
        if (this.remotePlaybackGuard.isActive) {
            log.debug("Ignoring PLAY generated by remote playback");

            return;
        }

        if (!this.isOwner) {
            log.debug("Ignoring PLAY from non-owner", {
                userId: this.userId,
                ownerId: this.ownerId,
            });

            return;
        }

        const playhead = this.localEngine.getCurrentTime();

        log.debug("PLAY requested", {
            roomId: this.roomId,
            roomCode: this.roomCode,
            userId: this.userId,
            playhead,
        });

        // Initiate local playback without waiting for the promise to settle
        const playPromise = this.localEngine.play();

        // Broadcast immediately to preserve command-issuance order
        this.coordinator?.noteLocalControl();
        this.recordCommandIssued("PLAY", playhead);

        this.gateway.emitPlaybackPulse({
            roomId: this.roomId,
            roomCode: this.roomCode,
            action: "PLAY",
            playhead: playhead,
        });

        //Preserve the existing async method behavior for callers
        await playPromise;
    }

    async pause(): Promise<void> {
        if (this.remotePlaybackGuard.isActive) {
            log.debug("Ignoring PAUSE generated by remote playback");

            return;
        }

        if (!this.isOwner) {
            log.debug("Ignoring PAUSE from non-owner", {
                userId: this.userId,
                ownerId: this.ownerId,
            });

            return;
        }

        const playhead = this.localEngine.getCurrentTime();

        log.debug("PAUSE requested", {
            roomId: this.roomId,
            roomCode: this.roomCode,
            userId: this.userId,
            playhead,
        });

        const pausePromise = this.localEngine.pause();

        this.coordinator?.noteLocalControl();
        this.recordCommandIssued("PAUSE", playhead);

        this.gateway.emitPlaybackPulse({
            roomId: this.roomId,
            roomCode: this.roomCode,
            action: "PAUSE",
            playhead: playhead,
        });

        await pausePromise;
    }

    seek(seconds: number): void {
        if (this.remotePlaybackGuard.isActive) {
            log.debug("Ignoring SEEK generated by remote playback");

            return;
        }

        if (!this.isOwner) {
            log.debug("Ignoring SEEK from non-owner", {
                userId: this.userId,
                ownerId: this.ownerId,
                playhead: seconds,
            });

            return;
        }

        log.debug("SEEK requested", {
            roomId: this.roomId,
            roomCode: this.roomCode,
            userId: this.userId,
            playhead: seconds,
        });

        this.localEngine.seek(seconds);

        this.coordinator?.noteLocalControl();
        this.recordCommandIssued("SEEK", seconds);

        this.gateway.emitPlaybackPulse({
            roomId: this.roomId,
            roomCode: this.roomCode,
            action: "SEEK",
            playhead: seconds,
        });
    }

    dispose(): void {
        if (this.coordinator) {
            this.coordinator.dispose();
            this.coordinator = null;
        }

        this.unsubscribeClockSync?.();
        this.unsubscribeClockSync = null;
        this.clockSync.stop();
        this.uploader.stop();

        this.localEngine.dispose();
    }

    public getSyncMetrics(): SyncMetrics {
        return this.metrics;
    }

    public getClockSync(): ClockSync {
        return this.clockSync;
    }

    public getMetricsUploader(): SyncMetricsUploader {
        return this.uploader;
    }

    /** Owner-side timestamp of a user command, before it reaches the server. */
    private recordCommandIssued(
        action: "PLAY" | "PAUSE" | "SEEK",
        playhead: number,
    ): void {
        this.metrics.recordEvent({
            type: "COMMAND_ISSUED",
            timestamp: Date.now(),
            serverTimestamp: this.clockSync.serverNow(),
            participantId: this.userId,
            action,
            playhead,
        });
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

    private get isOwner(): boolean {
        return this.userId === this.ownerId;
    }
}
