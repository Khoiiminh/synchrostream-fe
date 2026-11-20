"use client";

import { useMemo, useState } from "react";
import {
    Alert,
    Badge,
    Button,
    Group,
    Loader,
    Menu,
    NumberInput,
    SegmentedControl,
    SimpleGrid,
    Stack,
    Switch,
    Table,
    TagsInput,
    Text,
    Textarea,
    Tooltip,
} from "@mantine/core";
import {
    IconAlertTriangle,
    IconChevronDown,
    IconDeviceFloppy,
    IconDownload,
    IconRefresh,
} from "@tabler/icons-react";
import {
    analyzeRun,
    buildDataset,
    buildExportFiles,
    DEFAULT_ANALYSIS_OPTIONS,
    driftSeries,
    formatTextReport,
    keyMetrics,
    Stats,
} from "../analysis/syncRunAnalysis";
import {
    CdfChart,
    ChartCard,
    DriftTimeline,
    LatencyBars,
    RecoveryHistogram,
    SpreadTimeline,
} from "./charts";
import {
    downloadFiles,
    downloadText,
    summaryCsv,
    summaryLatex,
    summaryMarkdown,
} from "../analysis/syncMetricsExport";
import {
    fmt,
    fmtDate,
    fmtMetric,
    STAT_HEADERS,
    statCells,
} from "../analysis/syncMetricsFormat";
import { LIVE_WINDOW_MS, syncMetricsClient } from "../api/syncMetricsClient";
import { useRunData } from "../hooks/useRunData";
import type { RunSource } from "../types/syncMetrics";

const HEADLINE_KEYS = [
    "pairP50",
    "pairP95",
    "pairWithin",
    "spreadP95",
    "driftP95",
    "recoveryP95",
    "deliveryP50",
    "clockUncertainty",
];

