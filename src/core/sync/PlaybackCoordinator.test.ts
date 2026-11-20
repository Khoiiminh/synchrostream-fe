import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    PlaybackCoordinator,
    type RoomPlaybackSnapshot,
} from "./PlaybackCoordinator";
import { RemotePlaybackGuard } from "@/shared/playback-sync/RemotePlaybackGuard";
import { SyncMetrics } from "@/shared/playback-sync/SyncMetrics";

/*
 * Behaviour of PlaybackCoordinator against a simulated player and gateway,
 * ported from scripts/sim-coordinator.ts onto fake timers (the script ran
 * ~25 s in real time). Same scenarios, same thresholds:
 *   LIFE-01 late join, LIFE-02 reconnect snapshots, ENV-03 stall recovery,
 *   the periodicCorrection=off baseline, and the owner's own seek.
 */

class FakeEngine {
    position = 0;
    paused = true;
    stalled = false;
    buffering = false;
    seeks: number[] = [];
    private last = Date.now();
    private tick = setInterval(() => this.advance(), 20);

    advance() {
        const now = Date.now();
        if (!this.paused && !this.stalled)
            this.position += (now - this.last) / 1000;
        this.last = now;
    }
    getCurrentTime() {
        this.advance();
        return this.position;
    }
    isPaused() {
        return this.paused;
    }
    isReadyForCorrection() {
        return !this.buffering;
    }
    async play() {
        this.advance();
        this.paused = false;
    }
    async pause() {
        this.advance();
        this.paused = true;
    }
    seek(s: number) {
        this.advance();
        this.position = s;
        this.seeks.push(s);
    }
    async waitForSeekCompletion() {
        await new Promise((r) => setTimeout(r, 30));
    }
    stop() {
        clearInterval(this.tick);
    }
}

type Listener = (p: unknown) => void;

class FakeGateway {
    snapshot: RoomPlaybackSnapshot | null = null;
    private playback = new Set<Listener>();
    private state = new Set<Listener>();
    getLastPlaybackSnapshot() {
        return this.snapshot;
    }
    onPlaybackSync(cb: Listener) {
        this.playback.add(cb);
        return () => this.playback.delete(cb);
    }
    on(p: { event: string; callback: Listener }) {
        this.state.add(p.callback);
        return () => this.state.delete(p.callback);
    }
    broadcast(p: unknown) {
        this.playback.forEach((l) => l(p));
    }
    stateUpdate(playback: RoomPlaybackSnapshot) {
        this.state.forEach((l) => l({ playback }));
    }
}

const sleep = (ms: number) => vi.advanceTimersByTimeAsync(ms);

let cleanups: (() => void)[] = [];

function setup(periodicCorrection = true, userId = "member") {
    const engine = new FakeEngine();
    const gateway = new FakeGateway();
    const metrics = new SyncMetrics();
    const coordinator = new PlaybackCoordinator(
        engine as never,
        gateway as never,
        userId,
        new RemotePlaybackGuard(),
        metrics,
        null,
        { clockCorrection: true, periodicCorrection },
    );
    const expected = (s: RoomPlaybackSnapshot) =>
        s.playhead +
        (s.status === "PLAYING" ? (Date.now() - s.lastUpdated) / 1000 : 0);
    cleanups.push(() => {
        coordinator.dispose();
        engine.stop();
    });
    const eventTypes = () => metrics.getEvents().map((e) => e.type);
    return { engine, gateway, coordinator, expected, eventTypes };
}

beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 20, 12) });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
    cleanups.forEach((c) => c());
    cleanups = [];
    vi.useRealTimers();
});

