/**
 * Synchronization run analysis — the single implementation used by both the
 * `npm run analyze:run` CLI and the admin Sync Metrics page, so every number
 * shown in the UI is exactly what the reproducible script produces.
 *
 * Pure functions only (no Node or DOM APIs).
 *
 * All times are on the server clock (serverTimestamp / serverExecutionTime),
 * which ClockSync makes comparable across machines; each estimate is only as
 * precise as the client's clock RTT / 2, which is reported alongside.
 */

export type Rec = Record<string, unknown>;

export interface Sample {
    client: string;
    participantId: string;
    t: number; // server time
    driftMs: number;
    signedDriftMs: number | null;
    uncorrectedDriftMs: number | null;
    actual: number;
    expected: number;
    state: "PLAYING" | "PAUSED";
    localPaused: boolean | null;
    clockRttMs: number | null;
    clockOffsetMs: number | null;
    corrected: boolean;
    controlClock: "server" | "local" | "unknown";
    /** Periodic drift correction mode; null for data recorded before it existed. */
    periodicCorrection: boolean | null;
}

export interface SyncEventRecord {
    client: string;
    participantId: string;
    type: string;
    t: number;
    raw: Rec;
}

export interface Stats {
    count: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    sd: number;
}

export interface Command {
    action: string;
    serverExecutionTime: number;
    playhead: number | null;
    originatorId: string | null;
}

export interface Dataset {
    samples: Sample[];
    events: SyncEventRecord[];
    clientInfo: Map<string, Rec>;
    clients: string[];
    labels: Map<string, string>;
    owners: Set<string>;
    runIds: string[];
    scenarios: string[];
    commands: Command[];
    t0: number;
    t1: number;
}

export interface AnalysisOptions {
    /** In-sync threshold (default 250 ms, matches the coordinator). */
    toleranceMs: number;
    /** Window after a command excluded from steady state (default 2000 ms). */
    settleMs: number;
}

export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
    toleranceMs: 250,
    settleMs: 2000,
};

export const WITHIN_THRESHOLDS = (toleranceMs: number) =>
    [...new Set([50, 100, toleranceMs, 500])].sort((a, b) => a - b);

const MATCH_WINDOW_MS = 300;
const SPREAD_BUCKET_MS = 500;
const ACTIONS = ["PLAY", "PAUSE", "SEEK"] as const;

// ---------------------------------------------------------------- input normalization

/**
 * Normalizes one input file (backend NDJSON, local run export, or legacy
 * samples array) into flat records. `fileTag` labels records that carry no
 * clientSessionId (local exports), so each file counts as one client.
 */
export function parseInputText(text: string, fileName: string): Rec[] {
    const fileTag = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
    if (fileName.endsWith(".ndjson")) {
        return text
            .split("\n")
            .filter((l) => l.trim())
            .flatMap((l) => {
                try {
                    return [JSON.parse(l) as Rec];
                } catch {
                    return [];
                }
            });
    }
    const json = JSON.parse(text);
    if (Array.isArray(json)) {
        return json.map((r: Rec) => ({
            ...r,
            clientSessionId: r.clientSessionId ?? fileTag,
        }));
    }
    if (json && Array.isArray(json.records)) {
        return (json.records as Rec[]).map((r) => ({
            ...r,
            runId: r.runId ?? json.context?.runId ?? json.runId,
            clientSessionId: r.clientSessionId ?? fileTag,
        }));
    }
    throw new Error(`Unrecognized file format: ${fileName}`);
}

const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