export function RunDetailPanel({
    source,
    onMetaChanged,
}: {
    source: RunSource;
    onMetaChanged?: () => void;
}) {
    const runId = source.kind === "server" ? source.runId : null;
    /**
     * Live mode follows the run automatically (on while clients upload, off
     * once they stop) until the user flips the switch.
     */
    const [liveOverride, setLiveOverride] = useState<boolean | null>(null);
    const [autoLive, setAutoLive] = useState(false);
    const live = liveOverride ?? autoLive;
    const server = useRunData(runId, live);
    const runIsLive =
        server.meta !== null &&
        server.serverTime !== null &&
        server.serverTime - server.meta.lastRecordAt < LIVE_WINDOW_MS;
    if (runIsLive !== autoLive) setAutoLive(runIsLive);
    const records = source.kind === "server" ? server.records : source.records;
    const name = source.kind === "server" ? source.runId : source.name;

    const [toleranceMs, setToleranceMs] = useState(
        DEFAULT_ANALYSIS_OPTIONS.toleranceMs,
    );
    const [settleMs, setSettleMs] = useState(DEFAULT_ANALYSIS_OPTIONS.settleMs);
    const [yScale, setYScale] = useState<"auto" | "500" | "1000">("auto");
    const yMax = yScale === "auto" ? "auto" : Number(yScale);

    const dataset = useMemo(() => buildDataset(records), [records]);
    const options = useMemo(
        () => ({
            toleranceMs:
                Number(toleranceMs) || DEFAULT_ANALYSIS_OPTIONS.toleranceMs,
            settleMs:
                Number(settleMs) >= 0
                    ? Number(settleMs)
                    : DEFAULT_ANALYSIS_OPTIONS.settleMs,
        }),
        [toleranceMs, settleMs],
    );
    const result = useMemo(
        () => analyzeRun(dataset, options),
        [dataset, options],
    );
    const drift = useMemo(() => driftSeries(dataset), [dataset]);
    const metrics = useMemo(() => keyMetrics(result), [result]);
    const clientLabels = result.clients.map((c) => c.label);
    const filePrefix = `sync-${name}`;

    if (source.kind === "server" && server.loading && records.length === 0) {
        return (
            <Group justify="center" py="xl">
                <Loader />
            </Group>
        );
    }

    return (
        <Stack gap="lg">
            {/* Header */}
            <Group
                justify="space-between"
                align="flex-start"
                wrap="wrap"
                gap="md"
            >
                <div className="min-w-0">
                    <Group gap="xs">
                        <Text
                            size="lg"
                            fw={700}
                            className="font-mono text-zinc-100 break-all"
                        >
                            {name}
                        </Text>
                        {source.kind === "local" && (
                            <Badge color="gray" variant="light">
                                local files
                            </Badge>
                        )}
                        {result.scenarios.map((s) => (
                            <Badge key={s} variant="light" color="indigo">
                                {s}
                            </Badge>
                        ))}
                        {result.controlClock.map((c) => (
                            <Badge
                                key={c}
                                variant="outline"
                                color={c === "server" ? "green" : "yellow"}
                            >
                                control clock: {c}
                            </Badge>
                        ))}
                        {result.periodicCorrection.map((m) => (
                            <Badge
                                key={m}
                                variant="outline"
                                color={m === "on" ? "green" : "yellow"}
                            >
                                periodic correction: {m}
                            </Badge>
                        ))}
                    </Group>
                    <Text size="xs" className="text-zinc-500 mt-1">
                        {result.clients.length} clients ·{" "}
                        {fmt(result.durationS, 0)} s ·{" "}
                        {result.sampleCount.toLocaleString()} samples ·{" "}
                        {result.eventCount.toLocaleString()} events ·{" "}
                        {result.commandCount} commands
                        {source.kind === "server" && server.serverTime
                            ? ` · fetched ${fmtDate(server.serverTime)}`
                            : ""}
                    </Text>
                </div>
                <Group gap="xs">
                    {source.kind === "server" && (
                        <>
                            <Tooltip
                                label={
                                    runIsLive
                                        ? "Clients are uploading; refreshing every 5 s"
                                        : "No uploads in the last 15 s"
                                }
                            >
                                <Switch
                                    label="Live"
                                    checked={live}
                                    onChange={(e) =>
                                        setLiveOverride(e.currentTarget.checked)
                                    }
                                />
                            </Tooltip>
                            <Button
                                variant="default"
                                size="xs"
                                leftSection={<IconRefresh size={14} />}
                                onClick={() => void server.reload()}
                                loading={server.loading}
                            >
                                Reload
                            </Button>
                        </>
                    )}
                    <ExportMenu
                        onCsvBundle={() =>
                            downloadFiles(
                                buildExportFiles(dataset, result),
                                filePrefix,
                            )
                        }
                        onReport={() =>
                            downloadText(
                                formatTextReport(result),
                                `${filePrefix}-report.txt`,
                            )
                        }
                        onRaw={() =>
                            downloadText(
                                records
                                    .map((r) => JSON.stringify(r))
                                    .join("\n") + "\n",
                                `${filePrefix}-records.ndjson`,
                                "application/x-ndjson",
                            )
                        }
                        onMarkdown={() =>
                            downloadText(
                                summaryMarkdown([{ name, result }]),
                                `${filePrefix}-summary.md`,
                            )
                        }
                        onLatex={() =>
                            downloadText(
                                summaryLatex([{ name, result }]),
                                `${filePrefix}-summary.tex`,
                            )
                        }
                        onSummaryCsv={() =>
                            downloadText(
                                summaryCsv([{ name, result }]),
                                `${filePrefix}-summary.csv`,
                                "text/csv",
                            )
                        }
                    />
                </Group>
            </Group>

            {server.error && (
                <Alert color="red" title="Could not load run">
                    {server.error}
                </Alert>
            )}
            {result.mixedControlClock && (
                <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
                    Clients ran different control-clock modes in this run.
                    Compare modes in separate runs.
                </Alert>
            )}
            {result.mixedPeriodicCorrection && (
                <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
                    Clients ran different periodic-correction modes in this run.
                    Compare modes in separate runs.
                </Alert>
            )}
            {result.uncorrectedSampleCount > 0 && (
                <Alert
                    color="gray"
                    variant="light"
                    icon={<IconAlertTriangle size={16} />}
                >
                    {result.uncorrectedSampleCount.toLocaleString()} samples
                    have no clock correction (legacy data or before the first
                    clock sync); their drift includes clock skew.
                </Alert>
            )}

            {source.kind === "server" && server.meta && (
                <NotesEditor
                    key={`${source.runId}:${server.meta.notes}:${server.meta.tags.join(",")}`}
                    runId={source.runId}
                    notes={server.meta.notes}
                    tags={server.meta.tags}
                    onSaved={(meta) => {
                        server.setMeta(meta);
                        onMetaChanged?.();
                    }}
                />
            )}

            {/* Analysis parameters */}
            <Group
                gap="md"
                align="flex-end"
                wrap="wrap"
                className="bg-zinc-950/60 border border-zinc-900 rounded-2xl p-4"
            >
                <NumberInput
                    label="Tolerance"
                    suffix=" ms"
                    min={1}
                    max={5000}
                    step={10}
                    value={toleranceMs}
                    onChange={(v) => setToleranceMs(Number(v))}
                    w={140}
                    description="In-sync threshold"
                />
                <NumberInput
                    label="Settle window"
                    suffix=" ms"
                    min={0}
                    max={30000}
                    step={250}
                    value={settleMs}
                    onChange={(v) => setSettleMs(Number(v))}
                    w={160}
                    description="Excluded after commands"
                />
                <div>
                    <Text size="sm" fw={500} mb={4}>
                        Drift axis
                    </Text>
                    <SegmentedControl
                        size="xs"
                        value={yScale}
                        onChange={(v) => setYScale(v as typeof yScale)}
                        data={[
                            { label: "Auto", value: "auto" },
                            { label: "0–500 ms", value: "500" },
                            { label: "0–1 s", value: "1000" },
                        ]}
                    />
                </div>
                <Button
                    variant="subtle"
                    size="xs"
                    onClick={() => {
                        setToleranceMs(DEFAULT_ANALYSIS_OPTIONS.toleranceMs);
                        setSettleMs(DEFAULT_ANALYSIS_OPTIONS.settleMs);
                    }}
                >
                    Reset to defaults
                </Button>
                <Text size="xs" className="text-zinc-500 ml-auto max-w-sm">
                    Same calculation as <code>npm run analyze:run</code>.
                    Defaults match the coordinator (250 ms) and the CLI.
                </Text>
            </Group>

            {/* Headline cards */}
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
                {metrics
                    .filter((m) => HEADLINE_KEYS.includes(m.key))
                    .map((m) => (
                        <div
                            key={m.key}
                            className="bg-zinc-950/60 border border-zinc-900 rounded-2xl p-4"
                        >
                            <Text size="xs" className="text-zinc-500">
                                {m.label}
                            </Text>
                            <Text
                                size="xl"
                                fw={700}
                                className="text-zinc-100 tabular-nums"
                            >
                                {fmtMetric(m)}
                            </Text>
                        </div>
                    ))}
            </SimpleGrid>

            {/* Timelines */}
            <ChartCard
                title="Drift from the expected timeline, per client"
                subtitle="Server clock. Dashed verticals: commands (green PLAY, amber PAUSE, blue SEEK). Red: tolerance."
                fileName={`${filePrefix}-drift-timeline`}
                height={300}
            >
                <DriftTimeline
                    data={drift}
                    clients={clientLabels}
                    commands={result.series.commands}
                    toleranceMs={options.toleranceMs}
                    yMax={yMax}
                />
            </ChartCard>
            <ChartCard
                title="Group spread between clients"
                subtitle="max − min playback position across clients at the same server time"
                fileName={`${filePrefix}-group-spread`}
                height={260}
            >
                <SpreadTimeline result={result} yMax={yMax} />
            </ChartCard>

            {/* Distributions */}
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
                <ChartCard
                    title="CDF: inter-client drift vs drift from expected"
                    subtitle="Steady state, all clients / pairs"
                    fileName={`${filePrefix}-cdf`}
                >
                    <CdfChart
                        toleranceMs={options.toleranceMs}
                        xMax={yMax === "auto" ? undefined : yMax}
                        series={[
                            {
                                name: "Inter-client (pairs)",
                                points: result.series.pairCdf,
                            },
                            {
                                name: "Vs expected (clients)",
                                points: result.series.driftCdf,
                            },
                        ]}
                    />
                </ChartCard>
                <ChartCard
                    title="Recovery time after commands"
                    subtitle={`Server stamp → drift ≤ ${options.toleranceMs} ms for 2 samples (100 ms bins)`}
                    fileName={`${filePrefix}-recovery`}
                >
                    <RecoveryHistogram result={result} />
                </ChartCard>
                <ChartCard
                    title="Command pipeline latency"
                    subtitle="Owner issue → server stamp → client receive → applied"
                    fileName={`${filePrefix}-latency`}
                >
                    <LatencyBars result={result} />
                </ChartCard>
                <WithinTable result={result} />
            </SimpleGrid>

            {/* Tables */}
            <SectionTable
                title="Clients: clock and drift from expected (steady state)"
                header={[
                    "Client",
                    "Clock offset",
                    "RTT p50",
                    "±",
                    ...STAT_HEADERS.map((h) => `drift ${h}`),
                    "w/o correction p95",
                    "signed mean",
                ]}
                rows={result.clients.map((c) => [
                    `${c.label}${c.owner ? " (owner)" : ""}${c.userAgent ? ` · ${c.userAgent}` : ""}`,
                    fmt(c.clock.offsetMeanMs),
                    fmt(c.clock.rttP50Ms),
                    fmt(
                        c.clock.rttP50Ms !== null ? c.clock.rttP50Ms / 2 : null,
                    ),
                    ...statCells(c.driftSteady),
                    fmt(c.uncorrectedSteady?.p95),
                    fmt(c.signedSteadyMean),
                ])}
                footer="Clock offset = server − client (ms). ± = offset uncertainty (RTT / 2). Signed drift: + means the client is behind."
            />
            <SectionTable
                title="Inter-client drift per pair (steady state, ms)"
                header={["Pair", ...STAT_HEADERS]}
                rows={[
                    ...result.interClient.pairs.map((p) => [
                        p.pair,
                        ...statCells(p.steady),
                    ]),
                    ...(result.interClient.pairs.length
                        ? [
                              [
                                  "All pairs",
                                  ...statCells(
                                      result.interClient.allPairsSteady,
                                  ),
                              ],
                              [
                                  "Group spread",
                                  ...statCells(
                                      result.interClient.groupSpreadSteady,
                                  ),
                              ],
                          ]
                        : []),
                ]}
                footer={
                    result.clients.length < 2
                        ? "Needs at least two clients in the run."
                        : undefined
                }
            />
            <SectionTable
                title="Recovery time and latency (ms)"
                header={["Measure", ...STAT_HEADERS, "not recovered"]}
                rows={[
                    ...(["PLAY", "PAUSE", "SEEK"] as const).map((a) => {
                        const nr = result.recovery.notRecoveredByAction[a];
                        return [
                            `Recovery ${a}`,
                            ...statCells(result.recovery.byAction[a]),
                            nr.total ? `${nr.notRecovered}/${nr.total}` : "–",
                        ];
                    }),
                    [
                        "Recovery, group (slowest client)",
                        ...statCells(result.recovery.group),
                        "–",
                    ],
                    [
                        "Join / reconnect (snapshot → in sync)",
                        ...statCells(result.snapshotSync.stats),
                        result.snapshotSync.rows.length
                            ? `${result.snapshotSync.notSynced}/${result.snapshotSync.rows.length}`
                            : "–",
                    ],
                    ...latencyRows(result.latency),
                ]}
                footer={`Correction seeks: ${result.latency.correctionSeeks} (periodic: ${result.latency.periodicCorrectionSeeks}) · periodic reconciliations: ${result.latency.periodicCorrections} · coalesced commands: ${result.latency.supersededCommands} · reconcile failures: ${result.latency.reconcileFailures}. Sampling is 10 Hz for 3 s after each command, so recovery resolution is ~100 ms.`}
            />
        </Stack>
    );
}

