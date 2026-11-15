/**
 * Analyzes a multi-client synchronization measurement run.
 *
 * The calculations live in src/diagnostics/analysis/syncRunAnalysis.ts and are
 * shared with the admin Sync Metrics page, so the CLI and the UI always agree.
 *
 * Inputs (any mix):
 *   - a run directory written by the backend:  <SYNC_METRICS_DIR>/<runId>/   (*.ndjson)
 *   - an .ndjson file
 *   - a local export from the "Download Sync Metrics" button (run JSON)
 *   - a legacy samples-only JSON array
 *
 * Usage:
 *   npm run analyze:run -- ../synchrostream-backend/metrics-data/<runId> [more paths]
 *       [--out <dir>]          write CSV/JSON tables for charts
 *       [--tolerance <ms>]     in-sync threshold (default 250, matches the coordinator)
 *       [--settle <ms>]        window after a command excluded from steady state (default 2000)
 */

import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
    analyzeRun,
    buildDataset,
    buildExportFiles,
    DEFAULT_ANALYSIS_OPTIONS,
    formatTextReport,
    parseInputText,
    Rec,
} from "../src/diagnostics/analysis/syncRunAnalysis";

const argv = process.argv.slice(2);
const inputs: string[] = [];
let outDir: string | null = null;
const options = { ...DEFAULT_ANALYSIS_OPTIONS };

for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") outDir = argv[++i];
    else if (a === "--tolerance") options.toleranceMs = Number(argv[++i]);
    else if (a === "--settle") options.settleMs = Number(argv[++i]);
    else inputs.push(a);
}

if (inputs.length === 0) {
    console.error(
        "Usage: analyze-sync-run <run-dir | file.ndjson | export.json>... [--out dir] [--tolerance ms] [--settle ms]",
    );
    process.exit(1);
}

function loadInputs(paths: string[]): Rec[] {
    const all: Rec[] = [];
    const loadFile = (p: string) =>
        all.push(...parseInputText(readFileSync(p, "utf8"), p));
    for (const p of paths) {
        if (!existsSync(p)) throw new Error(`Not found: ${p}`);
        if (statSync(p).isDirectory()) {
            for (const f of readdirSync(p)) {
                // "_run.json" and other "_" files are run metadata written by the backend, not records.
                if (f.startsWith("_")) continue;
                if (f.endsWith(".ndjson") || f.endsWith(".json"))
                    loadFile(join(p, f));
            }
        } else {
            loadFile(p);
        }
    }
    return all;
}

const dataset = buildDataset(loadInputs(inputs));
const result = analyzeRun(dataset, options);

console.log(formatTextReport(result));

if (outDir) {
    mkdirSync(outDir, { recursive: true });
    const files = buildExportFiles(dataset, result);
    for (const [name, content] of Object.entries(files))
        writeFileSync(join(outDir, name), content);
    console.log(`Wrote ${Object.keys(files).join(", ")} to ${outDir}\n`);
}
