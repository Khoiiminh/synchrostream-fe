import type { Rec } from "@/diagnostics/analysis/syncRunAnalysis";

/** Mirrors SyncRunSummary in synchrostream-backend/src/modules/sync-metrics. */
export interface SyncRunSummary {
    runId: string;
    createdAt: number;
    lastRecordAt: number;
    recordCount: number;
    scenarios: string[];
    roomIds: string[];
    participants: string[];
    clientSessions: string[];
    notes: string;
    tags: string[];
    files: number;
    bytes: number;
}

export type SyncRunMeta = Omit<SyncRunSummary, "files" | "bytes">;

export interface SyncRunPayload {
    meta: SyncRunMeta;
    records: Rec[];
    serverTime: number;
}

/** Where the run shown in the detail panel comes from. */
export type RunSource =
    | { kind: "server"; runId: string }
    | { kind: "local"; name: string; records: Rec[] };
