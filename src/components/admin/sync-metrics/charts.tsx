"use client";

import { ReactNode, useRef } from "react";
import {
    ActionIcon,
    Group,
    Menu,
    Text,
    Tooltip as MantineTooltip,
} from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import type { AnalysisResult } from "@/diagnostics/analysis/syncRunAnalysis";
import {
    ACTION_COLORS,
    AXIS,
    CLIENT_COLORS,
    fmt,
    GRID,
    RUN_COLORS,
    TOOLTIP_STYLE,
} from "@/utils/syncMetricsFormat";
import { exportChartPng, exportChartSvg } from "@/utils/syncMetricsExport";

// ---------------------------------------------------------------- frame

export function ChartCard(props: {
    title: string;
    subtitle?: string;
    fileName: string;
    height?: number;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div className="bg-zinc-950/60 border border-zinc-900 rounded-2xl p-4 min-w-0">
            <Group
                justify="space-between"
                align="flex-start"
                mb="xs"
                wrap="nowrap"
            >
                <div className="min-w-0">
                    <Text size="sm" fw={600} className="text-zinc-100">
                        {props.title}
                    </Text>
                    {props.subtitle && (
                        <Text size="xs" className="text-zinc-500">
                            {props.subtitle}
                        </Text>
                    )}
                </div>
                <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                        <MantineTooltip label="Export chart">
                            <ActionIcon
                                variant="subtle"
                                color="gray"
                                aria-label={`Export ${props.title}`}
                            >
                                <IconDownload size={16} />
                            </ActionIcon>
                        </MantineTooltip>
                    </Menu.Target>
                    <Menu.Dropdown>
                        <Menu.Item
                            onClick={() =>
                                ref.current &&
                                void exportChartPng(ref.current, props.fileName)
                            }
                        >
                            PNG (dark, 2×)
                        </Menu.Item>
                        <Menu.Item
                            onClick={() =>
                                ref.current &&
                                void exportChartPng(
                                    ref.current,
                                    props.fileName,
                                    "#ffffff",
                                )
                            }
                        >
                            PNG (white background)
                        </Menu.Item>
                        <Menu.Item
                            onClick={() =>
                                ref.current &&
                                exportChartSvg(
                                    ref.current,
                                    props.fileName,
                                    "#09090b",
                                )
                            }
                        >
                            SVG
                        </Menu.Item>
                    </Menu.Dropdown>
                </Menu>
            </Group>
            <div
                ref={ref}
                style={{ width: "100%", height: props.height ?? 260 }}
            >
                {props.children}
            </div>
        </div>
    );
}

const EmptyChart = ({ text }: { text: string }) => (
    <div className="h-full flex items-center justify-center">
        <Text size="xs" className="text-zinc-600">
            {text}
        </Text>
    </div>
);

function CommandMarkers({
    commands,
}: {
    commands: AnalysisResult["series"]["commands"];
}) {
    // Too many markers turn into noise (rapid-seek runs); thin them out.
    const step = Math.max(1, Math.ceil(commands.length / 80));
    return (
        <>
            {commands
                .filter((_, i) => i % step === 0)
                .map((c, i) => (
                    <ReferenceLine
                        key={i}
                        x={c.relS}
                        stroke={ACTION_COLORS[c.action] ?? "#71717a"}
                        strokeDasharray="3 3"
                        strokeOpacity={0.6}
                    />
                ))}
        </>
    );
}

// ---------------------------------------------------------------- timelines

