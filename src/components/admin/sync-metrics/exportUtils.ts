import {
    AnalysisResult,
    keyMetrics,
} from "@/diagnostics/analysis/syncRunAnalysis";
import { fmtMetric } from "./format";

export function downloadText(
    content: string,
    filename: string,
    type = "text/plain",
): void {
    const blob = new Blob([content], { type });
    downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const mimeFor = (name: string) =>
    name.endsWith(".json")
        ? "application/json"
        : name.endsWith(".csv")
          ? "text/csv"
          : "text/plain";

export function downloadFiles(
    files: Record<string, string>,
    prefix: string,
): void {
    // Browsers may throttle bursts of downloads; stagger them slightly.
    Object.entries(files).forEach(([name, content], i) => {
        setTimeout(
            () => downloadText(content, `${prefix}-${name}`, mimeFor(name)),
            i * 250,
        );
    });
}

/** Serializes the first <svg> inside `container` (recharts output) to a standalone SVG string. */
function serializeChart(
    container: HTMLElement,
    background: string,
): { svg: string; width: number; height: number } | null {
    // Legend icons are also "svg.recharts-surface"; the chart is the largest one.
    const candidates = [...container.querySelectorAll("svg")];
    const area = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.width * r.height;
    };
    const source = candidates.sort((a, b) => area(b) - area(a))[0];
    if (!source) return null;
    const clone = source.cloneNode(true) as SVGSVGElement;
    const { width, height } = source.getBoundingClientRect();
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.setAttribute(
        "style",
        `background:${background};font-family:Inter,Arial,sans-serif`,
    );
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", "100%");
    bg.setAttribute("height", "100%");
    bg.setAttribute("fill", background);
    clone.insertBefore(bg, clone.firstChild);

    // Legends are HTML in recharts; append them as SVG text so exports stay self-explanatory.
    const legendItems = [
        ...container.querySelectorAll(".recharts-legend-item"),
    ];
    if (legendItems.length) {
        const extra = 22;
        clone.setAttribute("height", String(height + extra));
        bg.setAttribute("height", String(height + extra));
        let x = 12;
        for (const item of legendItems) {
            const text = item.textContent?.trim() ?? "";
            const color =
                (
                    item.querySelector("path, line, rect") as SVGElement | null
                )?.getAttribute("fill") ??
                (
                    item.querySelector("path, line") as SVGElement | null
                )?.getAttribute("stroke") ??
                "#a1a1aa";
            const swatch = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "rect",
            );
            swatch.setAttribute("x", String(x));
            swatch.setAttribute("y", String(height + 6));
            swatch.setAttribute("width", "10");
            swatch.setAttribute("height", "10");
            swatch.setAttribute("fill", color);
            const label = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "text",
            );
            label.setAttribute("x", String(x + 14));
            label.setAttribute("y", String(height + 15));
            label.setAttribute("fill", "#a1a1aa");
            label.setAttribute("font-size", "11");
            label.textContent = text;
            clone.appendChild(swatch);
            clone.appendChild(label);
            x += 24 + text.length * 6.5;
        }
    }
    return {
        svg: new XMLSerializer().serializeToString(clone),
        width,
        height: height + (legendItems.length ? 22 : 0),
    };
}

export function exportChartSvg(
    container: HTMLElement,
    filename: string,
    background = "#ffffff",
): void {
    const out = serializeChart(container, background);
    if (out) downloadText(out.svg, `${filename}.svg`, "image/svg+xml");
}

export async function exportChartPng(
    container: HTMLElement,
    filename: string,
    background = "#09090b",
    scale = 2,
): Promise<void> {
    const out = serializeChart(container, background);
    if (!out) return;
    const img = new Image();
    const url = URL.createObjectURL(
        new Blob([out.svg], { type: "image/svg+xml" }),
    );
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () =>
            reject(new Error("Chart image could not be rendered"));
        img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = out.width * scale;
    canvas.height = out.height * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob(
        (blob) => blob && downloadBlob(blob, `${filename}.png`),
        "image/png",
    );
}

// ---------------------------------------------------------------- thesis tables

export interface NamedResult {
    name: string;
    result: AnalysisResult;
}

function metricTable(results: NamedResult[]): {
    header: string[];
    rows: string[][];
} {
    const metricSets = results.map((r) => keyMetrics(r.result));
    const header = ["Metric", ...results.map((r) => r.name)];
    const rows = metricSets[0].map((m, i) => [
        m.label,
        ...metricSets.map((set) => fmtMetric(set[i])),
    ]);
    return { header, rows };
}

export function summaryMarkdown(results: NamedResult[]): string {
    const { header, rows } = metricTable(results);
    const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
    const opts = results[0]?.result.options;
    return [
        line(header),
        line(header.map((_, i) => (i === 0 ? "---" : "---:"))),
        ...rows.map(line),
        "",
        opts
            ? `_Steady state = ≥ ${opts.settleMs} ms after the last command; tolerance ${opts.toleranceMs} ms._`
            : "",
    ].join("\n");
}

export function summaryLatex(results: NamedResult[]): string {
    const { header, rows } = metricTable(results);
    const esc = (s: string) =>
        s
            .replace(/([%&#_$])/g, "\\$1")
            .replace(/↔/g, "$\\leftrightarrow$")
            .replace(/→/g, "$\\rightarrow$")
            .replace(/≤/g, "$\\leq$");
    const opts = results[0]?.result.options;
    return [
        "\\begin{table}[htbp]",
        "\\centering",
        `\\begin{tabular}{l${"r".repeat(results.length)}}`,
        "\\hline",
        `${header.map(esc).join(" & ")} \\\\`,
        "\\hline",
        ...rows.map((r) => `${r.map(esc).join(" & ")} \\\\`),
        "\\hline",
        "\\end{tabular}",
        `\\caption{Synchronization metrics${opts ? ` (steady state: $\\geq$ ${opts.settleMs}\\,ms after a command; tolerance ${opts.toleranceMs}\\,ms)` : ""}.}`,
        "\\label{tab:sync-metrics}",
        "\\end{table}",
    ].join("\n");
}

export function summaryCsv(results: NamedResult[]): string {
    const { header, rows } = metricTable(results);
    const esc = (s: string) =>
        /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    return [header, ...rows].map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
