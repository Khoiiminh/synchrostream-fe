import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClockSync, type ClockProbe, type ClockSyncState } from "./ClockSync";

/*
 * A simulated server whose clock runs `SERVER_AHEAD_MS` ahead of this
 * client. Each probe takes `up` ms to arrive, `serverWork` ms on the server
 * and `down` ms back, all on fake timers.
 */
const SERVER_AHEAD_MS = 500;

function simulatedServer(
    legs: { up: number; serverWork: number; down: number }[],
) {
    let i = 0;
    const probe: ClockProbe = async () => {
        const leg = legs[Math.min(i, legs.length - 1)];
        i += 1;
        await new Promise((r) => setTimeout(r, leg.up));
        const serverReceiveTime = Date.now() + SERVER_AHEAD_MS;
        await new Promise((r) => setTimeout(r, leg.serverWork));
        const serverSendTime = Date.now() + SERVER_AHEAD_MS;
        await new Promise((r) => setTimeout(r, leg.down));
        return { serverReceiveTime, serverSendTime };
    };
    return probe;
}

beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 20, 12) });
});
afterEach(() => {
    vi.useRealTimers();
});

describe("ClockSync", () => {
    it("starts unsynced with a zero offset", () => {
        const sync = new ClockSync(async () => null);
        expect(sync.getState()).toEqual({
            synced: false,
            offsetMs: 0,
            rttMs: 0,
            probeCount: 0,
            lastSyncedAt: 0,
        });
        expect(sync.serverNow()).toBe(Date.now());
    });

    it("symmetric delay: the offset is exact and the RTT excludes server time", async () => {
        const sync = new ClockSync(
            simulatedServer([{ up: 20, serverWork: 5, down: 20 }]),
            { probesPerBurst: 3, probeSpacingMs: 10 },
        );
        sync.start();
        await vi.advanceTimersByTimeAsync(1_000);

        const state = sync.getState();
        expect(state).toMatchObject({
            synced: true,
            offsetMs: SERVER_AHEAD_MS,
            rttMs: 40,
            probeCount: 3,
        });
        expect(sync.serverNow()).toBe(Date.now() + SERVER_AHEAD_MS);
        expect(sync.toLocalTime(Date.now() + SERVER_AHEAD_MS)).toBe(Date.now());
        sync.stop();
    });

    it("keeps the probe with the smallest RTT (NTP clock filter)", async () => {
        // Asymmetric slow probes skew the offset; the fast symmetric one is right.
        const sync = new ClockSync(
            simulatedServer([
                { up: 200, serverWork: 0, down: 10 },
                { up: 5, serverWork: 0, down: 5 },
                { up: 10, serverWork: 0, down: 300 },
            ]),
            { probesPerBurst: 3, probeSpacingMs: 10 },
        );
        sync.start();
        await vi.advanceTimersByTimeAsync(2_000);

        expect(sync.getState()).toMatchObject({
            offsetMs: SERVER_AHEAD_MS,
            rttMs: 10,
        });
        sync.stop();
    });

    it("failed and rejected probes are skipped; a burst with none succeeding leaves it unsynced", async () => {
        let calls = 0;
        const sync = new ClockSync(
            async () => {
                calls += 1;
                if (calls % 2) throw new Error("socket closed");
                return null;
            },
            { probesPerBurst: 4, probeSpacingMs: 10 },
        );
        sync.start();
        await vi.advanceTimersByTimeAsync(100);

        expect(calls).toBe(4);
        expect(sync.getState().synced).toBe(false);
        sync.stop();
    });

    it("retries after 2 s while unsynced, then every resync interval", async () => {
        let ok = false;
        const replies: number[] = [];
        const sync = new ClockSync(
            async (t0) => {
                replies.push(Date.now());
                return ok
                    ? { serverReceiveTime: t0, serverSendTime: t0 }
                    : null;
            },
            { probesPerBurst: 1, probeSpacingMs: 0, resyncIntervalMs: 30_000 },
        );
        sync.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(replies).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(1_999);
        expect(replies).toHaveLength(1);
        ok = true;
        await vi.advanceTimersByTimeAsync(1);
        expect(replies).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(sync.getState().synced).toBe(true);

        // The next burst is 30 s after that burst finished.
        const syncedAt = sync.getState().lastSyncedAt;
        await vi.advanceTimersByTimeAsync(syncedAt + 30_000 - Date.now() - 1);
        expect(replies).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(replies).toHaveLength(3);
        sync.stop();
    });

    it("notifies listeners after each successful burst, until they unsubscribe", async () => {
        const sync = new ClockSync(
            simulatedServer([{ up: 1, serverWork: 0, down: 1 }]),
            { probesPerBurst: 1, probeSpacingMs: 0, resyncIntervalMs: 1_000 },
        );
        const seen: ClockSyncState[] = [];
        const off = sync.onSync((s) => seen.push(s));
        sync.start();
        await vi.advanceTimersByTimeAsync(10);
        expect(seen).toHaveLength(1);
        expect(seen[0].synced).toBe(true);

        off();
        await vi.advanceTimersByTimeAsync(1_100);
        expect(seen).toHaveLength(1);
        sync.stop();
    });

    it("stop ends the schedule, and start is idempotent", async () => {
        const probe = vi.fn<ClockProbe>(async () => null);
        const sync = new ClockSync(probe, {
            probesPerBurst: 1,
            probeSpacingMs: 0,
        });
        sync.start();
        sync.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(probe).toHaveBeenCalledTimes(1);
        // One schedule, not two: the 2 s retry fires once.
        await vi.advanceTimersByTimeAsync(2_100);
        expect(probe).toHaveBeenCalledTimes(2);

        sync.stop();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(probe).toHaveBeenCalledTimes(2);
    });
});
