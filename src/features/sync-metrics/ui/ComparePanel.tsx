"use client";

import { useEffect, useMemo, useState } from "react";
import {
    Alert,
    Badge,
    Button,
    Group,
    Loader,
    Menu,
    NumberInput,
    SimpleGrid,
    Stack,
    Table,
    Text,
} from "@mantine/core";
import { IconChevronDown, IconDownload } from "@tabler/icons-react";
import {
    analyzeRun,
    buildDataset,
    DEFAULT_ANALYSIS_OPTIONS,
    keyMetrics,
    Rec,
} from "../analysis/syncRunAnalysis";
import { CdfChart, ChartCard, CompareBars } from "./charts";
import {
    downloadText,
    NamedResult,
    summaryCsv,
    summaryLatex,
    summaryMarkdown,
} from "../analysis/syncMetricsExport";
import { fmtMetric, RUN_COLORS } from "../analysis/syncMetricsFormat";
import { syncMetricsClient } from "../api/syncMetricsClient";

export function ComparePanel({
    runIds,
    onOpenRun,
}: {
    runIds: string[];
    onOpenRun: (runId: string) => void;
}) {
    const [recordsByRun, setRecordsByRun] = useState<Record<string, Rec[]>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    const [toleranceMs, setToleranceMs] = useState(
        DEFAULT_ANALYSIS_OPTIONS.toleranceMs,
    );
    const [settleMs, setSettleMs] = useState(DEFAULT_ANALYSIS_OPTIONS.settleMs);

    const key = runIds.join("|");
    useEffect(() => {
        let cancelled = false;
        void Promise.all(
            runIds.map(async (id) => {
                try {
                    return [
                        id,
                        (await syncMetricsClient.getRun(id)).records,
                        null,
                    ] as const;
                } catch (e) {
                    return [id, [] as Rec[], (e as Error).message] as const;
                }
            }),
        ).then((rows) => {
            if (cancelled) return;
            setRecordsByRun(
                Object.fromEntries(rows.map(([id, recs]) => [id, recs])),
            );
            setErrors(
                Object.fromEntries(
                    rows
                        .filter(([, , err]) => err)
                        .map(([id, , err]) => [id, err!]),
                ),
            );
            setLoadedKey(key);
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

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

    const datasets = useMemo(
        () =>
            runIds
                .filter((id) => recordsByRun[id]?.length)
                .map((id) => ({ id, ds: buildDataset(recordsByRun[id]) })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [recordsByRun, key],
    );
    const results: NamedResult[] = useMemo(
        () =>
            datasets.map(({ id, ds }) => ({
                name: id,
                result: analyzeRun(ds, options),
            })),
        [datasets, options],
    );

    if (runIds.length < 2) {
        return (
            <Text size="sm" className="text-zinc-400">
                Select two or more runs in the Runs tab to compare them.
            </Text>
        );
    }
    if (loadedKey !== key)
        return (
            <Group justify="center" py="xl">
                <Loader />
            </Group>
        );

    const metricSets = results.map((r) => keyMetrics(r.result));
    const names = results.map((r) => r.name);
    const bestIndex = (i: number): number | null => {
        const m = metricSets[0]?.[i];
        if (!m || m.lowerIsBetter === undefined) return null;
        const values = metricSets
            .map((set) => set[i].value)
            .map((v) => (typeof v === "number" ? v : null));
        const valid = values
            .map((v, idx) => [v, idx] as const)
            .filter(([v]) => v !== null) as [number, number][];
        if (valid.length < 2) return null;
        valid.sort((a, b) => (m.lowerIsBetter ? a[0] - b[0] : b[0] - a[0]));
        return valid[0][0] === valid[1][0] ? null : valid[0][1];
    };

    const barRows = (keys: string[]) =>
        keys.map((k) => {
            const row: Record<string, string | number | null> = {
                metric:
                    metricSets[0]
                        ?.find((m) => m.key === k)
                        ?.label.replace("Inter-client drift ", "")
                        .replace("Group recovery ", "") ?? k,
            };
            results.forEach((r, i) => {
                const v = metricSets[i].find((m) => m.key === k)?.value;
                row[r.name] =
                    typeof v === "number" ? Number(v.toFixed(1)) : null;
            });
            return row;
        });

    const prefix = `sync-compare-${names.length}runs`;
    const mixed = new Set(results.map((r) => r.result.clients.length)).size > 1;

    return (
        <Stack gap="lg">
            <Group justify="space-between" align="flex-end" wrap="wrap">
                <Group gap="xs">
                    {names.map((n, i) => (
                        <Badge
                            key={n}
                            size="lg"
                            variant="light"
                            style={{ color: RUN_COLORS[i % RUN_COLORS.length] }}
                            className="font-mono cursor-pointer"
                            onClick={() => onOpenRun(n)}
                        >
                            {n}
                        </Badge>
                    ))}
                </Group>
                <Group gap="sm" align="flex-end">
                    <NumberInput
                        label="Tolerance"
                        suffix=" ms"
                        min={1}
                        max={5000}
                        step={10}
                        value={toleranceMs}
                        onChange={(v) => setToleranceMs(Number(v))}
                        w={130}
                    />
                    <NumberInput
                        label="Settle window"
                        suffix=" ms"
                        min={0}
                        max={30000}
                        step={250}
                        value={settleMs}
                        onChange={(v) => setSettleMs(Number(v))}
                        w={150}
                    />
                    <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                            <Button
                                leftSection={<IconDownload size={14} />}
                                rightSection={<IconChevronDown size={14} />}
                            >
                                Export
                            </Button>
                        </Menu.Target>
                        <Menu.Dropdown>
                            <Menu.Item
                                onClick={() =>
                                    downloadText(
                                        summaryLatex(results),
                                        `${prefix}.tex`,
                                    )
                                }
                            >
                                Comparison table (LaTeX)
                            </Menu.Item>
                            <Menu.Item
                                onClick={() =>
                                    downloadText(
                                        summaryMarkdown(results),
                                        `${prefix}.md`,
                                    )
                                }
                            >
                                Comparison table (Markdown)
                            </Menu.Item>
                            <Menu.Item
                                onClick={() =>
                                    downloadText(
                                        summaryCsv(results),
                                        `${prefix}.csv`,
                                        "text/csv",
                                    )
                                }
                            >
                                Comparison table (CSV)
                            </Menu.Item>
                        </Menu.Dropdown>
                    </Menu>
                </Group>
            </Group>

            {Object.entries(errors).map(([id, err]) => (
                <Alert key={id} color="red" title={`Could not load ${id}`}>
                    {err}
                </Alert>
            ))}
            {mixed && (
                <Alert color="yellow" variant="light">
                    The runs have different client counts; inter-client metrics
                    are not directly comparable.
                </Alert>
            )}

            <div className="bg-zinc-950/60 border border-zinc-900 rounded-2xl p-4 overflow-x-auto">
                <Table
                    verticalSpacing={6}
                    striped
                    stripedColor="rgba(255,255,255,0.02)"
                >
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Metric</Table.Th>
                            {names.map((n) => (
                                <Table.Th
                                    key={n}
                                    ta="right"
                                    className="font-mono whitespace-nowrap"
                                >
                                    {n}
                                </Table.Th>
                            ))}
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {metricSets[0]?.map((m, i) => {
                            const best = bestIndex(i);
                            return (
                                <Table.Tr key={m.key}>
                                    <Table.Td>{m.label}</Table.Td>
                                    {metricSets.map((set, j) => (
                                        <Table.Td
                                            key={j}
                                            ta="right"
                                            className={`tabular-nums ${best === j ? "text-emerald-400 font-semibold" : ""}`}
                                        >
                                            {fmtMetric(set[i])}
                                        </Table.Td>
                                    ))}
                                </Table.Tr>
                            );
                        })}
                    </Table.Tbody>
                </Table>
                <Text size="xs" className="text-zinc-500 mt-2">
                    Green = best value for that metric. Steady state = ≥{" "}
                    {options.settleMs} ms after the last command; tolerance{" "}
                    {options.toleranceMs} ms.
                </Text>
            </div>

            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
                <ChartCard
                    title="CDF: inter-client drift (steady state)"
                    subtitle="One curve per run; further left is better"
                    fileName={`${prefix}-pair-cdf`}
                >
                    <CdfChart
                        toleranceMs={options.toleranceMs}
                        series={results.map((r) => ({
                            name: r.name,
                            points: r.result.series.pairCdf,
                        }))}
                    />
                </ChartCard>
                <ChartCard
                    title="CDF: drift from expected timeline (steady state)"
                    subtitle="All clients pooled, one curve per run"
                    fileName={`${prefix}-drift-cdf`}
                >
                    <CdfChart
                        toleranceMs={options.toleranceMs}
                        series={results.map((r) => ({
                            name: r.name,
                            points: r.result.series.driftCdf,
                        }))}
                    />
                </ChartCard>
                <ChartCard
                    title="Inter-client drift"
                    subtitle="p50 / p95 / max, steady state"
                    fileName={`${prefix}-pair-bars`}
                >
                    <CompareBars
                        rows={barRows(["pairP50", "pairP95", "pairMax"])}
                        runs={names}
                        unit=" ms"
                    />
                </ChartCard>
                <ChartCard
                    title="Group recovery time after commands"
                    subtitle="Slowest client per command, p50 / p95"
                    fileName={`${prefix}-recovery-bars`}
                >
                    <CompareBars
                        rows={barRows(["recoveryP50", "recoveryP95"])}
                        runs={names}
                        unit=" ms"
                    />
                </ChartCard>
            </SimpleGrid>
        </Stack>
    );
}