function latencyRows(l: ReturnType<typeof analyzeRun>["latency"]): string[][] {
    const row = (label: string, s: Stats | null) => [
        label,
        ...statCells(s),
        "–",
    ];
    return [
        row("Owner issue → server stamp", l.issueToServer),
        row("Server stamp → client receive", l.serverToReceive),
        row("Receive → applied (PLAY)", l.applyByAction.PLAY),
        row("Receive → applied (PAUSE)", l.applyByAction.PAUSE),
        row("Receive → applied (SEEK)", l.applyByAction.SEEK),
    ];
}

function WithinTable({ result }: { result: ReturnType<typeof analyzeRun> }) {
    const thresholds = result.allSteadyWithin.map((w) => w.thresholdMs);
    return (
        <div className="bg-zinc-950/60 border border-zinc-900 rounded-2xl p-4 min-w-0">
            <Text size="sm" fw={600} className="text-zinc-100">
                Share of steady-state samples within threshold
            </Text>
            <Text size="xs" className="text-zinc-500 mb-2">
                Higher is better
            </Text>
            <div className="overflow-x-auto">
                <Table verticalSpacing={6}>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Series</Table.Th>
                            {thresholds.map((t) => (
                                <Table.Th key={t} ta="right">
                                    ≤ {t} ms
                                </Table.Th>
                            ))}
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        <Table.Tr>
                            <Table.Td>Inter-client (all pairs)</Table.Td>
                            {result.interClient.allPairsWithin.map((w) => (
                                <Table.Td
                                    key={w.thresholdMs}
                                    ta="right"
                                    className="tabular-nums"
                                >
                                    {result.interClient.allPairsSteady
                                        ? `${fmt(w.share * 100)} %`
                                        : "–"}
                                </Table.Td>
                            ))}
                        </Table.Tr>
                        <Table.Tr>
                            <Table.Td>Vs expected (all clients)</Table.Td>
                            {result.allSteadyWithin.map((w) => (
                                <Table.Td
                                    key={w.thresholdMs}
                                    ta="right"
                                    className="tabular-nums"
                                >
                                    {result.allSteady
                                        ? `${fmt(w.share * 100)} %`
                                        : "–"}
                                </Table.Td>
                            ))}
                        </Table.Tr>
                        {result.clients.map((c) => (
                            <Table.Tr key={c.client}>
                                <Table.Td className="text-zinc-400">
                                    {c.label}
                                </Table.Td>
                                {c.withinSteady.map((w) => (
                                    <Table.Td
                                        key={w.thresholdMs}
                                        ta="right"
                                        className="tabular-nums text-zinc-400"
                                    >
                                        {c.driftSteady
                                            ? `${fmt(w.share * 100)} %`
                                            : "–"}
                                    </Table.Td>
                                ))}
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </div>
        </div>
    );
}

export function SectionTable(props: {
    title: string;
    header: string[];
    rows: string[][];
    footer?: string;
}) {
    return (
        <div className="bg-zinc-950/60 border border-zinc-900 rounded-2xl p-4 min-w-0">
            <Text size="sm" fw={600} className="text-zinc-100 mb-2">
                {props.title}
            </Text>
            <div className="overflow-x-auto">
                <Table
                    verticalSpacing={6}
                    striped
                    stripedColor="rgba(255,255,255,0.02)"
                >
                    <Table.Thead>
                        <Table.Tr>
                            {props.header.map((h, i) => (
                                <Table.Th
                                    key={h + i}
                                    ta={i === 0 ? "left" : "right"}
                                    className="whitespace-nowrap"
                                >
                                    {h}
                                </Table.Th>
                            ))}
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {props.rows.map((r, i) => (
                            <Table.Tr key={i}>
                                {r.map((cell, j) => (
                                    <Table.Td
                                        key={j}
                                        ta={j === 0 ? "left" : "right"}
                                        className={
                                            j === 0
                                                ? "whitespace-nowrap"
                                                : "tabular-nums"
                                        }
                                    >
                                        {cell}
                                    </Table.Td>
                                ))}
                            </Table.Tr>
                        ))}
                        {props.rows.length === 0 && (
                            <Table.Tr>
                                <Table.Td colSpan={props.header.length}>
                                    <Text size="xs" className="text-zinc-600">
                                        No data
                                    </Text>
                                </Table.Td>
                            </Table.Tr>
                        )}
                    </Table.Tbody>
                </Table>
            </div>
            {props.footer && (
                <Text size="xs" className="text-zinc-500 mt-2">
                    {props.footer}
                </Text>
            )}
        </div>
    );
}

function ExportMenu(props: {
    onCsvBundle: () => void;
    onReport: () => void;
    onRaw: () => void;
    onMarkdown: () => void;
    onLatex: () => void;
    onSummaryCsv: () => void;
}) {
    return (
        <Menu position="bottom-end" withinPortal>
            <Menu.Target>
                <Button
                    size="xs"
                    leftSection={<IconDownload size={14} />}
                    rightSection={<IconChevronDown size={14} />}
                >
                    Export
                </Button>
            </Menu.Target>
            <Menu.Dropdown>
                <Menu.Label>Analysis data</Menu.Label>
                <Menu.Item onClick={props.onCsvBundle}>
                    CSV tables + summary.json (same as CLI --out)
                </Menu.Item>
                <Menu.Item onClick={props.onReport}>
                    Text report (same as CLI)
                </Menu.Item>
                <Menu.Item onClick={props.onRaw}>
                    Raw records (.ndjson)
                </Menu.Item>
                <Menu.Divider />
                <Menu.Label>Thesis tables</Menu.Label>
                <Menu.Item onClick={props.onLatex}>
                    Summary table (LaTeX)
                </Menu.Item>
                <Menu.Item onClick={props.onMarkdown}>
                    Summary table (Markdown)
                </Menu.Item>
                <Menu.Item onClick={props.onSummaryCsv}>
                    Summary table (CSV)
                </Menu.Item>
                <Menu.Divider />
                <Menu.Label>Charts: use the ↓ icon on each chart</Menu.Label>
            </Menu.Dropdown>
        </Menu>
    );
}

function NotesEditor(props: {
    runId: string;
    notes: string;
    tags: string[];
    onSaved: (
        meta: Awaited<ReturnType<typeof syncMetricsClient.updateRun>>,
    ) => void;
}) {
    const [notes, setNotes] = useState(props.notes);
    const [tags, setTags] = useState<string[]>(props.tags);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const dirty =
        notes !== props.notes ||
        tags.join("\u0000") !== props.tags.join("\u0000");

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            props.onSaved(
                await syncMetricsClient.updateRun(props.runId, { notes, tags }),
            );
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-zinc-950/60 border border-zinc-900 rounded-2xl p-4">
            <Group align="flex-start" gap="md" wrap="wrap">
                <Textarea
                    label="Experiment notes"
                    placeholder="Conditions, network profile, what was done when…"
                    autosize
                    minRows={2}
                    maxRows={6}
                    value={notes}
                    onChange={(e) => setNotes(e.currentTarget.value)}
                    className="flex-1 min-w-[260px]"
                    maxLength={5000}
                />
                <TagsInput
                    label="Tags"
                    placeholder="e.g. lan, 3-clients, throttled"
                    value={tags}
                    onChange={setTags}
                    maxTags={20}
                    className="w-full sm:w-72"
                />
            </Group>
            <Group justify="flex-end" mt="xs" gap="xs">
                {error && (
                    <Text size="xs" c="red">
                        {error}
                    </Text>
                )}
                <Tooltip
                    label="Saved on the server with the run"
                    disabled={!dirty}
                >
                    <Button
                        size="xs"
                        leftSection={<IconDeviceFloppy size={14} />}
                        disabled={!dirty}
                        loading={saving}
                        onClick={save}
                    >
                        Save notes
                    </Button>
                </Tooltip>
            </Group>
        </div>
    );
}
