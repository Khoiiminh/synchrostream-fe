import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessageBroadcastPayload } from "@/types/watchParty";
import {
    CHAT_TIMELINE_LIMIT,
    appendPending,
    applyBroadcast,
    applySendResult,
    createClientMessageId,
    mergeHistory,
    type ChatEntry,
} from "./chatTimeline";

const ME = "user-me";

function message(
    overrides: Partial<ChatMessageBroadcastPayload> = {},
): ChatMessageBroadcastPayload {
    return {
        id: "m1",
        userId: "user-other",
        username: "other",
        message: "hi",
        timestamp: 1_000,
        clientMessageId: null,
        ...overrides,
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("appendPending", () => {
    it("adds the sender's message as pending, keyed by its client id", () => {
        vi.useFakeTimers({ now: 5_000 });
        const next = appendPending([], {
            clientMessageId: "c1",
            username: "me",
            text: "hello",
        });
        expect(next).toEqual([
            {
                key: "c1",
                serverId: null,
                clientMessageId: "c1",
                kind: "self",
                username: "me",
                text: "hello",
                timestamp: 5_000,
                status: "pending",
            },
        ]);
    });

    it("never mutates the array it was given", () => {
        const before: ChatEntry[] = [];
        appendPending(before, {
            clientMessageId: "c1",
            username: "me",
            text: "x",
        });
        expect(before).toEqual([]);
    });
});

describe("applyBroadcast", () => {
    it("a broadcast of my pending message confirms it in place", () => {
        const pending = appendPending(
            applyBroadcast([], message({ id: "m0", timestamp: 1 }), ME),
            { clientMessageId: "c1", username: "me", text: "hello" },
        );
        const next = applyBroadcast(
            pending,
            message({
                id: "m1",
                userId: ME,
                clientMessageId: "c1",
                message: "hello",
                timestamp: 2_000,
            }),
            ME,
        );
        expect(next).toHaveLength(2);
        expect(next[1]).toMatchObject({
            key: "c1",
            serverId: "m1",
            status: "sent",
            timestamp: 2_000,
        });
        expect(next[1].error).toBeUndefined();
    });

    it("a message already shown (same server id) is ignored", () => {
        const once = applyBroadcast([], message(), ME);
        expect(applyBroadcast(once, message(), ME)).toBe(once);
    });

    it("someone else's message is appended as other; my own from another tab as self", () => {
        const a = applyBroadcast([], message(), ME);
        const b = applyBroadcast(a, message({ id: "m2", userId: ME }), ME);
        expect(b.map((e) => [e.key, e.kind])).toEqual([
            ["m1", "other"],
            ["m2", "self"],
        ]);
    });

    it("without a signed-in user nothing is self, even a deleted sender's row", () => {
        expect(applyBroadcast([], message({ userId: ME }), null)[0].kind).toBe(
            "other",
        );
        expect(
            applyBroadcast([], message({ userId: null }), null)[0].kind,
        ).toBe("other");
    });

    it("a live-only relay (no id) falls back to client id, then time and user, as key", () => {
        const a = applyBroadcast(
            [],
            message({ id: null, clientMessageId: "cx" }),
            ME,
        );
        const b = applyBroadcast(a, message({ id: null, timestamp: 7 }), ME);
        expect(b.map((e) => e.key)).toEqual(["cx", "7-user-other"]);
        // A null id is never treated as "already shown".
        expect(applyBroadcast(b, message({ id: null }), ME)).toHaveLength(3);
    });

    it(`keeps only the newest ${CHAT_TIMELINE_LIMIT} entries`, () => {
        let entries: ChatEntry[] = [];
        for (let i = 0; i < CHAT_TIMELINE_LIMIT + 5; i += 1) {
            entries = applyBroadcast(
                entries,
                message({ id: `m${i}`, timestamp: i }),
                ME,
            );
        }
        expect(entries).toHaveLength(CHAT_TIMELINE_LIMIT);
        expect(entries[0].serverId).toBe("m5");
    });
});

describe("applySendResult", () => {
    const pending = () =>
        appendPending([], { clientMessageId: "c1", username: "me", text: "x" });

    it("an ok ack marks it sent with the server's id and time", () => {
        const [entry] = applySendResult(pending(), "c1", {
            ok: true,
            id: "m9",
            timestamp: 42,
        });
        expect(entry).toMatchObject({
            serverId: "m9",
            timestamp: 42,
            status: "sent",
        });
    });

    it("an ack after the broadcast keeps the broadcast's server id", () => {
        const confirmed = applyBroadcast(
            pending(),
            message({ id: "m-broadcast", userId: ME, clientMessageId: "c1" }),
            ME,
        );
        const [entry] = applySendResult(confirmed, "c1", {
            ok: true,
            id: "m-ack",
            timestamp: 43,
        });
        expect(entry.serverId).toBe("m-broadcast");
    });

    it("a failed ack marks it failed with the reason; a retry ack clears it", () => {
        const failed = applySendResult(pending(), "c1", {
            ok: false,
            message: "Too fast",
        });
        expect(failed[0]).toMatchObject({
            status: "failed",
            error: "Too fast",
        });
        const sent = applySendResult(failed, "c1", {
            ok: true,
            id: "m1",
            timestamp: 1,
        });
        expect(sent[0].status).toBe("sent");
        expect(sent[0].error).toBeUndefined();
    });

    it("other entries are untouched", () => {
        const two = appendPending(pending(), {
            clientMessageId: "c2",
            username: "me",
            text: "y",
        });
        const next = applySendResult(two, "c1", { ok: false, message: "no" });
        expect(next[1]).toBe(two[1]);
    });
});

describe("mergeHistory", () => {
    it("adds missing persisted messages in time order, keeping local-only entries", () => {
        vi.useFakeTimers({ now: 3_000 });
        const local = appendPending(
            applyBroadcast([], message({ id: "m2", timestamp: 2_000 }), ME),
            {
                clientMessageId: "c1",
                username: "me",
                text: "pending",
            },
        );
        const merged = mergeHistory(
            local,
            [
                message({ id: "m1", timestamp: 1_000 }),
                message({ id: "m2", timestamp: 2_000 }),
                message({ id: null, timestamp: 2_500 }),
            ],
            ME,
        );
        expect(merged.map((e) => e.key)).toEqual(["m1", "m2", "c1"]);
    });

    it("interleaves backlog messages by time around what is on screen", () => {
        const local = applyBroadcast(
            [],
            message({ id: "m3", timestamp: 3_000 }),
            ME,
        );
        const merged = mergeHistory(
            local,
            [
                message({ id: "m1", timestamp: 1_000 }),
                message({ id: "m5", timestamp: 5_000 }),
            ],
            ME,
        );
        expect(merged.map((e) => e.key)).toEqual(["m1", "m3", "m5"]);
    });

    it("a replay with nothing new returns the same array", () => {
        const local = applyBroadcast([], message(), ME);
        expect(mergeHistory(local, [message()], ME)).toBe(local);
    });
});

describe("createClientMessageId", () => {
    it("is unique per call", () => {
        const ids = new Set(Array.from({ length: 50 }, createClientMessageId));
        expect(ids.size).toBe(50);
    });

    it("falls back without crypto.randomUUID", () => {
        vi.stubGlobal("crypto", {});
        try {
            expect(createClientMessageId()).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
