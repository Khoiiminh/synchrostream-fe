import { describe, expect, it } from "vitest";
import {
    DEFAULT_ANALYSIS_OPTIONS,
    WITHIN_THRESHOLDS,
    analyzeRun,
    buildDataset,
    buildExportFiles,
    cdf,
    computeStats,
    formatTextReport,
    histogram,
    keyMetrics,
    parseInputText,
    summaryJson,
    withinShares,
    type Rec,
} from "./syncRunAnalysis";

/*
 * syncRunAnalysis is the one implementation behind `npm run analyze:run`
 * and the admin Sync Metrics page. The helpers are checked against hand
 * computed values; the full analysis of a synthetic run (same record format
 * as the backend NDJSON) is pinned by snapshot, so a later move or refactor
 * cannot silently change a reported number.
 */

describe("computeStats", () => {
    it("is null for no values", () => {
        expect(computeStats([])).toBeNull();
    });

    it("uses linear-interpolated percentiles and the population SD", () => {
        const stats = computeStats([4, 1, 3, 2])!;
        expect(stats).toMatchObject({ count: 4, mean: 2.5, p50: 2.5, max: 4 });
        expect(stats.p95).toBeCloseTo(3.85, 10);
        expect(stats.p99).toBeCloseTo(3.97, 10);
        expect(stats.sd).toBeCloseTo(Math.sqrt(1.25), 10);
        expect(computeStats([7])).toMatchObject({ p50: 7, p99: 7, sd: 0 });
    });

    it("does not reorder its input", () => {
        const values = [3, 1, 2];
        computeStats(values);
        expect(values).toEqual([3, 1, 2]);
    });
});

describe("withinShares / thresholds", () => {
    it("counts values at or under each threshold", () => {
        expect(withinShares([10, 50, 51, 600], [50, 500])).toEqual([
            { thresholdMs: 50, share: 0.5 },
            { thresholdMs: 500, share: 0.75 },
        ]);
        expect(withinShares([], [50])).toEqual([{ thresholdMs: 50, share: 0 }]);
    });

    it("always reports 50, 100 and 500 ms plus the tolerance, de-duplicated", () => {
        expect(WITHIN_THRESHOLDS(250)).toEqual([50, 100, 250, 500]);
        expect(WITHIN_THRESHOLDS(100)).toEqual([50, 100, 500]);
    });
});

describe("cdf / histogram", () => {
    it("the CDF ends at share 1 and is downsampled to the point budget", () => {
        expect(cdf([])).toEqual([]);
        expect(cdf([3, 1, 2])).toEqual([
            { valueMs: 1, share: 1 / 3 },
            { valueMs: 2, share: 2 / 3 },
            { valueMs: 3, share: 1 },
        ]);
        const big = cdf(
            Array.from({ length: 1000 }, (_, i) => i),
            10,
        );
        expect(big.length).toBeLessThanOrEqual(11);
        expect(big[big.length - 1]).toEqual({ valueMs: 999, share: 1 });
    });

    it("bins from zero, capped at 200 bins with the tail in the last one", () => {
        expect(histogram([], 10)).toEqual([]);
        expect(histogram([0, 9, 10, 25], 10)).toEqual([
            { fromMs: 0, toMs: 10, count: 2 },
            { fromMs: 10, toMs: 20, count: 1 },
            { fromMs: 20, toMs: 30, count: 1 },
        ]);
        const capped = histogram([0, 10_000], 1);
        expect(capped).toHaveLength(200);
        expect(capped[199].count).toBe(1);
    });
});

describe("parseInputText", () => {
    it("reads backend NDJSON, skipping blank and broken lines", () => {
        expect(
            parseInputText('{"a":1}\n\n{"b":\n{"c":3}\n', "run/u1__s1.ndjson"),
        ).toEqual([{ a: 1 }, { c: 3 }]);
    });

    it("a legacy samples array becomes one client named after the file", () => {
        expect(
            parseInputText('[{"driftMs":1}]', "C:\\runs\\laptop.json"),
        ).toEqual([{ driftMs: 1, clientSessionId: "laptop" }]);
    });

    it("a local export takes the run id from its context", () => {
        expect(
            parseInputText(
                JSON.stringify({
                    context: { runId: "r9" },
                    records: [
                        { x: 1 },
                        { x: 2, runId: "own", clientSessionId: "s" },
                    ],
                }),
                "export.json",
            ),
        ).toEqual([
            { x: 1, runId: "r9", clientSessionId: "export" },
            { x: 2, runId: "own", clientSessionId: "s" },
        ]);
    });

    it("rejects anything else", () => {
        expect(() => parseInputText('{"x":1}', "odd.json")).toThrow(
            "Unrecognized file format: odd.json",
        );
    });
});

// ---------------------------------------------------------------- a synthetic run

const T0 = Date.UTC(2026, 11, 1, 10);
const OWNER = "owner-0001-aaaa";
const MEMBER = "member-0002-bbbb";

/**
 * Two clients, 20 s: PLAY at 0, a SEEK at exactly 5 s (on a sample time),
 * a 600 ms spike on the member at 8 s, PAUSE at 15 s.
 */
