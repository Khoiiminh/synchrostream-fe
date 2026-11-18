import type { KeyMetric, Stats } from "@/diagnostics/analysis/syncRunAnalysis";

/** Client series colors; distinguishable on the dark dashboard background. */
export const CLIENT_COLORS = [
    "#818cf8",
    "#34d399",
    "#fbbf24",
    "#f472b6",
    "#38bdf8",
    "#a78bfa",
    "#a3e635",
    "#fb923c",
];
export const RUN_COLORS = [
    "#818cf8",
    "#f472b6",
    "#34d399",
    "#fbbf24",
    "#38bdf8",
    "#fb923c",
];
export const ACTION_COLORS: Record<string, string> = {
    PLAY: "#34d399",
    PAUSE: "#fbbf24",
    SEEK: "#38bdf8",
};

export const AXIS = {
    stroke: "#52525b",
    tick: { fill: "#a1a1aa", fontSize: 11 },
};
export const GRID = "#27272a";
export const TOOLTIP_STYLE = {
    contentStyle: {
        background: "#09090b",
        border: "1px solid #27272a",
        borderRadius: 8,
        fontSize: 12,
    },
    labelStyle: { color: "#e4e4e7" },
};

export const fmt = (x: number | null | undefined, digits = 1): string =>
    x === null || x === undefined || !Number.isFinite(x)
        ? "–"
        : x.toFixed(digits);

export function fmtMetric(m: KeyMetric): string {
    if (m.value === null || m.value === undefined) return "–";
    if (typeof m.value === "string") return m.value;
    switch (m.unit) {
        case "ms":
            return `${fmt(m.value)} ms`;
        case "%":
            return `${fmt(m.value)} %`;
        case "s":
            return `${fmt(m.value, 0)} s`;
        default:
            return String(Math.round(m.value));
    }
}

export const fmtBytes = (n: number) =>
    n < 1024
        ? `${n} B`
        : n < 1024 ** 2
          ? `${(n / 1024).toFixed(1)} KB`
          : `${(n / 1024 ** 2).toFixed(1)} MB`;

export const fmtDate = (ms: number) =>
    ms
        ? new Date(ms).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
          })
        : "–";

export const statCells = (s: Stats | null): string[] =>
    s
        ? [
              String(s.count),
              fmt(s.mean),
              fmt(s.p50),
              fmt(s.p95),
              fmt(s.p99),
              fmt(s.max),
              fmt(s.sd),
          ]
        : ["0", "–", "–", "–", "–", "–", "–"];

export const STAT_HEADERS = ["n", "mean", "p50", "p95", "p99", "max", "sd"];
