import { SyncMetrics, SyncMetricsRecord } from "./SyncMetrics";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("SyncMetricsUploader");

/**
 * Streams SyncMetrics records to the backend (POST /v1/sync-metrics/batches),
 * so every participant of a run lands in one server-side dataset without
 * anyone clicking a download button.
 *
 * Records are batched; a failed batch is put back at the head of the queue
 * and retried on the next flush. The queue is bounded so an unreachable
 * backend cannot exhaust memory (the in-memory SyncMetrics copy and the
 * local download remain as a fallback).
 */

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH = 500;
const MAX_QUEUE = 20_000;

export class SyncMetricsUploader {
    private queue: SyncMetricsRecord[] = [];
    private timer: ReturnType<typeof setInterval> | null = null;
    private unsubscribe: (() => void) | null = null;
    private flushing = false;
    private clientInfoSent = false;
    private readonly clientSessionId = createClientSessionId();
    private uploadedCount = 0;
    private droppedCount = 0;

    constructor(private readonly metrics: SyncMetrics) {}

    start(): void {
        if (this.timer || typeof window === "undefined") return;

        this.unsubscribe = this.metrics.onRecord((record) => {
            this.queue.push(record);
            if (this.queue.length > MAX_QUEUE) {
                this.queue.shift();
                this.droppedCount++;
            }
        });

        this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
        window.addEventListener("pagehide", this.handlePageHide);
    }

    /** Stops batching and makes a last best-effort upload. */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.unsubscribe?.();
        this.unsubscribe = null;
        if (typeof window !== "undefined") {
            window.removeEventListener("pagehide", this.handlePageHide);
        }
        void this.flush(true);
    }

    getStatus(): { queued: number; uploaded: number; dropped: number } {
        return {
            queued: this.queue.length,
            uploaded: this.uploadedCount,
            dropped: this.droppedCount,
        };
    }

    private handlePageHide = (): void => {
        void this.flush(true);
    };

    async flush(final = false): Promise<void> {
        const context = this.metrics.getRunContext();
        if (!context || this.flushing || this.queue.length === 0) return;

        this.flushing = true;
        const batch = this.queue.splice(0, MAX_BATCH);

        try {
            const outcome = await this.post(
                {
                    runId: context.runId,
                    scenario: context.scenario ?? undefined,
                    roomId: context.roomId,
                    clientSessionId: this.clientSessionId,
                    client: this.clientInfoSent
                        ? undefined
                        : collectClientInfo(),
                    records: batch,
                },
                final,
            );

            if (outcome === "stored") {
                this.clientInfoSent = true;
                this.uploadedCount += batch.length;
            } else if (outcome === "rejected") {
                this.droppedCount += batch.length;
            } else {
                this.queue.unshift(...batch);
            }
        } finally {
            this.flushing = false;
        }

        // Drain a backlog on the final flush (small backlogs only; keepalive bodies are capped at 64 KB).
        if (final && this.queue.length > 0 && this.queue.length <= MAX_BATCH) {
            void this.flush(true);
        }
    }

    private async post(
        body: unknown,
        keepalive: boolean,
    ): Promise<"stored" | "rejected" | "retry"> {
        const token = localStorage.getItem("access_token");
        const baseUrl =
            process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:7000";

        try {
            const response = await fetch(`${baseUrl}/v1/sync-metrics/batches`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(token ? { authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify(body),
                keepalive,
            });

            if (!response.ok) {
                log.warn("Batch rejected", response.status);
                // 4xx other than auth/rate limits will never succeed; drop instead of looping.
                const permanent =
                    response.status >= 400 &&
                    response.status < 500 &&
                    response.status !== 401 &&
                    response.status !== 429;
                return permanent ? "rejected" : "retry";
            }
            return "stored";
        } catch (error) {
            log.warn("Batch upload failed; will retry", error);
            return "retry";
        }
    }
}

function createClientSessionId(): string {
    const random =
        typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
            : Math.random().toString(36).slice(2, 14);
    return `cs_${random}`;
}

function collectClientInfo(): Record<string, unknown> {
    const nav = navigator as Navigator & {
        connection?: {
            effectiveType?: string;
            rtt?: number;
            downlink?: number;
        };
    };
    return {
        userAgent: nav.userAgent,
        hardwareConcurrency: nav.hardwareConcurrency,
        effectiveConnectionType: nav.connection?.effectiveType ?? null,
        connectionRttMs: nav.connection?.rtt ?? null,
        downlinkMbps: nav.connection?.downlink ?? null,
        screen: `${window.screen.width}x${window.screen.height}`,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        startedAtLocal: Date.now(),
    };
}
