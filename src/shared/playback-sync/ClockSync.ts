/**
 * Estimates the offset between this client's clock and the server clock
 * (the clock that stamps `serverExecutionTime`), NTP-style.
 *
 * Each probe records four timestamps:
 *   t0 client send, t1 server receive, t2 server send, t3 client receive
 *
 *   offset = ((t1 - t0) + (t2 - t3)) / 2     (server − client)
 *   rtt    = (t3 - t0) - (t2 - t1)
 *
 * The offset error is bounded by rtt / 2, so out of each burst the probe with
 * the smallest RTT is kept (standard NTP clock filter). Bursts repeat
 * periodically to follow clock drift between machines.
 */

export interface ClockProbeReply {
    serverReceiveTime: number;
    serverSendTime: number;
}

/** Sends one probe and resolves with the server timestamps, or null on failure. */
export type ClockProbe = (
    clientSendTime: number,
) => Promise<ClockProbeReply | null>;

export interface ClockSyncState {
    synced: boolean;
    /** serverTime ≈ Date.now() + offsetMs */
    offsetMs: number;
    /** RTT of the probe the offset was taken from. Offset uncertainty ≤ rttMs / 2. */
    rttMs: number;
    /** Successful probes in the last burst. */
    probeCount: number;
    /** Local time of the last successful burst. */
    lastSyncedAt: number;
}

export interface ClockSyncOptions {
    probesPerBurst: number;
    probeSpacingMs: number;
    resyncIntervalMs: number;
}

const DEFAULT_OPTIONS: ClockSyncOptions = {
    probesPerBurst: 10,
    probeSpacingMs: 100,
    resyncIntervalMs: 30_000,
};

export class ClockSync {
    private state: ClockSyncState = {
        synced: false,
        offsetMs: 0,
        rttMs: 0,
        probeCount: 0,
        lastSyncedAt: 0,
    };

    private timer: ReturnType<typeof setTimeout> | null = null;
    private running = false;
    private bursting = false;
    private readonly listeners = new Set<(state: ClockSyncState) => void>();
    private readonly options: ClockSyncOptions;

    constructor(
        private readonly probe: ClockProbe,
        options: Partial<ClockSyncOptions> = {},
    ) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        void this.runBurstAndSchedule();
    }

    stop(): void {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    /** Best estimate of the current server time, in epoch milliseconds. */
    serverNow(): number {
        return Date.now() + this.state.offsetMs;
    }

    /** Converts a server timestamp to this client's clock. */
    toLocalTime(serverTime: number): number {
        return serverTime - this.state.offsetMs;
    }

    getState(): ClockSyncState {
        return { ...this.state };
    }

    onSync(listener: (state: ClockSyncState) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private async runBurstAndSchedule(): Promise<void> {
        await this.runBurst();
        if (!this.running) return;

        // Retry sooner while unsynced (e.g. the socket was still connecting).
        const delay = this.state.synced ? this.options.resyncIntervalMs : 2_000;
        this.timer = setTimeout(() => void this.runBurstAndSchedule(), delay);
    }

    private async runBurst(): Promise<void> {
        if (this.bursting) return;
        this.bursting = true;

        try {
            let best: { offsetMs: number; rttMs: number } | null = null;
            let count = 0;

            for (
                let i = 0;
                i < this.options.probesPerBurst && this.running;
                i++
            ) {
                const t0 = Date.now();
                const reply = await this.probe(t0).catch(() => null);
                const t3 = Date.now();

                if (reply) {
                    const t1 = reply.serverReceiveTime;
                    const t2 = reply.serverSendTime;
                    const rttMs = Math.max(0, t3 - t0 - (t2 - t1));
                    const offsetMs = (t1 - t0 + (t2 - t3)) / 2;
                    count++;
                    if (!best || rttMs < best.rttMs) best = { offsetMs, rttMs };
                }

                await new Promise((r) =>
                    setTimeout(r, this.options.probeSpacingMs),
                );
            }

            if (best && this.running) {
                this.state = {
                    synced: true,
                    offsetMs: best.offsetMs,
                    rttMs: best.rttMs,
                    probeCount: count,
                    lastSyncedAt: Date.now(),
                };
                this.listeners.forEach((l) => l(this.getState()));
            }
        } finally {
            this.bursting = false;
        }
    }
}