export function buildDataset(records: Rec[]): Dataset {
    const samples: Sample[] = [];
    const events: SyncEventRecord[] = [];
    const clientInfo = new Map<string, Rec>();

    for (const r of records) {
        const participantId = String(r.participantId ?? "unknown");
        const client = String(r.clientSessionId ?? participantId);

        if (r.kind === "client_info") {
            clientInfo.set(client, r);
            continue;
        }
        if (r.kind === "event") {
            const t = num(r.serverTimestamp) ?? num(r.timestamp);
            if (t !== null)
                events.push({
                    client,
                    participantId,
                    type: String(r.type),
                    t,
                    raw: r,
                });
            continue;
        }
        const drift = num(r.driftMs);
        const localT = num(r.timestamp);
        if (drift === null || localT === null) continue;
        const serverT = num(r.serverTimestamp);
        samples.push({
            client,
            participantId,
            t: serverT ?? localT,
            driftMs: drift,
            signedDriftMs: num(r.signedDriftMs),
            uncorrectedDriftMs: num(r.uncorrectedDriftMs),
            actual: num(r.actualPositionSeconds) ?? 0,
            expected: num(r.expectedPositionSeconds) ?? 0,
            state: r.playbackState === "PLAYING" ? "PLAYING" : "PAUSED",
            localPaused:
                typeof r.localPaused === "boolean" ? r.localPaused : null,
            clockRttMs: num(r.clockRttMs),
            clockOffsetMs: num(r.clockOffsetMs),
            corrected: serverT !== null && r.clockSynced === true,
            controlClock:
                r.controlClock === "server" || r.controlClock === "local"
                    ? r.controlClock
                    : "unknown",
            periodicCorrection:
                typeof r.periodicCorrection === "boolean"
                    ? r.periodicCorrection
                    : null,
        });
    }

    samples.sort((a, b) => a.t - b.t);
    events.sort((a, b) => a.t - b.t);

    const clients = [
        ...new Set([
            ...samples.map((s) => s.client),
            ...events.map((e) => e.client),
        ]),
    ].sort();
    const labels = new Map(
        clients.map((c, i) => {
            const pid =
                samples.find((s) => s.client === c)?.participantId ??
                events.find((e) => e.client === c)?.participantId ??
                "?";
            return [c, `C${i + 1}(${pid.slice(0, 8)})`];
        }),
    );
    const owners = new Set(
        events.filter((e) => e.type === "COMMAND_ISSUED").map((e) => e.client),
    );

    const commandMap = new Map<string, Command>();
    for (const e of events) {
        if (e.type !== "COMMAND_RECEIVED") continue;
        const set = num(e.raw.serverExecutionTime);
        if (set === null) continue;
        const key = `${e.raw.action}@${set}`;
        if (!commandMap.has(key)) {
            commandMap.set(key, {
                action: String(e.raw.action),
                serverExecutionTime: set,
                playhead: num(e.raw.playhead),
                originatorId:
                    typeof e.raw.originatorId === "string"
                        ? e.raw.originatorId
                        : null,
            });
        }
    }
    const commands = [...commandMap.values()].sort(
        (a, b) => a.serverExecutionTime - b.serverExecutionTime,
    );

    const strings = (key: string) => [
        ...new Set(
            records
                .map((r) => r[key])
                .filter(
                    (v): v is string => typeof v === "string" && v.length > 0,
                ),
        ),
    ];

    return {
        samples,
        events,
        clientInfo,
        clients,
        labels,
        owners,
        runIds: strings("runId"),
        scenarios: strings("scenario"),
        commands,
        // The run span is the sampled span; events only when there are no samples.
        t0: samples[0]?.t ?? events[0]?.t ?? 0,
        t1: samples[samples.length - 1]?.t ?? events[events.length - 1]?.t ?? 0,
    };
}

// ---------------------------------------------------------------- stats

export function computeStats(values: number[]): Stats | null {
    if (values.length === 0) return null;
    const v = [...values].sort((a, b) => a - b);
    const pct = (p: number) => {
        const idx = (p / 100) * (v.length - 1);
        const lo = Math.floor(idx),
            hi = Math.ceil(idx);
        return v[lo] + (v[hi] - v[lo]) * (idx - lo);
    };
    const mean = v.reduce((s, x) => s + x, 0) / v.length;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
    return {
        count: v.length,
        mean,
        p50: pct(50),
        p95: pct(95),
        p99: pct(99),
        max: v[v.length - 1],
        sd,
    };
}

export function withinShares(
    values: number[],
    thresholds: number[],
): { thresholdMs: number; share: number }[] {
    return thresholds.map((t) => ({
        thresholdMs: t,
        share: values.length
            ? values.filter((v) => v <= t).length / values.length
            : 0,
    }));
}

/** Empirical CDF downsampled to at most `points` points (for charts). */
export function cdf(
    values: number[],
    points = 200,
): { valueMs: number; share: number }[] {
    if (values.length === 0) return [];
    const v = [...values].sort((a, b) => a - b);
    const step = Math.max(1, Math.floor(v.length / points));
    const out: { valueMs: number; share: number }[] = [];
    for (let i = 0; i < v.length; i += step)
        out.push({ valueMs: v[i], share: (i + 1) / v.length });
    if (out[out.length - 1]?.share !== 1)
        out.push({ valueMs: v[v.length - 1], share: 1 });
    return out;
}

export function histogram(
    values: number[],
    binMs: number,
): { fromMs: number; toMs: number; count: number }[] {
    if (values.length === 0) return [];
    const max = Math.max(...values);
    const bins = Math.min(200, Math.floor(max / binMs) + 1);
    const counts = new Array(bins).fill(0);
    for (const v of values) counts[Math.min(bins - 1, Math.floor(v / binMs))]++;
    return counts.map((count, i) => ({
        fromMs: i * binMs,
        toMs: (i + 1) * binMs,
        count,
    }));
}

// ---------------------------------------------------------------- analysis

export interface ClientSummary {
    client: string;
    label: string;
    owner: boolean;
    userAgent: string;
    controlClocks: string[];
    clock: {
        bursts: number;
        offsetMeanMs: number | null;
        offsetRangeMs: number | null;
        rttP50Ms: number | null;
        rttMaxMs: number | null;
    };
    driftAll: Stats | null;
    driftSteady: Stats | null;
    uncorrectedSteady: Stats | null;
    signedSteadyMean: number | null;
    withinSteady: { thresholdMs: number; share: number }[];
}

export interface RecoveryRow {
    command: string;
    action: string;
    client: string;
    serverExecutionTime: number;
    recoveryMs: number | null;
    censored: boolean;
}

