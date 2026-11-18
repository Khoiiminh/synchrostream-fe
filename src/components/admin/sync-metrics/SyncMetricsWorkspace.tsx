"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Tabs } from "@mantine/core";
import { IconChartLine, IconGitCompare, IconList } from "@tabler/icons-react";
import { parseInputText, Rec } from "@/diagnostics/analysis/syncRunAnalysis";
import { ComparePanel } from "./ComparePanel";
import { RunDetailPanel } from "./RunDetailPanel";
import { RunListPanel } from "./RunListPanel";
import { syncMetricsClient } from "@/store/services/syncMetricsClient";
import type { RunSource, SyncRunSummary } from "@/types/syncMetrics";

type Tab = "runs" | "detail" | "compare";

/** Admin workspace for synchronization measurement runs. */
export function SyncMetricsWorkspace() {
    const [tab, setTab] = useState<Tab>("runs");
    const [runs, setRuns] = useState<SyncRunSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchedAt, setFetchedAt] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [source, setSource] = useState<RunSource | null>(null);
    const [compareIds, setCompareIds] = useState<string[]>([]);
    const [localError, setLocalError] = useState<string | null>(null);

    const fetchRuns = useCallback(async () => {
        try {
            setRuns(await syncMetricsClient.listRuns());
            setFetchedAt(Date.now());
            setError(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    const refresh = useCallback(() => {
        setLoading(true);
        return fetchRuns();
    }, [fetchRuns]);

    // Initial load; state is only set from the promise callbacks.
    useEffect(() => {
        let cancelled = false;
        syncMetricsClient
            .listRuns()
            .then(
                (list) => {
                    if (!cancelled) {
                        setRuns(list);
                        setFetchedAt(Date.now());
                    }
                },
                (e: Error) => {
                    if (!cancelled) setError(e.message);
                },
            )
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const openRun = (runId: string) => {
        setSource({ kind: "server", runId });
        setTab("detail");
    };

    const openLocal = async (files: File[]) => {
        setLocalError(null);
        try {
            const records: Rec[] = [];
            for (const file of files)
                records.push(...parseInputText(await file.text(), file.name));
            setSource({
                kind: "local",
                name:
                    files.length === 1
                        ? files[0].name
                        : `${files.length} local files`,
                records,
            });
            setTab("detail");
        } catch (e) {
            setLocalError((e as Error).message);
        }
    };

    const deleteRun = async (runId: string) => {
        await syncMetricsClient.deleteRun(runId);
        setCompareIds((ids) => ids.filter((id) => id !== runId));
        if (source?.kind === "server" && source.runId === runId)
            setSource(null);
        await refresh();
    };

    return (
        <Tabs
            value={tab}
            onChange={(v) => v && setTab(v as Tab)}
            keepMounted={false}
        >
            <Tabs.List mb="lg">
                <Tabs.Tab value="runs" leftSection={<IconList size={14} />}>
                    Runs
                </Tabs.Tab>
                <Tabs.Tab
                    value="detail"
                    leftSection={<IconChartLine size={14} />}
                    disabled={!source}
                >
                    Run analysis
                </Tabs.Tab>
                <Tabs.Tab
                    value="compare"
                    leftSection={<IconGitCompare size={14} />}
                    disabled={compareIds.length < 2}
                >
                    Compare
                    {compareIds.length >= 2 ? ` (${compareIds.length})` : ""}
                </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="runs">
                {localError && (
                    <Alert
                        color="red"
                        mb="md"
                        title="Could not read local files"
                    >
                        {localError}
                    </Alert>
                )}
                <RunListPanel
                    runs={runs}
                    fetchedAt={fetchedAt}
                    loading={loading}
                    error={error}
                    onRefresh={() => void refresh()}
                    onOpen={openRun}
                    onOpenLocal={(files) => void openLocal(files)}
                    compareIds={compareIds}
                    onToggleCompare={(id) =>
                        setCompareIds((ids) =>
                            ids.includes(id)
                                ? ids.filter((x) => x !== id)
                                : [...ids, id],
                        )
                    }
                    onCompare={() => setTab("compare")}
                    onDelete={deleteRun}
                />
            </Tabs.Panel>

            <Tabs.Panel value="detail">
                {source && (
                    <RunDetailPanel
                        key={
                            source.kind === "server"
                                ? source.runId
                                : source.name
                        }
                        source={source}
                        onMetaChanged={() => void refresh()}
                    />
                )}
            </Tabs.Panel>

            <Tabs.Panel value="compare">
                <ComparePanel runIds={compareIds} onOpenRun={openRun} />
            </Tabs.Panel>
        </Tabs>
    );
}
