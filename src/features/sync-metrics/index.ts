/*
 * Public API of the sync-metrics slice: the admin workspace for recorded sync
 * runs (list, detail, compare). The analysis it shows is the same code the
 * `npm run analyze:run` script uses (analysis/syncRunAnalysis.ts).
 */
export { SyncMetricsWorkspace } from "./ui/SyncMetricsWorkspace";