export interface AnalysisResult {
    options: AnalysisOptions;
    runIds: string[];
    scenarios: string[];
    durationS: number;
    t0: number;
    sampleCount: number;
    eventCount: number;
    commandCount: number;
    uncorrectedSampleCount: number;
    controlClock: string[];
    mixedControlClock: boolean;
    /** "on" / "off"; empty for data recorded before periodic correction existed. */
    periodicCorrection: string[];
    mixedPeriodicCorrection: boolean;
    clients: ClientSummary[];
    allSteady: Stats | null;
    allSteadyWithin: { thresholdMs: number; share: number }[];
    interClient: {
        pairs: { pair: string; all: Stats | null; steady: Stats | null }[];
        allPairsSteady: Stats | null;
        allPairsWithin: { thresholdMs: number; share: number }[];
        groupSpreadSteady: Stats | null;
        groupSpreadAll: Stats | null;
    };
    latency: {
        issueToServer: Stats | null;
        serverToReceive: Stats | null;
        applyByAction: Record<string, Stats | null>;
        correctionSeeks: number;
        /** Correction seeks triggered by the periodic check (between commands). */
        periodicCorrectionSeeks: number;
        /** Periodic checks that found drift or a wrong play state and reconciled. */
        periodicCorrections: number;
        supersededCommands: number;
        reconcileFailures: number;
    };
    /**
     * Join / reconnect synchronization: time from applying a room snapshot
     * until the client is within tolerance (2 consecutive samples).
     */
    snapshotSync: {
        rows: {
            client: string;
            trigger: string;
            appliedAt: number;
            syncMs: number | null;
        }[];
        stats: Stats | null;
        notSynced: number;
    };
    recovery: {
        rows: RecoveryRow[];
        byAction: Record<string, Stats | null>;
        notRecoveredByAction: Record<
            string,
            { notRecovered: number; total: number }
        >;
        group: Stats | null;
        censored: number;
        total: number;
    };
    series: {
        spread: {
            t: number;
            relS: number;
            spreadMs: number;
            clients: number;
            steady: boolean;
        }[];
        commands: { relS: number; action: string }[];
        /** Drift CDF, steady state, all clients. */
        driftCdf: { valueMs: number; share: number }[];
        /** Inter-client drift CDF, steady state, all pairs. */
        pairCdf: { valueMs: number; share: number }[];
        recoveryHistogram: { fromMs: number; toMs: number; count: number }[];
    };
}