export function DriftTimeline(props: {
    data: Record<string, number | null>[];
    clients: string[];
    commands: AnalysisResult["series"]["commands"];
    toleranceMs: number;
    yMax: number | "auto";
}) {
    if (props.data.length === 0) return <EmptyChart text="No samples" />;
    return (
        <ResponsiveContainer>
            <LineChart
                data={props.data}
                margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
            >
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                <XAxis
                    dataKey="relS"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    {...AXIS}
                    unit="s"
                />
                <YAxis
                    {...AXIS}
                    unit=" ms"
                    width={64}
                    domain={[0, props.yMax === "auto" ? "auto" : props.yMax]}
                    allowDataOverflow
                />
                <Tooltip
                    {...TOOLTIP_STYLE}
                    labelFormatter={(v) => `t = ${fmt(Number(v), 1)} s`}
                    formatter={(v) => `${fmt(Number(v))} ms`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <CommandMarkers commands={props.commands} />
                <ReferenceLine
                    y={props.toleranceMs}
                    stroke="#ef4444"
                    strokeDasharray="6 3"
                    label={{
                        value: `${props.toleranceMs} ms`,
                        fill: "#ef4444",
                        fontSize: 10,
                        position: "insideTopRight",
                    }}
                />
                {props.clients.map((c, i) => (
                    <Line
                        key={c}
                        dataKey={c}
                        name={c}
                        stroke={CLIENT_COLORS[i % CLIENT_COLORS.length]}
                        dot={false}
                        strokeWidth={1.3}
                        connectNulls
                        isAnimationActive={false}
                    />
                ))}
            </LineChart>
        </ResponsiveContainer>
    );
}

export function SpreadTimeline(props: {
    result: AnalysisResult;
    yMax: number | "auto";
}) {
    const data = props.result.series.spread.map((s) => ({
        relS: Number(s.relS.toFixed(2)),
        spread: Number(s.spreadMs.toFixed(1)),
    }));
    if (data.length === 0)
        return (
            <EmptyChart text="Needs at least two clients playing at the same time" />
        );
    return (
        <ResponsiveContainer>
            <LineChart
                data={data}
                margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
            >
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                <XAxis
                    dataKey="relS"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    {...AXIS}
                    unit="s"
                />
                <YAxis
                    {...AXIS}
                    unit=" ms"
                    width={64}
                    domain={[0, props.yMax === "auto" ? "auto" : props.yMax]}
                    allowDataOverflow
                />
                <Tooltip
                    {...TOOLTIP_STYLE}
                    labelFormatter={(v) => `t = ${fmt(Number(v), 1)} s`}
                    formatter={(v) => `${fmt(Number(v))} ms`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <CommandMarkers commands={props.result.series.commands} />
                <ReferenceLine
                    y={props.result.options.toleranceMs}
                    stroke="#ef4444"
                    strokeDasharray="6 3"
                />
                <Line
                    dataKey="spread"
                    name="Group spread (max − min)"
                    stroke="#f472b6"
                    dot={false}
                    strokeWidth={1.4}
                    isAnimationActive={false}
                />
            </LineChart>
        </ResponsiveContainer>
    );
}

// ---------------------------------------------------------------- distributions

/** One or more empirical CDFs on a shared x axis (single run or comparison). */
export function CdfChart(props: {
    series: { name: string; points: { valueMs: number; share: number }[] }[];
    toleranceMs: number;
    xMax?: number;
}) {
    const usable = props.series.filter((s) => s.points.length > 0);
    if (usable.length === 0) return <EmptyChart text="No steady-state data" />;
    return (
        <ResponsiveContainer>
            <LineChart margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                <XAxis
                    dataKey="valueMs"
                    type="number"
                    {...AXIS}
                    unit=" ms"
                    domain={[0, props.xMax ?? "auto"]}
                    allowDataOverflow
                />
                <YAxis
                    dataKey="share"
                    type="number"
                    {...AXIS}
                    domain={[0, 1]}
                    tickFormatter={(v) => `${Math.round(v * 100)}%`}
                    width={48}
                />
                <Tooltip
                    {...TOOLTIP_STYLE}
                    labelFormatter={(v) => `${fmt(Number(v))} ms`}
                    formatter={(v) => `${fmt(Number(v) * 100)} %`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine
                    x={props.toleranceMs}
                    stroke="#ef4444"
                    strokeDasharray="6 3"
                />
                {usable.map((s, i) => (
                    <Line
                        key={s.name}
                        data={s.points}
                        dataKey="share"
                        name={s.name}
                        type="stepAfter"
                        stroke={
                            (usable.length > 1 ? RUN_COLORS : CLIENT_COLORS)[
                                i % 6
                            ]
                        }
                        dot={false}
                        strokeWidth={1.6}
                        isAnimationActive={false}
                    />
                ))}
            </LineChart>
        </ResponsiveContainer>
    );
}

export function RecoveryHistogram({ result }: { result: AnalysisResult }) {
    const data = result.series.recoveryHistogram.map((b) => ({
        bin: `${b.fromMs}`,
        count: b.count,
    }));
    if (data.length === 0) return <EmptyChart text="No recovered commands" />;
    return (
        <ResponsiveContainer>
            <BarChart
                data={data}
                margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
            >
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                <XAxis dataKey="bin" {...AXIS} unit=" ms" />
                <YAxis {...AXIS} allowDecimals={false} width={40} />
                <Tooltip
                    {...TOOLTIP_STYLE}
                    labelFormatter={(v) => `${v}–${Number(v) + 100} ms`}
                />
                <Bar
                    dataKey="count"
                    name="Client recoveries"
                    fill="#818cf8"
                    isAnimationActive={false}
                />
            </BarChart>
        </ResponsiveContainer>
    );
}

export function LatencyBars({ result }: { result: AnalysisResult }) {
    const l = result.latency;
    const rows = [
        { stage: "Issue → server", s: l.issueToServer },
        { stage: "Server → client", s: l.serverToReceive },
        { stage: "Apply PLAY", s: l.applyByAction.PLAY },
        { stage: "Apply PAUSE", s: l.applyByAction.PAUSE },
        { stage: "Apply SEEK", s: l.applyByAction.SEEK },
    ].map((r) => ({
        stage: r.stage,
        p50: r.s ? Number(r.s.p50.toFixed(1)) : null,
        p95: r.s ? Number(r.s.p95.toFixed(1)) : null,
    }));
    if (rows.every((r) => r.p50 === null))
        return <EmptyChart text="No command events" />;
    return (
        <ResponsiveContainer>
            <BarChart
                data={rows}
                margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
            >
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                <XAxis dataKey="stage" {...AXIS} interval={0} />
                <YAxis {...AXIS} unit=" ms" width={64} />
                <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v) => `${fmt(Number(v))} ms`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                    dataKey="p50"
                    name="p50"
                    fill="#818cf8"
                    isAnimationActive={false}
                />
                <Bar
                    dataKey="p95"
                    name="p95"
                    fill="#f472b6"
                    isAnimationActive={false}
                />
            </BarChart>
        </ResponsiveContainer>
    );
}

/** Grouped bars of one metric family across runs (comparison view). */
export function CompareBars(props: {
    rows: Record<string, string | number | null>[];
    runs: string[];
    unit: string;
}) {
    if (props.rows.length === 0) return <EmptyChart text="No data" />;
    return (
        <ResponsiveContainer>
            <BarChart
                data={props.rows}
                margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
            >
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                <XAxis dataKey="metric" {...AXIS} interval={0} />
                <YAxis {...AXIS} unit={props.unit} width={64} />
                <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v) => `${fmt(Number(v))}${props.unit}`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {props.runs.map((r, i) => (
                    <Bar
                        key={r}
                        dataKey={r}
                        name={r}
                        fill={RUN_COLORS[i % RUN_COLORS.length]}
                        isAnimationActive={false}
                    />
                ))}
            </BarChart>
        </ResponsiveContainer>
    );
}
