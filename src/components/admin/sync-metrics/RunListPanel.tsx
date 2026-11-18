"use client";

import { useMemo, useRef, useState } from "react";
import {
    ActionIcon,
    Alert,
    Badge,
    Button,
    Checkbox,
    Group,
    Loader,
    Modal,
    Stack,
    Table,
    Text,
    TextInput,
    Tooltip,
} from "@mantine/core";
import {
    IconChartLine,
    IconFileUpload,
    IconGitCompare,
    IconRefresh,
    IconSearch,
    IconTrash,
    IconX,
} from "@tabler/icons-react";
import { fmtBytes, fmtDate } from "@/utils/syncMetricsFormat";
import { LIVE_WINDOW_MS } from "@/store/services/syncMetricsClient";
import type { SyncRunSummary } from "@/types/syncMetrics";

interface Props {
    runs: SyncRunSummary[];
    /** Local time the list was fetched; used to flag live runs. */
    fetchedAt: number;
    loading: boolean;
    error: string | null;
    onRefresh: () => void;
    onOpen: (runId: string) => void;
    onOpenLocal: (files: File[]) => void;
    compareIds: string[];
    onToggleCompare: (runId: string) => void;
    onCompare: () => void;
    onDelete: (runId: string) => Promise<void>;
}

export function RunListPanel(props: Props) {
    const [filter, setFilter] = useState("");
    const [pendingDelete, setPendingDelete] = useState<SyncRunSummary | null>(
        null,
    );
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const now = props.fetchedAt;

    const visible = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return props.runs;
        return props.runs.filter((r) =>
            [r.runId, r.notes, ...r.scenarios, ...r.tags].some((v) =>
                v.toLowerCase().includes(q),
            ),
        );
    }, [props.runs, filter]);

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setDeleting(true);
        setDeleteError(null);
        try {
            await props.onDelete(pendingDelete.runId);
            setPendingDelete(null);
        } catch (e) {
            setDeleteError((e as Error).message);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Stack gap="md">
            <Group justify="space-between" wrap="wrap" gap="sm">
                <TextInput
                    placeholder="Filter by run, scenario, tag or note"
                    leftSection={<IconSearch size={14} />}
                    value={filter}
                    onChange={(e) => setFilter(e.currentTarget.value)}
                    className="flex-1 min-w-[220px] max-w-md"
                />
                <Group gap="xs">
                    <Button
                        variant="default"
                        leftSection={<IconFileUpload size={16} />}
                        onClick={() => fileInput.current?.click()}
                    >
                        Open local files
                    </Button>
                    <input
                        ref={fileInput}
                        type="file"
                        accept=".json,.ndjson"
                        multiple
                        hidden
                        onChange={(e) => {
                            const files = [...(e.currentTarget.files ?? [])];
                            e.currentTarget.value = "";
                            if (files.length) props.onOpenLocal(files);
                        }}
                    />
                    <Button
                        leftSection={<IconGitCompare size={16} />}
                        disabled={props.compareIds.length < 2}
                        onClick={props.onCompare}
                    >
                        Compare{" "}
                        {props.compareIds.length >= 2
                            ? `(${props.compareIds.length})`
                            : ""}
                    </Button>
                    <Tooltip label="Refresh">
                        <ActionIcon
                            variant="default"
                            size="lg"
                            onClick={props.onRefresh}
                            aria-label="Refresh runs"
                        >
                            {props.loading ? (
                                <Loader size={14} />
                            ) : (
                                <IconRefresh size={16} />
                            )}
                        </ActionIcon>
                    </Tooltip>
                </Group>
            </Group>

            {props.error && (
                <Alert
                    color="red"
                    icon={<IconX size={16} />}
                    title="Could not load runs"
                >
                    {props.error}
                </Alert>
            )}

            <div className="bg-zinc-950/60 border border-zinc-900 rounded-2xl overflow-x-auto">
                <Table
                    highlightOnHover
                    verticalSpacing="sm"
                    className="min-w-[860px]"
                >
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th w={40} />
                            <Table.Th>Run</Table.Th>
                            <Table.Th>Scenario / tags</Table.Th>
                            <Table.Th ta="right">Clients</Table.Th>
                            <Table.Th ta="right">Records</Table.Th>
                            <Table.Th ta="right">Size</Table.Th>
                            <Table.Th>Last record</Table.Th>
                            <Table.Th w={90} />
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {visible.map((run) => {
                            const live =
                                now - run.lastRecordAt < LIVE_WINDOW_MS;
                            return (
                                <Table.Tr key={run.runId}>
                                    <Table.Td>
                                        <Checkbox
                                            aria-label={`Select ${run.runId} for comparison`}
                                            checked={props.compareIds.includes(
                                                run.runId,
                                            )}
                                            onChange={() =>
                                                props.onToggleCompare(run.runId)
                                            }
                                        />
                                    </Table.Td>
                                    <Table.Td>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                props.onOpen(run.runId)
                                            }
                                            className="text-left"
                                        >
                                            <Group gap={6} wrap="nowrap">
                                                <Text
                                                    size="sm"
                                                    fw={600}
                                                    className="text-indigo-300 hover:underline font-mono"
                                                >
                                                    {run.runId}
                                                </Text>
                                                {live && (
                                                    <Badge
                                                        size="xs"
                                                        color="green"
                                                        variant="dot"
                                                    >
                                                        live
                                                    </Badge>
                                                )}
                                            </Group>
                                            {run.notes && (
                                                <Text
                                                    size="xs"
                                                    className="text-zinc-500 line-clamp-1 max-w-[320px]"
                                                >
                                                    {run.notes}
                                                </Text>
                                            )}
                                        </button>
                                    </Table.Td>
                                    <Table.Td>
                                        <Group gap={4}>
                                            {run.scenarios.map((s) => (
                                                <Badge
                                                    key={s}
                                                    size="sm"
                                                    variant="light"
                                                    color="indigo"
                                                >
                                                    {s}
                                                </Badge>
                                            ))}
                                            {run.tags.map((t) => (
                                                <Badge
                                                    key={t}
                                                    size="sm"
                                                    variant="outline"
                                                    color="gray"
                                                >
                                                    {t}
                                                </Badge>
                                            ))}
                                            {run.scenarios.length +
                                                run.tags.length ===
                                                0 && (
                                                <Text
                                                    size="xs"
                                                    className="text-zinc-600"
                                                >
                                                    –
                                                </Text>
                                            )}
                                        </Group>
                                    </Table.Td>
                                    <Table.Td ta="right">
                                        <Text size="sm">
                                            {run.clientSessions.length ||
                                                run.files}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td ta="right">
                                        <Text size="sm">
                                            {run.recordCount.toLocaleString()}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td ta="right">
                                        <Text
                                            size="sm"
                                            className="text-zinc-400"
                                        >
                                            {fmtBytes(run.bytes)}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text
                                            size="sm"
                                            className="text-zinc-400"
                                        >
                                            {fmtDate(run.lastRecordAt)}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Group
                                            gap={4}
                                            justify="flex-end"
                                            wrap="nowrap"
                                        >
                                            <Tooltip label="Open analysis">
                                                <ActionIcon
                                                    variant="subtle"
                                                    onClick={() =>
                                                        props.onOpen(run.runId)
                                                    }
                                                    aria-label={`Open ${run.runId}`}
                                                >
                                                    <IconChartLine size={16} />
                                                </ActionIcon>
                                            </Tooltip>
                                            <Tooltip label="Delete run">
                                                <ActionIcon
                                                    variant="subtle"
                                                    color="red"
                                                    onClick={() => {
                                                        setDeleteError(null);
                                                        setPendingDelete(run);
                                                    }}
                                                    aria-label={`Delete ${run.runId}`}
                                                >
                                                    <IconTrash size={16} />
                                                </ActionIcon>
                                            </Tooltip>
                                        </Group>
                                    </Table.Td>
                                </Table.Tr>
                            );
                        })}
                        {visible.length === 0 && !props.loading && (
                            <Table.Tr>
                                <Table.Td colSpan={8}>
                                    <Stack gap={4} align="center" py="xl">
                                        <Text
                                            size="sm"
                                            className="text-zinc-400"
                                        >
                                            {props.runs.length
                                                ? "No runs match the filter."
                                                : "No runs recorded yet."}
                                        </Text>
                                        {!props.runs.length && (
                                            <Text
                                                size="xs"
                                                className="text-zinc-600 text-center max-w-md"
                                            >
                                                Open a watch party; every client
                                                uploads automatically. Add{" "}
                                                <code>
                                                    ?run=&lt;id&gt;&amp;scenario=&lt;name&gt;
                                                </code>{" "}
                                                to each client&apos;s URL to
                                                label an experiment.
                                            </Text>
                                        )}
                                    </Stack>
                                </Table.Td>
                            </Table.Tr>
                        )}
                    </Table.Tbody>
                </Table>
            </div>

            <Modal
                opened={pendingDelete !== null}
                onClose={() => setPendingDelete(null)}
                title="Delete run permanently?"
                centered
            >
                <Stack gap="md">
                    <Text size="sm">
                        This deletes{" "}
                        <b className="font-mono">{pendingDelete?.runId}</b> and
                        all {pendingDelete?.recordCount.toLocaleString()}{" "}
                        records from {pendingDelete?.files} client file(s) on
                        the server. It cannot be undone. Export it first if you
                        may need it.
                    </Text>
                    {deleteError && <Alert color="red">{deleteError}</Alert>}
                    <Group justify="flex-end">
                        <Button
                            variant="default"
                            onClick={() => setPendingDelete(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            color="red"
                            loading={deleting}
                            onClick={confirmDelete}
                        >
                            Delete run
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Stack>
    );
}