export function analyzeRun(
    ds: Dataset,
    options: AnalysisOptions = DEFAULT_ANALYSIS_OPTIONS,
): AnalysisResult {
    const { toleranceMs, settleMs } = options;
    const thresholds = WITHIN_THRESHOLDS(toleranceMs);
    const { samples, events, clients, labels, owners, commands } = ds;
    const commandTimes = commands.map((c) => c.serverExecutionTime);

    const lastCommandBefore = (t: number): number | null => {
        let lo = 0,
            hi = commandTimes.length - 1,
            ans: number | null = null;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (commandTimes[mid] <= t) {
                ans = commandTimes[mid];
                lo = mid + 1;
            } else hi = mid - 1;
        }
        return ans;
    };
    const isSteadyAt = (t: number) => {
        const last = lastCommandBefore(t);
        return last === null || t - last >= settleMs;
    };

    const byClient = new Map(
        clients.map((c) => [c, samples.filter((s) => s.client === c)]),
    );

    // Clients: clock + drift vs expected.
    const clientRows: ClientSummary[] = clients.map((c) => {
        const syncs = events.filter(
            (e) => e.client === c && e.type === "CLOCK_SYNC",
        );
        const offsets = syncs
            .map((e) => num(e.raw.offsetMs))
            .filter((x): x is number => x !== null);
        const rtts = syncs
            .map((e) => num(e.raw.rttMs))
            .filter((x): x is number => x !== null);
        const os = computeStats(offsets),
            rs = computeStats(rtts);

        const own = byClient.get(c)!;
        const playing = own.filter((s) => s.state === "PLAYING");
        const steady = playing.filter((s) => isSteadyAt(s.t));
        const info = ds.clientInfo.get(c);
        const uaRaw = typeof info?.userAgent === "string" ? info.userAgent : "";
        const uaMatch = /(Edg|Firefox|Chrome|Version)\/([\d.]+)/.exec(uaRaw);

        return {
            client: c,
            label: labels.get(c)!,
            owner: owners.has(c),
            userAgent: uaMatch
                ? `${uaMatch[1] === "Version" ? "Safari" : uaMatch[1]} ${uaMatch[2]}`
                : "",
            controlClocks: [...new Set(own.map((s) => s.controlClock))],
            clock: {
                bursts: syncs.length,
                offsetMeanMs: os?.mean ?? null,
                offsetRangeMs: offsets.length
                    ? Math.max(...offsets) - Math.min(...offsets)
                    : null,
                rttP50Ms: rs?.p50 ?? null,
                rttMaxMs: rs?.max ?? null,
            },
            driftAll: computeStats(playing.map((s) => s.driftMs)),
            driftSteady: computeStats(steady.map((s) => s.driftMs)),
            uncorrectedSteady: computeStats(
                steady
                    .map((s) => s.uncorrectedDriftMs)
                    .filter((x): x is number => x !== null),
            ),
            signedSteadyMean:
                computeStats(
                    steady
                        .map((s) => s.signedDriftMs)
                        .filter((x): x is number => x !== null),
                )?.mean ?? null,
            withinSteady: withinShares(
                steady.map((s) => s.driftMs),
                thresholds,
            ),
        };
    });

    const allSteadyValues = samples
        .filter((s) => s.state === "PLAYING" && isSteadyAt(s.t))
        .map((s) => s.driftMs);

    // Inter-client drift.
    const positionAt = (list: Sample[], t: number): number | null => {
        let lo = 0,
            hi = list.length - 1;
        if (hi < 0) return null;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (list[mid].t < t) lo = mid + 1;
            else hi = mid;
        }
        const cands = [list[lo], list[lo - 1]].filter(Boolean) as Sample[];
        const s = cands.reduce((a, b) =>
            Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b,
        );
        if (Math.abs(s.t - t) > MATCH_WINDOW_MS) return null;
        if (s.state !== "PLAYING" || s.localPaused === true) return null;
        return s.actual + (t - s.t) / 1000;
    };

    const pairs: AnalysisResult["interClient"]["pairs"] = [];
    const pairwiseSteady: number[] = [];
    for (let i = 0; i < clients.length; i++) {
        for (let j = i + 1; j < clients.length; j++) {
            const a = byClient.get(clients[i])!,
                b = byClient.get(clients[j])!;
            const diffs: number[] = [],
                steadyDiffs: number[] = [];
            for (const s of a) {
                if (s.state !== "PLAYING" || s.localPaused === true) continue;
                const pb = positionAt(b, s.t);
                if (pb === null) continue;
                const d = Math.abs(s.actual - pb) * 1000;
                diffs.push(d);
                if (isSteadyAt(s.t)) steadyDiffs.push(d);
            }
            pairwiseSteady.push(...steadyDiffs);
            pairs.push({
                pair: `${labels.get(clients[i])} ↔ ${labels.get(clients[j])}`,
                all: computeStats(diffs),
                steady: computeStats(steadyDiffs),
            });
        }
    }

    const spread: AnalysisResult["series"]["spread"] = [];
    if (clients.length >= 2 && samples.length) {
        for (let t = ds.t0; t <= ds.t1; t += SPREAD_BUCKET_MS) {
            const pos = clients
                .map((c) => positionAt(byClient.get(c)!, t))
                .filter((x): x is number => x !== null);
            if (pos.length >= 2) {
                spread.push({
                    t,
                    relS: (t - ds.t0) / 1000,
                    spreadMs: (Math.max(...pos) - Math.min(...pos)) * 1000,
                    clients: pos.length,
                    steady: isSteadyAt(t),
                });
            }
        }
    }

    // Latency.
    const issued = events.filter((e) => e.type === "COMMAND_ISSUED");
    const received = events.filter((e) => e.type === "COMMAND_RECEIVED");
    const applied = events.filter((e) => e.type === "COMMAND_APPLIED");
    const issueToServer: number[] = [];
    for (const e of issued) {
        const match = commands.find(
            (c) =>
                c.action === e.raw.action &&
                c.serverExecutionTime >= e.t - 50 &&
                c.serverExecutionTime - e.t < 2000,
        );
        if (match) issueToServer.push(match.serverExecutionTime - e.t);
    }
    const delivery = received
        .filter((e) => e.raw.selfOriginated !== true)
        .map((e) => num(e.raw.deliveryDelayMs))
        .filter((x): x is number => x !== null);
    const applyFor = (action: string) =>
        applied
            .filter(
                (e) =>
                    e.raw.action === action &&
                    !owners.has(e.client) &&
                    e.raw.origin !== "snapshot",
            )
            .map((e) => num(e.raw.applyDurationMs))
            .filter((x): x is number => x !== null);

    // Recovery.
    const rows: RecoveryRow[] = [];
    commands.forEach((cmd, idx) => {
        const next = commands[idx + 1]?.serverExecutionTime ?? Infinity;
        for (const c of clients) {
            const list = byClient
                .get(c)!
                .filter((s) => s.t >= cmd.serverExecutionTime && s.t < next);
            if (list.length === 0) continue;
            let rec: number | null = null;
            for (let k = 0; k + 1 < list.length; k++) {
                if (
                    list[k].driftMs <= toleranceMs &&
                    list[k + 1].driftMs <= toleranceMs
                ) {
                    rec = list[k].t - cmd.serverExecutionTime;
                    break;
                }
            }
            rows.push({
                command: `${cmd.action}@${cmd.serverExecutionTime}`,
                action: cmd.action,
                client: labels.get(c)!,
                serverExecutionTime: cmd.serverExecutionTime,
                recoveryMs: rec,
                censored: rec === null,
            });
        }
    });
    const groupRec = new Map<string, number | null>();
    for (const r of rows) {
        const prev = groupRec.get(r.command);
        if (prev === undefined) groupRec.set(r.command, r.recoveryMs);
        else
            groupRec.set(
                r.command,
                prev === null || r.recoveryMs === null
                    ? null
                    : Math.max(prev, r.recoveryMs),
            );
    }
    const recoveredValues = rows
        .filter((r) => r.recoveryMs !== null)
        .map((r) => r.recoveryMs!);

    const controlModes = [
        ...new Set(
            samples.map((s) => s.controlClock).filter((m) => m !== "unknown"),
        ),
    ];
    const periodicModes = [
        ...new Set(
            samples
                .map((s) => s.periodicCorrection)
                .filter((m): m is boolean => m !== null),
        ),
    ].map((m) => (m ? "on" : "off"));

    const snapshotRows: AnalysisResult["snapshotSync"]["rows"] = [];
    for (const e of events.filter((ev) => ev.type === "SNAPSHOT_APPLIED")) {
        const list = byClient.get(e.client) ?? [];
        const nextCommand =
            commands.find((c) => c.serverExecutionTime > e.t)
                ?.serverExecutionTime ?? Infinity;
        const after = list.filter((s) => s.t >= e.t && s.t < nextCommand);
        let syncMs: number | null = null;
        for (let k = 0; k + 1 < after.length; k++) {
            if (
                after[k].driftMs <= toleranceMs &&
                after[k + 1].driftMs <= toleranceMs
            ) {
                syncMs = after[k].t - e.t;
                break;
            }
        }
        snapshotRows.push({
            client: labels.get(e.client)!,
            trigger: String(e.raw.trigger ?? ""),
            appliedAt: e.t,
            syncMs,
        });
    }

    return {
        options,
        runIds: ds.runIds,
        scenarios: ds.scenarios,
        durationS: Number.isFinite(ds.t1 - ds.t0) ? (ds.t1 - ds.t0) / 1000 : 0,
        t0: ds.t0,
        sampleCount: samples.length,
        eventCount: events.length,
        commandCount: commands.length,
        uncorrectedSampleCount: samples.filter((s) => !s.corrected).length,
        controlClock: controlModes,
        mixedControlClock: controlModes.length > 1,
        periodicCorrection: periodicModes,
        mixedPeriodicCorrection: periodicModes.length > 1,
        clients: clientRows,
        allSteady: computeStats(allSteadyValues),
        allSteadyWithin: withinShares(allSteadyValues, thresholds),
        interClient: {
            pairs,
            allPairsSteady: computeStats(pairwiseSteady),
            allPairsWithin: withinShares(pairwiseSteady, thresholds),
            groupSpreadSteady: computeStats(
                spread.filter((s) => s.steady).map((s) => s.spreadMs),
            ),
            groupSpreadAll: computeStats(spread.map((s) => s.spreadMs)),
        },
        latency: {
            issueToServer: computeStats(issueToServer),
            serverToReceive: computeStats(delivery),
            applyByAction: Object.fromEntries(
                ACTIONS.map((a) => [a, computeStats(applyFor(a))]),
            ),
            correctionSeeks: events.filter((e) => e.type === "CORRECTION_SEEK")
                .length,
            periodicCorrectionSeeks: events.filter(
                (e) =>
                    e.type === "CORRECTION_SEEK" && e.raw.origin === "periodic",
            ).length,
            periodicCorrections: events.filter(
                (e) => e.type === "PERIODIC_CORRECTION",
            ).length,
            supersededCommands: applied.reduce(
                (s, e) => s + (num(e.raw.supersededCount) ?? 0),
                0,
            ),
            reconcileFailures: events.filter(
                (e) => e.type === "RECONCILE_FAILED",
            ).length,
        },
        snapshotSync: {
            rows: snapshotRows,
            stats: computeStats(
                snapshotRows
                    .filter((r) => r.syncMs !== null)
                    .map((r) => r.syncMs!),
            ),
            notSynced: snapshotRows.filter((r) => r.syncMs === null).length,
        },
        recovery: {
            rows,
            byAction: Object.fromEntries(
                ACTIONS.map((a) => [
                    a,
                    computeStats(
                        rows
                            .filter(
                                (r) => r.action === a && r.recoveryMs !== null,
                            )
                            .map((r) => r.recoveryMs!),
                    ),
                ]),
            ),
            notRecoveredByAction: Object.fromEntries(
                ACTIONS.map((a) => {
                    const rs = rows.filter((r) => r.action === a);
                    return [
                        a,
                        {
                            notRecovered: rs.filter((r) => r.censored).length,
                            total: rs.length,
                        },
                    ];
                }),
            ),
            group: computeStats(
                [...groupRec.values()].filter((x): x is number => x !== null),
            ),
            censored: rows.filter((r) => r.censored).length,
            total: rows.length,
        },
        series: {
            spread,
            commands: commands.map((c) => ({
                relS: (c.serverExecutionTime - ds.t0) / 1000,
                action: c.action,
            })),
            driftCdf: cdf(allSteadyValues),
            pairCdf: cdf(pairwiseSteady),
            recoveryHistogram: histogram(recoveredValues, 100),
        },
    };
}

