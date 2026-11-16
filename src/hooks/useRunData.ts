"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Rec } from "@/diagnostics/analysis/syncRunAnalysis";
import { syncMetricsClient } from "@/store/services/syncMetricsClient";
import type { SyncRunMeta, SyncRunPayload } from "@/types/syncMetrics";

const LIVE_POLL_MS = 5_000;

/** Newest serverReceivedAt among records; avoids re-fetching rows read in the same pass. */
const maxReceived = (records: Rec[], fallback: number) =>
    records.reduce(
        (m, r) =>
            Math.max(
                m,
                typeof r.serverReceivedAt === "number" ? r.serverReceivedAt : 0,
            ),
        0,
    ) || fallback;

/**
 * Loads a run's records from the backend. With `live`, polls for records
 * received since the last fetch and appends them (incremental `?since=`).
 * Mount one instance per run (the caller keys the component by run id).
 */
export function useRunData(runId: string | null, live: boolean) {
    const [records, setRecords] = useState<Rec[]>([]);
    const [meta, setMeta] = useState<SyncRunMeta | null>(null);
    const [loading, setLoading] = useState(runId !== null);
    const [error, setError] = useState<string | null>(null);
    /** Server time of the last successful fetch (for "is this run still live?"). */
    const [serverTime, setServerTime] = useState<number | null>(null);
    const cursor = useRef<number | null>(null);
    const generation = useRef(0);

    const applyFull = useCallback((payload: SyncRunPayload) => {
        setRecords(payload.records);
        setMeta(payload.meta);
        setServerTime(payload.serverTime);
        cursor.current = maxReceived(payload.records, payload.serverTime);
    }, []);

    const fetchFull = useCallback(async () => {
        if (!runId) return;
        const gen = ++generation.current;
        try {
            const payload = await syncMetricsClient.getRun(runId);
            if (gen !== generation.current) return;
            applyFull(payload);
            setError(null);
        } catch (e) {
            if (gen === generation.current) setError((e as Error).message);
        } finally {
            if (gen === generation.current) setLoading(false);
        }
    }, [runId, applyFull]);

    const reload = useCallback(() => {
        setLoading(true);
        return fetchFull();
    }, [fetchFull]);

    // Initial load; state is only set from the promise callbacks.
    useEffect(() => {
        if (!runId) return;
        const gen = ++generation.current;
        syncMetricsClient
            .getRun(runId)
            .then(
                (payload) => {
                    if (gen === generation.current) {
                        applyFull(payload);
                        setError(null);
                    }
                },
                (e: Error) => {
                    if (gen === generation.current) setError(e.message);
                },
            )
            .finally(() => {
                if (gen === generation.current) setLoading(false);
            });
    }, [runId, applyFull]);

    useEffect(() => {
        if (!live || !runId) return;
        const timer = setInterval(async () => {
            if (cursor.current === null) return;
            const gen = generation.current;
            try {
                const payload = await syncMetricsClient.getRun(
                    runId,
                    cursor.current,
                );
                if (gen !== generation.current) return;
                cursor.current = maxReceived(payload.records, cursor.current);
                setMeta(payload.meta);
                setServerTime(payload.serverTime);
                if (payload.records.length)
                    setRecords((prev) => [...prev, ...payload.records]);
            } catch (e) {
                setError((e as Error).message);
            }
        }, LIVE_POLL_MS);
        return () => {
            clearInterval(timer);
            // Leaving live mode: reload everything so the final analysis never
            // depends on incremental polling (no missed or duplicated batches).
            void fetchFull();
        };
    }, [live, runId, fetchFull]);

    return { records, meta, setMeta, loading, error, reload, serverTime };
}
