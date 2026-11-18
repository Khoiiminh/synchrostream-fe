import { createLogger } from "@/core/logging/logger";

const log = createLogger("SyncMetrics");
/**
 * Synchronization measurements for the watch-party evaluation.
 *
 * Two record kinds share one stream:
 *  - "sample": periodic playback-drift observation (2 Hz)
 *  - "event":  a discrete step of the sync protocol (command issued, received,
 *              applied, correction seek, clock sync…)
 *
 * All drift values are computed on the server clock (see ClockSync), so
 * samples from different machines are comparable on one timeline.
 */

export type PlaybackState = "PLAYING" | "PAUSED";

export interface PlaybackDriftSample {
    kind?: "sample";
    /** Local clock (Date.now()) at sampling time. */
    timestamp: number;
    participantId: string;
    actualPositionSeconds: number;
    expectedPositionSeconds: number;
    /** |expected − actual| in ms, expected computed on the server clock. */
    driftMs: number;
    playbackState: PlaybackState;

    /** Estimated server time at sampling (timestamp + clockOffsetMs). */
    serverTimestamp?: number;
    /** expected − actual, ms. Positive = this client is behind. */
    signedDriftMs?: number;
    /** Drift computed with the local clock only (no offset correction), for comparison. */
    uncorrectedDriftMs?: number;
    clockOffsetMs?: number;
    clockRttMs?: number;
    clockSynced?: boolean;
    /** Actual state of the local <video> element. */
    localPaused?: boolean;
    /** Version of the last sync command applied by the coordinator. */
    commandVersion?: number;
    /** Clock the sync controller used for its targets ("server" = offset-corrected). */
    controlClock?: "server" | "local";
    /** Whether drift between commands is corrected (see ?periodicCorrection=off). */
    periodicCorrection?: boolean;
}

export type SyncEventType =
    | "CLOCK_SYNC"
    | "COMMAND_ISSUED"
    | "COMMAND_RECEIVED"
    | "COMMAND_APPLIED"
    | "CORRECTION_SEEK"
    | "RECONCILE_FAILED"
    | "SNAPSHOT_APPLIED"
    | "PERIODIC_CORRECTION"
    | "RUN_MARK";

export interface SyncEventInput {
    type: SyncEventType;
    timestamp: number;
    serverTimestamp: number;
    participantId: string;
    [detail: string]: unknown;
}

export interface SyncEvent {
    kind: "event";
    type: SyncEventType;
    timestamp: number;
    serverTimestamp: number;
    participantId: string;
    [detail: string]: unknown;
}

export type SyncMetricsRecord = PlaybackDriftSample | SyncEvent;

export interface SyncRunContext {
    runId: string;
    scenario: string | null;
    roomId: string;
    /** Whether the sync controller applies the clock offset (see ?clockCorrection=off). */
    clockCorrection: boolean;
    /** Whether the periodic drift correction runs (see ?periodicCorrection=off). */
    periodicCorrection: boolean;
}

const MAX_RETAINED_RECORDS = 50_000;

export class SyncMetrics {
    private readonly samples: PlaybackDriftSample[] = [];
    private readonly events: SyncEvent[] = [];
    private readonly listeners = new Set<(record: SyncMetricsRecord) => void>();
    private runContext: SyncRunContext | null = null;

    public setRunContext(context: SyncRunContext): void {
        this.runContext = context;
    }

    public getRunContext(): SyncRunContext | null {
        return this.runContext;
    }

    public recordPlaybackDrift(sample: PlaybackDriftSample): void {
        const record: PlaybackDriftSample = { kind: "sample", ...sample };
        this.samples.push(record);
        if (this.samples.length > MAX_RETAINED_RECORDS) this.samples.shift();
        this.emit(record);
    }

    public recordEvent(event: SyncEventInput): void {
        const record: SyncEvent = { kind: "event", ...event };
        this.events.push(record);
        if (this.events.length > MAX_RETAINED_RECORDS) this.events.shift();
        this.emit(record);
    }

    /** Subscribes to every new record (used by the uploader). */
    public onRecord(listener: (record: SyncMetricsRecord) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public getPlaybackDriftSamples(): PlaybackDriftSample[] {
        return [...this.samples];
    }

    public getEvents(): SyncEvent[] {
        return [...this.events];
    }

    public getSampleCount(): number {
        return this.samples.length;
    }

    public clear(): void {
        this.samples.length = 0;
        this.events.length = 0;
    }

    /** Legacy export: drift samples only (format read by analyze:sync). */
    public exportJson(): string {
        return JSON.stringify(this.samples, null, 2);
    }

    /** Full local export: run context, samples and events. */
    public exportRunJson(): string {
        return JSON.stringify(
            {
                format: "synchrostream-sync-run/v1",
                context: this.runContext,
                records: [...this.samples, ...this.events].sort(
                    (a, b) => a.timestamp - b.timestamp,
                ),
            },
            null,
            2,
        );
    }

    public downloadJson(filename = "synchrostream-sync-metrics.json"): void {
        this.download(this.exportJson(), filename);
    }

    public downloadRunJson(filename?: string): void {
        const name =
            filename ??
            `synchrostream-${this.runContext?.runId ?? "run"}-local.json`;
        this.download(this.exportRunJson(), name);
    }

    private emit(record: SyncMetricsRecord): void {
        this.listeners.forEach((listener) => {
            try {
                listener(record);
            } catch (error) {
                log.error("Record listener failed", error);
            }
        });
    }

    private download(content: string, filename: string): void {
        if (typeof window === "undefined") {
            return;
        }

        const blob = new Blob([content], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");

        anchor.href = url;
        anchor.download = filename;

        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);

        URL.revokeObjectURL(url);
    }
}
