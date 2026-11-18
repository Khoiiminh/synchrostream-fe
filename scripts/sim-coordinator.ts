/**
 * Behavioural check of PlaybackCoordinator against a simulated player and
 * gateway (no browser). Covers: late join via room snapshot, recovery from a
 * stall without commands (periodic correction), no correction while
 * buffering, the owner's own command not being pulled back, and the
 * periodicCorrection=off baseline.
 *
 *   npx tsx scripts/sim-coordinator.ts
 *
 * Runs in real time (~25 s) because the coordinator uses real timers.
 */
import {
    PlaybackCoordinator,
    RoomPlaybackSnapshot,
} from "../src/core/sync/PlaybackCoordinator";
import { RemotePlaybackGuard } from "../src/core/services/RemotePlaybackGuard";
import { SyncMetrics } from "../src/core/sync/SyncMetrics";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name: string, ok: boolean, detail: string) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
    if (!ok) failures++;
}

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
    const done = () => {
        coordinator.dispose();
        engine.stop();
    };
    return { engine, gateway, metrics, coordinator, expected, done };
}

async function lateJoin() {
    const t = setup();
    // Room has been playing since 60 s, 10 s ago; the member's player is at 0, paused.
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
    check(
        "LIFE-01 late join syncs from snapshot",
        !t.engine.paused && drift < 0.25,
        `playing=${!t.engine.paused}, drift=${(drift * 1000).toFixed(0)} ms`,
    );
    check(
        "LIFE-01 recorded as SNAPSHOT_APPLIED, not a command",
        t.metrics.getEvents().some((e) => e.type === "SNAPSHOT_APPLIED") &&
            !t.metrics.getEvents().some((e) => e.type === "COMMAND_RECEIVED"),
        "events",
    );
    t.done();
}

async function reconnectSnapshot() {
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
    const drift = Math.abs(t.expected(snap) - t.engine.getCurrentTime());
    check(
        "LIFE-02 newer snapshot after reconnect is applied",
        drift < 0.25,
        `drift=${(drift * 1000).toFixed(0)} ms`,
    );
    // An older / equal snapshot must not move the player.
    const before = t.engine.seeks.length;
    t.gateway.stateUpdate({
        status: "PAUSED",
        playhead: 5,
        lastUpdated: snap.lastUpdated - 1,
    });
    await sleep(200);
    check(
        "LIFE-02 stale snapshot ignored",
        t.engine.seeks.length === before && !t.engine.paused,
        `seeks=${t.engine.seeks.length - before}`,
    );
    t.done();
}

async function stallRecovery(periodic: boolean) {
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
    // 2 s stall with no commands (rebuffering): buffering → no correction while it lasts.
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
        check(
            "ENV-03 no corrective seek while buffering",
            seeksDuringStall === 0,
            `seeks=${seeksDuringStall}`,
        );
        check(
            "ENV-03 stall corrected without a command",
            drift < 0.25,
            `drift after=${(drift * 1000).toFixed(0)} ms`,
        );
        check(
            "ENV-03 recorded as PERIODIC_CORRECTION",
            t.metrics.getEvents().some((e) => e.type === "PERIODIC_CORRECTION"),
            "events",
        );
    } else {
        check(
            "baseline periodicCorrection=off keeps the stall drift",
            drift > 1.5,
            `drift after=${(drift * 1000).toFixed(0)} ms`,
        );
    }
    t.done();
}

async function ownerLocalCommand() {
    // Owner: plays at 0, then seeks locally to 300; the broadcast returns 150 ms later.
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
    await sleep(1500); // periodic check runs during this window
    const pulledBack = t.engine.getCurrentTime() < 299;
    t.gateway.broadcast({
        action: "SEEK",
        playhead: 300,
        originatorId: "owner",
        serverExecutionTime: Date.now() - 1500,
    });
    await sleep(2500);
    const drift = Math.abs(300 + 4 - t.engine.getCurrentTime());
    check(
        "owner's own seek is not pulled back before its broadcast returns",
        !pulledBack && drift < 0.3,
        `pulledBack=${pulledBack}, drift=${(drift * 1000).toFixed(0)} ms`,
    );
    t.done();
}

async function main() {
    await lateJoin();
    await reconnectSnapshot();
    await stallRecovery(true);
    await stallRecovery(false);
    await ownerLocalCommand();
    console.log(
        failures ? `\n${failures} check(s) failed` : "\nAll checks passed",
    );
    process.exit(failures ? 1 : 0);
}

const quiet = console.log;
console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && /^(PASS|FAIL|\n)/.test(args[0]))
        quiet(...args);
};
console.error = () => {};
void main();
