import type { ChatMessageBroadcastPayload } from "../types/watchParty";

/**
 * Pure helpers for the chat timeline shown in the watch-party overlay.
 * The component owns the array; these functions only compute the next one.
 */

export type ChatEntryStatus = "pending" | "sent" | "failed";

export interface ChatEntry {
    /** Stable React key: server id when known, else the client id. */
    key: string;
    serverId: string | null;
    clientMessageId: string | null;
    kind: "self" | "other";
    username: string;
    text: string;
    timestamp: number;
    status: ChatEntryStatus;
    error?: string;
}

/** Oldest entries are dropped past this, so a long party stays cheap to render. */
export const CHAT_TIMELINE_LIMIT = 200;

export function createClientMessageId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function trim(entries: ChatEntry[]): ChatEntry[] {
    return entries.length > CHAT_TIMELINE_LIMIT
        ? entries.slice(entries.length - CHAT_TIMELINE_LIMIT)
        : entries;
}

function toEntry(
    payload: ChatMessageBroadcastPayload,
    selfUserId: string | null,
): ChatEntry {
    return {
        key:
            payload.id ??
            payload.clientMessageId ??
            `${payload.timestamp}-${payload.userId}`,
        serverId: payload.id,
        clientMessageId: payload.clientMessageId,
        kind:
            selfUserId !== null && payload.userId === selfUserId
                ? "self"
                : "other",
        username: payload.username,
        text: payload.message,
        timestamp: payload.timestamp,
        status: "sent",
    };
}

/** Adds the sender's optimistic message before the server confirms it. */
export function appendPending(
    entries: ChatEntry[],
    params: { clientMessageId: string; username: string; text: string },
): ChatEntry[] {
    return trim([
        ...entries,
        {
            key: params.clientMessageId,
            serverId: null,
            clientMessageId: params.clientMessageId,
            kind: "self",
            username: params.username,
            text: params.text,
            timestamp: Date.now(),
            status: "pending",
        },
    ]);
}

/**
 * Applies one live broadcast. A broadcast of this tab's own pending message
 * confirms it in place; a message already shown (same server id, e.g. from a
 * history replay) is ignored.
 */
export function applyBroadcast(
    entries: ChatEntry[],
    payload: ChatMessageBroadcastPayload,
    selfUserId: string | null,
): ChatEntry[] {
    if (payload.id !== null && entries.some((e) => e.serverId === payload.id)) {
        return entries;
    }

    if (payload.clientMessageId !== null) {
        const index = entries.findIndex(
            (e) => e.clientMessageId === payload.clientMessageId,
        );
        if (index !== -1) {
            const next = entries.slice();
            next[index] = {
                ...next[index],
                serverId: payload.id,
                timestamp: payload.timestamp,
                status: "sent",
                error: undefined,
            };
            return next;
        }
    }

    return trim([...entries, toEntry(payload, selfUserId)]);
}

/** Records the ack for a pending message (the broadcast may arrive first or not at all). */
export function applySendResult(
    entries: ChatEntry[],
    clientMessageId: string,
    result:
        | { ok: true; id: string | null; timestamp: number }
        | { ok: false; message: string },
): ChatEntry[] {
    return entries.map((e) => {
        if (e.clientMessageId !== clientMessageId) return e;
        if (!result.ok) {
            return { ...e, status: "failed", error: result.message };
        }
        return {
            ...e,
            serverId: e.serverId ?? result.id,
            timestamp: result.timestamp,
            status: "sent",
            error: undefined,
        };
    });
}

/**
 * Merges a history backlog (sent on every bind, including reconnects) with
 * what is already on screen. Persisted messages are de-duplicated by id;
 * entries that are not in the backlog (pending, failed, live-only) are kept.
 */
export function mergeHistory(
    entries: ChatEntry[],
    history: ChatMessageBroadcastPayload[],
    selfUserId: string | null,
): ChatEntry[] {
    const known = new Set(
        entries.flatMap((e) => (e.serverId !== null ? [e.serverId] : [])),
    );
    const missing = history
        .filter((m) => m.id !== null && !known.has(m.id))
        .map((m) => toEntry(m, selfUserId));

    if (missing.length === 0) return entries;

    return trim(
        [...missing, ...entries].sort((a, b) => a.timestamp - b.timestamp),
    );
}