function syntheticRun(): Rec[] {
    const records: Rec[] = [];
    const base = (participantId: string, session: string) => ({
        runId: "run-synthetic",
        scenario: "lab",
        participantId,
        clientSessionId: session,
    });
    for (const [pid, session] of [
        [OWNER, "s-owner"],
        [MEMBER, "s-member"],
    ]) {
        records.push({
            ...base(pid, session),
            kind: "client_info",
            userAgent: "test",
        });
        for (const [action, at, playhead] of [
            ["PLAY", 0, 0],
            ["SEEK", 5_000, 5],
            ["PAUSE", 15_000, 15],
        ] as const) {
            if (pid === OWNER)
                records.push({
                    ...base(pid, session),
                    kind: "event",
                    type: "COMMAND_ISSUED",
                    action,
                    serverTimestamp: T0 + at - 20,
                });
            records.push({
                ...base(pid, session),
                kind: "event",
                type: "COMMAND_RECEIVED",
                action,
                playhead,
                originatorId: OWNER,
                serverExecutionTime: T0 + at,
                serverTimestamp: T0 + at + (pid === OWNER ? 15 : 45),
            });
        }
        for (let ms = 250; ms <= 20_000; ms += 250) {
            const playing = ms < 15_000;
            let drift = pid === OWNER ? 8 : 30;
            if (pid === MEMBER && ms >= 8_000 && ms < 9_000) drift = 600;
            if (!playing) drift = 2;
            records.push({
                ...base(pid, session),
                kind: "sample",
                timestamp: T0 + ms - 5_000,
                serverTimestamp: T0 + ms + (pid === OWNER ? 0 : 7),
                driftMs: drift,
                signedDriftMs: pid === OWNER ? drift : -drift,
                uncorrectedDriftMs: drift + 3,
                actualPositionSeconds: Math.min(ms, 15_000) / 1000,
                expectedPositionSeconds: Math.min(ms, 15_000) / 1000,
                playbackState: playing ? "PLAYING" : "PAUSED",
                localPaused: !playing,
                clockRttMs: pid === OWNER ? 12 : 40,
                clockOffsetMs: pid === OWNER ? -3 : 250,
                clockSynced: true,
                controlClock: "server",
                periodicCorrection: true,
            });
        }
    }
    return records;
}

describe("buildDataset", () => {
    it("groups the synthetic run by client, with labels, owners and unique commands", () => {
        const ds = buildDataset(syntheticRun());

        expect(ds.clients).toEqual(["s-member", "s-owner"]);
        expect(ds.labels.get("s-member")).toBe("C1(member-0)");
        expect(ds.labels.get("s-owner")).toBe("C2(owner-00)");
        expect([...ds.owners]).toEqual(["s-owner"]);
        expect(ds.clientInfo.get("s-owner")).toMatchObject({
            userAgent: "test",
        });
        // Both clients received each command; it is counted once.
        expect(ds.commands).toEqual([
            {
                action: "PLAY",
                serverExecutionTime: T0,
                playhead: 0,
                originatorId: OWNER,
            },
            {
                action: "SEEK",
                serverExecutionTime: T0 + 5_000,
                playhead: 5,
                originatorId: OWNER,
            },
            {
                action: "PAUSE",
                serverExecutionTime: T0 + 15_000,
                playhead: 15,
                originatorId: OWNER,
            },
        ]);
        expect(ds.samples).toHaveLength(160);
        expect(ds.runIds).toEqual(["run-synthetic"]);
        expect(ds.scenarios).toEqual(["lab"]);
        expect([ds.t0, ds.t1]).toEqual([T0 + 250, T0 + 20_007]);
    });

    it("prefers server time, and corrects only clock-synced server-stamped samples", () => {
        const ds = buildDataset([
            {
                driftMs: 1,
                timestamp: 10,
                serverTimestamp: 20,
                clockSynced: true,
            },
            { driftMs: 2, timestamp: 30, clockSynced: true },
            { driftMs: 3, timestamp: 40, serverTimestamp: 50 },
            { driftMs: "bad", timestamp: 60 },
        ]);
        expect(ds.samples.map((s) => [s.t, s.corrected])).toEqual([
            [20, true],
            [30, false],
            [50, false],
        ]);
    });
});

describe("analyzeRun (pinned)", () => {
    const ds = buildDataset(syntheticRun());
    const result = analyzeRun(ds, DEFAULT_ANALYSIS_OPTIONS);

    it("the key metrics", () => {
        expect(keyMetrics(result)).toMatchSnapshot();
    });

    it("the summary JSON", () => {
        expect(summaryJson(result)).toMatchSnapshot();
    });

    it("the text report", () => {
        expect(formatTextReport(result)).toMatchSnapshot();
    });

    it("the exported files", () => {
        expect(buildExportFiles(ds, result)).toMatchSnapshot();
    });

    it("a stricter tolerance changes the in-sync shares", () => {
        const strict = analyzeRun(ds, { toleranceMs: 20, settleMs: 2000 });
        expect(keyMetrics(strict)).not.toEqual(keyMetrics(result));
    });
});
