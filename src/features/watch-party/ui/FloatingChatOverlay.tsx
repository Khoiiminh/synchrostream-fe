"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

import {
    Stack,
    ScrollArea,
    Text,
    Box,
    TextInput,
    ActionIcon,
    Group,
} from "@mantine/core";

import { Send, MessageSquare, ChevronUp, ChevronDown } from "lucide-react";

import { useParams } from "next/navigation";
import { useEngine } from "../engine/EngineContext";
import { useAppSelector } from "@/store/hooks";
import {
    CHAT_MESSAGE_MAX_LENGTH,
    type ChatHistoryPayload,
    type ChatMessageBroadcastPayload,
} from "../types/watchParty";
import {
    appendPending,
    applyBroadcast,
    applySendResult,
    createClientMessageId,
    mergeHistory,
    type ChatEntry,
} from "../chat/chatTimeline";

interface PanelPosition {
    x: number;
    y: number;
}

/** Show the remaining-characters counter once this close to the limit. */
const COUNTER_THRESHOLD = 50;

function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });
}

export default function FloatingChatOverlay() {
    const params = useParams();

    const roomCode = (params?.roomCode as string) || "";

    // The same engine instance the party page connects; a separate one never has a socket.
    const { gatewayEngine } = useEngine();

    const selfUserId = useAppSelector((state) => state.auth.userId);
    const selfUsername = useAppSelector((state) => state.auth.username);

    // Read inside socket callbacks, which are registered once.
    const selfUserIdRef = useRef(selfUserId);
    useEffect(() => {
        selfUserIdRef.current = selfUserId;
    }, [selfUserId]);

    const [messages, setMessages] = useState<ChatEntry[]>([]);

    // Room generation the timeline belongs to; a different one starts it over.
    const historyRoomIdRef = useRef<string | null>(null);

    // Messages from others that arrived while the panel was minimized.
    const [unreadCount, setUnreadCount] = useState(0);
    const isMinimizedRef = useRef(false);

    const [input, setInput] = useState("");

    const [isMinimized, setIsMinimized] = useState(false);

    const scrollRef = useRef<HTMLDivElement>(null);

    const dragStateRef = useRef<{
        dragging: boolean;
        startPointerX: number;
        startPointerY: number;
        startPositionX: number;
        startPositionY: number;
    }>({
        dragging: false,
        startPointerX: 0,
        startPointerY: 0,
        startPositionX: 0,
        startPositionY: 0,
    });

    const didDragRef = useRef(false);

    const [position, setPosition] = useState<PanelPosition>(() => {
        if (typeof window === "undefined") {
            return {
                x: 0,
                y: 0,
            };
        }

        const width = 320;
        const right = 24;

        // Top-right, under the top bar: clear of the player's control bar
        // (quality, fullscreen) along the bottom.
        return {
            x: Math.max(0, window.innerWidth - width - right),
            y: 92,
        };
    });

    useEffect(() => {
        const handleHistory = (data: ChatHistoryPayload) => {
            const isNewRoom =
                historyRoomIdRef.current !== null &&
                historyRoomIdRef.current !== data.roomId;
            historyRoomIdRef.current = data.roomId;

            setMessages((prev) =>
                mergeHistory(
                    isNewRoom ? [] : prev,
                    data.messages,
                    selfUserIdRef.current,
                ),
            );
        };

        const handleIncomingMessage = (data: ChatMessageBroadcastPayload) => {
            setMessages((prev) =>
                applyBroadcast(prev, data, selfUserIdRef.current),
            );

            const isOwnMessage =
                data.userId !== null && data.userId === selfUserIdRef.current;
            if (isMinimizedRef.current && !isOwnMessage) {
                setUnreadCount((count) => count + 1);
            }
        };

        // History may have arrived before this view mounted.
        const backlog = gatewayEngine.getLastChatHistory();
        if (backlog) {
            handleHistory(backlog);
        }

        const removeHistoryListener = gatewayEngine.on({
            event: "room:chat:history",
            callback: handleHistory,
        });

        const removeChatListener = gatewayEngine.on({
            event: "room:chat:broadcast",
            callback: handleIncomingMessage,
        });

        return () => {
            removeHistoryListener();
            removeChatListener();
        };
    }, [gatewayEngine]);

    useEffect(() => {
        scrollRef.current?.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: "smooth",
        });
    }, [messages]);

    const deliver = useCallback(
        async (clientMessageId: string, text: string) => {
            const result = await gatewayEngine.sendChatMessage({
                roomCode: roomCode.toUpperCase(),
                message: text,
                clientMessageId,
            });

            setMessages((prev) =>
                applySendResult(prev, clientMessageId, result),
            );
        },
        [gatewayEngine, roomCode],
    );

    const handleSend = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const cleanMessage = input.trim();

        if (!cleanMessage || !roomCode) {
            return;
        }

        const clientMessageId = createClientMessageId();

        setMessages((prev) =>
            appendPending(prev, {
                clientMessageId,
                username: selfUsername ?? "Me",
                text: cleanMessage,
            }),
        );

        setInput("");

        void deliver(clientMessageId, cleanMessage);
    };

    const handleRetry = (entry: ChatEntry) => {
        const clientMessageId = entry.clientMessageId;

        if (!clientMessageId) {
            return;
        }

        setMessages((prev) =>
            prev.map((m) =>
                m.clientMessageId === clientMessageId
                    ? { ...m, status: "pending", error: undefined }
                    : m,
            ),
        );

        void deliver(clientMessageId, entry.text);
    };

    const remainingCharacters = CHAT_MESSAGE_MAX_LENGTH - input.length;

    const handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }

        dragStateRef.current = {
            dragging: true,
            startPointerX: event.clientX,
            startPointerY: event.clientY,
            startPositionX: position.x,
            startPositionY: position.y,
        };

        didDragRef.current = false;

        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!dragStateRef.current.dragging) {
            return;
        }

        const deltaX = event.clientX - dragStateRef.current.startPointerX;

        const deltaY = event.clientY - dragStateRef.current.startPointerY;

        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
            didDragRef.current = true;
        }

        setPosition({
            x: Math.max(0, dragStateRef.current.startPositionX + deltaX),
            y: Math.max(0, dragStateRef.current.startPositionY + deltaY),
        });
    };

    const handleDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!dragStateRef.current.dragging) {
            return;
        }

        dragStateRef.current.dragging = false;

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const handleHeaderClick = () => {
        if (didDragRef.current) {
            didDragRef.current = false;
            return;
        }

        const next = !isMinimized;
        isMinimizedRef.current = next;
        setIsMinimized(next);

        if (!next) {
            setUnreadCount(0);
        }
    };

    return (
        <Box
            className="fixed z-40 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/55 shadow-2xl shadow-black/50 backdrop-blur-xl transition-[width,height] duration-200 ease-in-out"
            style={{
                left: position.x,
                top: position.y,
                width: isMinimized ? "fit-content" : 320,
                height: isMinimized ? "auto" : 360,
            }}
        >
            {/*
             * CHAT HEADER / DRAG HANDLE
             */}
            <Group
                justify="space-between"
                wrap="nowrap"
                className="cursor-grab select-none border-b border-white/5 px-3 py-2 active:cursor-grabbing"
                onPointerDown={handleDragStart}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragEnd}
                onPointerCancel={handleDragEnd}
                onClick={handleHeaderClick}
                style={{
                    touchAction: "none",
                }}
            >
                <Group gap="xs" wrap="nowrap">
                    <MessageSquare size={14} className="text-teal-400" />

                    <Text
                        size="xs"
                        fw={700}
                        className="whitespace-nowrap uppercase tracking-wide text-zinc-200"
                    >
                        Chat
                    </Text>

                    {isMinimized && unreadCount > 0 && (
                        <span className="rounded-full bg-teal-400 px-1.5 text-[10px] font-bold leading-4 text-zinc-950">
                            {unreadCount}
                        </span>
                    )}
                </Group>

                <ActionIcon
                    variant="transparent"
                    size="xs"
                    color="zinc.4"
                    style={{
                        pointerEvents: "none",
                    }}
                >
                    {isMinimized ? (
                        <ChevronUp size={14} />
                    ) : (
                        <ChevronDown size={14} />
                    )}
                </ActionIcon>
            </Group>

            {/*
             * CHAT CONTENT
             *
             * Completely removed visually when minimized.
             */}
            <div
                className={`flex min-h-0 flex-1 flex-col gap-2 overflow-hidden transition-all duration-300 ease-in-out ${
                    isMinimized
                        ? "max-h-0 opacity-0 pointer-events-none"
                        : "max-h-90 opacity-100 pb-2"
                }`}
            >
                <ScrollArea
                    style={{ flex: 1 }}
                    viewportRef={scrollRef}
                    className="px-3"
                >
                    <Stack gap={8} justify="end" className="min-h-full py-2">
                        <Text
                            size="11px"
                            ta="center"
                            className="px-4 text-zinc-500"
                        >
                            You joined the room. Say hi 👋
                        </Text>

                        {messages.map((msg) => {
                            if (msg.kind === "self") {
                                return (
                                    <Box
                                        key={msg.key}
                                        className="flex max-w-[80%] flex-col items-end self-end"
                                    >
                                        <Box
                                            title={formatTime(msg.timestamp)}
                                            className={`rounded-2xl rounded-br-md px-3 py-1.5 text-zinc-950 shadow-md transition-opacity ${
                                                msg.status === "failed"
                                                    ? "bg-rose-400/80"
                                                    : "bg-teal-500/90"
                                            } ${
                                                msg.status === "pending"
                                                    ? "opacity-60"
                                                    : ""
                                            }`}
                                        >
                                            <Text
                                                size="xs"
                                                fw={500}
                                                className="wrap-break-word whitespace-pre-wrap leading-relaxed"
                                            >
                                                {msg.text}
                                            </Text>
                                        </Box>

                                        {msg.status === "failed" && (
                                            <button
                                                type="button"
                                                onClick={() => handleRetry(msg)}
                                                className="mt-0.5 text-[10px] text-rose-300 hover:underline"
                                            >
                                                {msg.error ?? "Not sent"} ·
                                                Retry
                                            </button>
                                        )}
                                    </Box>
                                );
                            }

                            return (
                                <Group
                                    key={msg.key}
                                    gap={6}
                                    align="flex-end"
                                    wrap="nowrap"
                                    className="max-w-[88%] self-start"
                                >
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-[10px] font-bold text-sky-200 ring-1 ring-sky-300/20">
                                        {msg.username.slice(0, 1).toUpperCase()}
                                    </span>
                                    <Box
                                        title={formatTime(msg.timestamp)}
                                        className="min-w-0 rounded-2xl rounded-bl-md border border-white/5 bg-white/10 px-3 py-1.5"
                                    >
                                        <Text
                                            size="10px"
                                            fw={700}
                                            className="text-sky-300"
                                        >
                                            {msg.username}
                                        </Text>
                                        <Text
                                            size="xs"
                                            className="wrap-break-word whitespace-pre-wrap leading-relaxed text-zinc-100"
                                        >
                                            {msg.text}
                                        </Text>
                                    </Box>
                                </Group>
                            );
                        })}
                    </Stack>
                </ScrollArea>

                <form onSubmit={handleSend} className="px-3">
                    <TextInput
                        placeholder="Say something…"
                        radius="xl"
                        value={input}
                        maxLength={CHAT_MESSAGE_MAX_LENGTH}
                        onChange={(e) => setInput(e.currentTarget.value)}
                        description={
                            remainingCharacters <= COUNTER_THRESHOLD
                                ? `${remainingCharacters} characters left`
                                : undefined
                        }
                        inputWrapperOrder={["input", "description"]}
                        rightSection={
                            <ActionIcon
                                type="submit"
                                variant="filled"
                                color="teal"
                                radius="xl"
                                size="md"
                                disabled={!input.trim()}
                            >
                                <Send size={13} />
                            </ActionIcon>
                        }
                        styles={{
                            input: {
                                backgroundColor: "rgba(255, 255, 255, 0.06)",
                                borderColor: "rgba(255, 255, 255, 0.08)",
                                color: "#fff",
                            },
                        }}
                    />
                </form>
            </div>
        </Box>
    );
}