/** Per-client drift time series for charts, downsampled to ~maxPoints per client. */
export function driftSeries(
    ds: Dataset,
    maxPoints = 1500,
): Record<string, number | null>[] {
    const step = Math.max(1, Math.ceil(ds.samples.length / maxPoints));
    const rows: Record<string, number | null>[] = [];
    for (let i = 0; i < ds.samples.length; i += step) {
        const s = ds.samples[i];
        rows.push({
            relS: Number(((s.t - ds.t0) / 1000).toFixed(2)),
            [ds.labels.get(s.client)!]: Number(s.driftMs.toFixed(1)),
        });
    }
    return rows;
}

// ---------------------------------------------------------------- export tables

function toCsv(rows: readonly object[]): string {
    if (rows.length === 0) return "";
    const cols = Object.keys(rows[0]);
    const esc = (v: unknown) => {
        const s =
            v === null || v === undefined
                ? ""
                : typeof v === "object"
                  ? JSON.stringify(v)
                  : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return (
        [
            cols.join(","),
            ...rows.map((r) => {
                const values = new Map<string, unknown>(Object.entries(r));
                return cols.map((c) => esc(values.get(c))).join(",");
            }),
        ].join("\n") + "\n"
    );
}

const EVENT_META_KEYS = new Set([
    "kind",
    "type",
    "timestamp",
    "serverTimestamp",
    "participantId",
    "clientSessionId",
    "runId",
    "scenario",
    "roomId",
    "serverReceivedAt",
    "action",
]);

/** The exact files written by `analyze:run --out`. */
export function buildExportFiles(
    ds: Dataset,
    result: AnalysisResult,
): Record<string, string> {
    const settle = result.options.settleMs;
    const commandTimes = ds.commands.map((c) => c.serverExecutionTime);
    const steadyAt = (t: number) => {
        const last = [...commandTimes].reverse().find((ct) => ct <= t);
        return last === undefined || t - last >= settle;
    };

    return {
        "samples.csv": toCsv(
            ds.samples.map((s) => ({
                client: ds.labels.get(s.client),
                serverTimeMs: s.t,
                relTimeS: ((s.t - ds.t0) / 1000).toFixed(3),
                state: s.state,
                localPaused: s.localPaused,
                driftMs: s.driftMs.toFixed(2),
                signedDriftMs: s.signedDriftMs?.toFixed(2),
                uncorrectedDriftMs: s.uncorrectedDriftMs?.toFixed(2),
                actualS: s.actual,
                expectedS: s.expected,
                clockOffsetMs: s.clockOffsetMs,
                clockRttMs: s.clockRttMs,
                controlClock: s.controlClock,
                periodicCorrection: s.periodicCorrection,
                steady: steadyAt(s.t),
            })),
        ),
        "events.csv": toCsv(
            ds.events.map((e) => ({
                client: ds.labels.get(e.client),
                type: e.type,
                serverTimeMs: e.t,
                relTimeS: ((e.t - ds.t0) / 1000).toFixed(3),
                action: e.raw.action ?? "",
                details: Object.fromEntries(
                    Object.entries(e.raw).filter(
                        ([k]) => !EVENT_META_KEYS.has(k),
                    ),
                ),
            })),
        ),
        "group-spread.csv": toCsv(
            result.series.spread.map((s) => ({
                serverTimeMs: s.t,
                relTimeS: s.relS.toFixed(3),
                spreadMs: s.spreadMs.toFixed(2),
                clients: s.clients,
                steady: s.steady,
            })),
        ),
        "recovery.csv": toCsv(result.recovery.rows),
        "summary.json": JSON.stringify(summaryJson(result), null, 2),
    };
}

export function summaryJson(result: AnalysisResult): Rec {
    // Time series and per-command rows are exported as CSV; keep summary.json compact.
    const rest: Rec = { ...result };
    delete rest.series;
    const recoverySummary: Rec = { ...result.recovery };
    delete recoverySummary.rows;
    return { ...rest, recovery: recoverySummary };
}

// ---------------------------------------------------------------- text report

const f = (x: number | null | undefined, d = 1) =>
    x === null || x === undefined || !Number.isFinite(x) ? "-" : x.toFixed(d);

function statsRow(name: string, s: Stats | null): string {
    if (!s) return `${name.padEnd(34)} (no data)`;
    return `${name.padEnd(34)} n=${String(s.count).padStart(5)}  mean=${f(s.mean).padStart(7)}  p50=${f(s.p50).padStart(7)}  p95=${f(s.p95).padStart(7)}  p99=${f(s.p99).padStart(7)}  max=${f(s.max).padStart(7)}  sd=${f(s.sd).padStart(6)}`;
}

const within = (w: { thresholdMs: number; share: number }[]) =>
    w
        .map((x) => `≤${x.thresholdMs}ms ${(100 * x.share).toFixed(1)}%`)
        .join("  ");

export function formatTextReport(r: AnalysisResult): string {
    const L: string[] = [];
    const tol = r.options.toleranceMs;
    L.push("", "=== SynchroStream sync run analysis ===");
    L.push(
        `Run(s):     ${r.runIds.join(", ") || "(unlabelled)"}${r.scenarios.length ? `   scenario: ${r.scenarios.join(", ")}` : ""}`,
    );
    L.push(
        `Duration:   ${r.durationS.toFixed(1)} s   samples=${r.sampleCount}  events=${r.eventCount}  commands=${r.commandCount}`,
    );
    L.push(`Tolerance:  ${tol} ms   settle window: ${r.options.settleMs} ms`);
    L.push("Clients:");
    for (const c of r.clients) {
        L.push(
            `  ${c.label}${c.owner ? " [owner]" : ""}  session=${c.client}  ${c.userAgent}  control clock: ${c.controlClocks.join("/") || "-"}`,
        );
    }
    L.push(
        `Control clock: ${r.controlClock.length === 0 ? "unknown (pre-correction data: local clock)" : r.controlClock.join(" + ")}`,
    );
    if (r.mixedControlClock)
        L.push(
            "! Clients ran different control-clock modes in this run; compare modes in separate runs.",
        );
    L.push(
        `Periodic correction: ${r.periodicCorrection.length === 0 ? "unknown (data recorded before it existed: off)" : r.periodicCorrection.join(" + ")}`,
    );
    if (r.mixedPeriodicCorrection)
        L.push(
            "! Clients ran different periodic-correction modes in this run; compare modes in separate runs.",
        );
    if (r.uncorrectedSampleCount > 0) {
        L.push(
            "",
            `! ${r.uncorrectedSampleCount} samples have no clock correction (legacy data or before the first clock sync); their drift includes clock skew.`,
        );
    }

    L.push("", "--- 1. Clock synchronization (offset = server − client) ---");
    for (const c of r.clients) {
        L.push(
            `  ${c.label.padEnd(16)} bursts=${c.clock.bursts}  offset mean=${f(c.clock.offsetMeanMs)} ms (range ${f(c.clock.offsetRangeMs)})  best-probe RTT p50=${f(c.clock.rttP50Ms)} ms → uncertainty ≈ ±${f(c.clock.rttP50Ms !== null ? c.clock.rttP50Ms / 2 : null)} ms`,
        );
    }

    L.push(
        "",
        "--- 2. Drift from the expected timeline (server clock), PLAYING ---",
    );
    for (const c of r.clients) {
        L.push(statsRow(`  ${c.label} all`, c.driftAll));
        L.push(statsRow(`  ${c.label} steady`, c.driftSteady));
        L.push(`  ${"".padEnd(32)} ${within(c.withinSteady)}`);
        if (c.uncorrectedSteady)
            L.push(
                `  ${"".padEnd(32)} without clock correction: mean=${f(c.uncorrectedSteady.mean)} p95=${f(c.uncorrectedSteady.p95)} ms   signed mean=${f(c.signedSteadyMean)} ms (+ = behind)`,
            );
    }
    L.push(statsRow("  ALL CLIENTS steady", r.allSteady));
    L.push(`  ${"".padEnd(32)} ${within(r.allSteadyWithin)}`);

    L.push(
        "",
        "--- 3. Inter-client drift: |position(A) − position(B)| at the same server time ---",
    );
    for (const p of r.interClient.pairs)
        L.push(statsRow(`  ${p.pair}`, p.steady));
    if (r.clients.length < 2)
        L.push("  (needs at least two clients in the run)");
    else {
        L.push(statsRow("  ALL PAIRS steady", r.interClient.allPairsSteady));
        L.push(`  ${"".padEnd(32)} ${within(r.interClient.allPairsWithin)}`);
        L.push(
            statsRow(
                "  GROUP SPREAD (max−min) steady",
                r.interClient.groupSpreadSteady,
            ),
        );
    }

    L.push("", "--- 4. Command pipeline latency ---");
    L.push(statsRow("  owner issue → server stamp", r.latency.issueToServer));
    L.push(
        statsRow("  server stamp → client receive", r.latency.serverToReceive),
    );
    for (const a of ACTIONS)
        L.push(
            statsRow(`  receive → applied (${a})`, r.latency.applyByAction[a]),
        );
    L.push(
        `  correction seeks=${r.latency.correctionSeeks} (periodic ${r.latency.periodicCorrectionSeeks})  periodic reconciliations=${r.latency.periodicCorrections}  superseded (coalesced) commands=${r.latency.supersededCommands}  reconcile failures=${r.latency.reconcileFailures}`,
    );

    L.push(
        "",
        `--- 5. Recovery time: server stamp → drift ≤ ${tol} ms (2 consecutive samples) ---`,
    );
    for (const a of ACTIONS) {
        const nr = r.recovery.notRecoveredByAction[a];
        L.push(
            statsRow(`  ${a}`, r.recovery.byAction[a]) +
                (nr.total
                    ? `  not recovered before next command: ${nr.notRecovered}/${nr.total}`
                    : ""),
        );
    }
    L.push(statsRow("  GROUP (slowest client)", r.recovery.group));
    if (r.snapshotSync.rows.length) {
        L.push(
            statsRow(
                "  JOIN/RECONNECT (snapshot → in sync)",
                r.snapshotSync.stats,
            ) +
                `  not in sync before next command: ${r.snapshotSync.notSynced}/${r.snapshotSync.rows.length}`,
        );
    }
    L.push(
        "  Note: clients sample at 100 ms for 3 s after each command (500 ms otherwise), so resolution is ~100 ms.",
    );
    L.push("");
    return L.join("\n");
}

// ---------------------------------------------------------------- headline metrics

export interface KeyMetric {
    key: string;
    label: string;
    unit: "ms" | "%" | "count" | "s" | "text";
    value: number | string | null;
    /** For comparisons: whether lower values are better. */
    lowerIsBetter?: boolean;
}

/** The headline numbers used by summary cards, run comparison and thesis tables. */
export function keyMetrics(r: AnalysisResult): KeyMetric[] {
    const tol = r.options.toleranceMs;
    const pairWithin = r.interClient.allPairsWithin.find(
        (w) => w.thresholdMs === tol,
    )?.share;
    const driftWithin = r.allSteadyWithin.find(
        (w) => w.thresholdMs === tol,
    )?.share;
    const rtts = r.clients
        .map((c) => c.clock.rttP50Ms)
        .filter((x): x is number => x !== null);
    return [
        {
            key: "clients",
            label: "Clients",
            unit: "count",
            value: r.clients.length,
        },
        { key: "duration", label: "Duration", unit: "s", value: r.durationS },
        {
            key: "controlClock",
            label: "Control clock",
            unit: "text",
            value: r.controlClock.join(" + ") || "unknown",
        },
        {
            key: "periodicCorrection",
            label: "Periodic correction",
            unit: "text",
            value: r.periodicCorrection.join(" + ") || "unknown",
        },
        {
            key: "pairP50",
            label: "Inter-client drift p50",
            unit: "ms",
            value: r.interClient.allPairsSteady?.p50 ?? null,
            lowerIsBetter: true,
        },
        {
            key: "pairP95",
            label: "Inter-client drift p95",
            unit: "ms",
            value: r.interClient.allPairsSteady?.p95 ?? null,
            lowerIsBetter: true,
        },
        {
            key: "pairMax",
            label: "Inter-client drift max",
            unit: "ms",
            value: r.interClient.allPairsSteady?.max ?? null,
            lowerIsBetter: true,
        },
        {
            key: "pairWithin",
            label: `Pairs within ${tol} ms`,
            unit: "%",
            value:
                pairWithin !== undefined && r.interClient.allPairsSteady
                    ? pairWithin * 100
                    : null,
            lowerIsBetter: false,
        },
        {
            key: "spreadP95",
            label: "Group spread p95",
            unit: "ms",
            value: r.interClient.groupSpreadSteady?.p95 ?? null,
            lowerIsBetter: true,
        },
        {
            key: "driftP50",
            label: "Drift vs expected p50",
            unit: "ms",
            value: r.allSteady?.p50 ?? null,
            lowerIsBetter: true,
        },
        {
            key: "driftP95",
            label: "Drift vs expected p95",
            unit: "ms",
            value: r.allSteady?.p95 ?? null,
            lowerIsBetter: true,
        },
        {
            key: "driftWithin",
            label: `Samples within ${tol} ms`,
            unit: "%",
            value:
                driftWithin !== undefined && r.allSteady
                    ? driftWithin * 100
                    : null,
            lowerIsBetter: false,
        },
        {
            key: "recoveryP50",
            label: "Group recovery p50",
            unit: "ms",
            value: r.recovery.group?.p50 ?? null,
            lowerIsBetter: true,
        },
        {
            key: "recoveryP95",
            label: "Group recovery p95",
            unit: "ms",
            value: r.recovery.group?.p95 ?? null,
            lowerIsBetter: true,
        },
        {
            key: "notRecovered",
            label: "Not recovered before next command",
            unit: "count",
            value: r.recovery.censored,
            lowerIsBetter: true,
        },
        {
            key: "deliveryP50",
            label: "Server → client delivery p50",
            unit: "ms",
            value: r.latency.serverToReceive?.p50 ?? null,
            lowerIsBetter: true,
        },
        {
            key: "deliveryP95",
            label: "Server → client delivery p95",
            unit: "ms",
            value: r.latency.serverToReceive?.p95 ?? null,
            lowerIsBetter: true,
        },
        {
            key: "clockUncertainty",
            label: "Clock uncertainty (worst client)",
            unit: "ms",
            value: rtts.length ? Math.max(...rtts) / 2 : null,
            lowerIsBetter: true,
        },
        {
            key: "joinSyncP95",
            label: "Join/reconnect sync p95",
            unit: "ms",
            value: r.snapshotSync.stats?.p95 ?? null,
            lowerIsBetter: true,
        },
        {
            key: "corrections",
            label: "Correction seeks",
            unit: "count",
            value: r.latency.correctionSeeks,
            lowerIsBetter: true,
        },
        {
            key: "periodicCorrections",
            label: "Periodic corrections",
            unit: "count",
            value: r.latency.periodicCorrections,
            lowerIsBetter: true,
        },
        {
            key: "failures",
            label: "Reconcile failures",
            unit: "count",
            value: r.latency.reconcileFailures,
            lowerIsBetter: true,
        },
    ];
}