describe("PlaybackCoordinator", () => {
    it("LIFE-01: a late joiner syncs from the room snapshot, recorded as a snapshot", async () => {
        const t = setup();
        // The room has been playing since 60 s, 10 s ago; this player is paused at 0.
        t.gateway.snapshot = {
            status: "PLAYING",
            playhead: 60,
            lastUpdated: Date.now() - 10_000,
        };
        t.coordinator.start();
        await sleep(500);

        const drift = Math.abs(
            t.expected(t.gateway.snapshot) - t.engine.getCurrentTime(),
        );
        expect(t.engine.paused).toBe(false);
        expect(drift).toBeLessThan(0.25);
        expect(t.eventTypes()).toContain("SNAPSHOT_APPLIED");
        expect(t.eventTypes()).not.toContain("COMMAND_RECEIVED");
    });

    it("LIFE-02: a newer snapshot after reconnect is applied; a stale one is ignored", async () => {
        const t = setup();
        t.coordinator.start();
        t.gateway.broadcast({
            action: "PLAY",
            playhead: 10,
            originatorId: "owner",
            serverExecutionTime: Date.now(),
        });
        await sleep(300);

        // A SEEK was missed while offline; the reconnect snapshot carries it.
        const snap = {
            status: "PLAYING" as const,
            playhead: 200,
            lastUpdated: Date.now(),
        };
        t.gateway.stateUpdate(snap);
        await sleep(400);
        expect(
            Math.abs(t.expected(snap) - t.engine.getCurrentTime()),
        ).toBeLessThan(0.25);

        const before = t.engine.seeks.length;
        t.gateway.stateUpdate({
            status: "PAUSED",
            playhead: 5,
            lastUpdated: snap.lastUpdated - 1,
        });
        await sleep(200);
        expect(t.engine.seeks.length).toBe(before);
        expect(t.engine.paused).toBe(false);
    });

    it.each([
        [true, "corrects the stall without a command, never while buffering"],
        [false, "keeps the stall drift (periodicCorrection=off baseline)"],
    ])("ENV-03 periodic=%s %s", async (periodic) => {
        const t = setup(periodic);
        t.coordinator.start();
        const start = Date.now();
        t.gateway.broadcast({
            action: "PLAY",
            playhead: 0,
            originatorId: "owner",
            serverExecutionTime: start,
        });
        await sleep(2500);

        // 2 s of rebuffering with no commands.
        t.engine.stalled = true;
        t.engine.buffering = true;
        const seeksBefore = t.engine.seeks.length;
        await sleep(2000);
        const seeksDuringStall = t.engine.seeks.length - seeksBefore;
        t.engine.stalled = false;
        t.engine.buffering = false;
        await sleep(3500);

        const drift = Math.abs(
            (Date.now() - start) / 1000 - t.engine.getCurrentTime(),
        );
        if (periodic) {
            expect(seeksDuringStall).toBe(0);
            expect(drift).toBeLessThan(0.25);
            expect(t.eventTypes()).toContain("PERIODIC_CORRECTION");
        } else {
            expect(drift).toBeGreaterThan(1.5);
        }
    });

    it("the owner's own seek is not pulled back before its broadcast returns", async () => {
        const t = setup(true, "owner");
        t.coordinator.start();
        t.gateway.broadcast({
            action: "PLAY",
            playhead: 0,
            originatorId: "owner",
            serverExecutionTime: Date.now(),
        });
        await t.engine.play();
        await sleep(3000);

        t.coordinator.noteLocalControl();
        t.engine.seek(300);
        await sleep(1500); // the periodic check runs during this window
        expect(t.engine.getCurrentTime()).toBeGreaterThanOrEqual(299);

        t.gateway.broadcast({
            action: "SEEK",
            playhead: 300,
            originatorId: "owner",
            serverExecutionTime: Date.now() - 1500,
        });
        await sleep(2500);
        expect(Math.abs(300 + 4 - t.engine.getCurrentTime())).toBeLessThan(0.3);
    });

    it("the owner's seek survives a slow broadcast (2.5 s) inside the grace window", async () => {
        const t = setup(true, "owner");
        t.coordinator.start();
        t.gateway.broadcast({
            action: "PLAY",
            playhead: 0,
            originatorId: "owner",
            serverExecutionTime: Date.now(),
        });
        await t.engine.play();
        await sleep(3000);

        t.coordinator.noteLocalControl();
        t.engine.seek(300);
        await sleep(2500);
        expect(t.engine.getCurrentTime()).toBeGreaterThanOrEqual(299);
    });
});
