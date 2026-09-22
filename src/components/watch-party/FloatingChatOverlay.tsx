"use client";

import React, {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Stack,
  ScrollArea,
  Text,
  Box,
  TextInput,
  ActionIcon,
  Group,
} from "@mantine/core";

import {
  Send,
  MessageSquare,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

import { useParams } from "next/navigation";
import { watchPartyGatewayEngine } from "@/store";

interface FloatingMessage {
  username: string;
  text: string;
}

interface ChatMessageBroadcastPayload {
  userId: string;
  username: string;
  message: string;
  timestamp: number;
}

interface PanelPosition {
  x: number;
  y: number;
}

export default function FloatingChatOverlay() {
  const params = useParams();

  const roomCode =
    (params?.roomCode as string) || "";

  const [messages, setMessages] =
    useState<FloatingMessage[]>([
      {
        username: "System",
        text:
          "Connected to video stream layout overhead layer.",
      },
    ]);

  const [input, setInput] = useState("");

  const [isMinimized, setIsMinimized] =
    useState(false);

  const scrollRef =
    useRef<HTMLDivElement>(null);

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
    const height = 360;
    const right = 24;
    const bottom = 24;

    return {
      x: Math.max(
        0,
        window.innerWidth - width - right,
      ),
      y: Math.max(
        0,
        window.innerHeight - height - bottom,
      ),
    };
  });

  useEffect(() => {
    const handleIncomingMessage = (
      data: ChatMessageBroadcastPayload,
    ) => {
      setMessages((prev) => [
        ...prev,
        {
          username: data.username,
          text: data.message,
        },
      ]);
    };

    watchPartyGatewayEngine.on({
      event: "room:chat:broadcast",
      callback: handleIncomingMessage,
    });

    return () => {
      watchPartyGatewayEngine.off({
        event: "room:chat:broadcast",
        callback: handleIncomingMessage,
      });
    };
  }, []);

  useEffect(() => {
    const handleIncomingMessage = (
      data: ChatMessageBroadcastPayload,
    ) => {
      setMessages((prev) => [
        ...prev,
        {
          username: data.username,
          text: data.message,
        },
      ]);
    };

    watchPartyGatewayEngine.on({
      event: "room:chat:broadcast",
      callback: handleIncomingMessage,
    });

    return () => {
      watchPartyGatewayEngine.off({
        event: "room:chat:broadcast",
        callback: handleIncomingMessage,
      });
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const handleSend = (
    e: React.FormEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();

    const cleanMessage = input.trim();

    if (!cleanMessage || !roomCode) {
      return;
    }

    watchPartyGatewayEngine.emitChatMessage({
      roomCode: roomCode.toUpperCase(),
      message: cleanMessage,
    });

    setMessages((prev) => [
      ...prev,
      {
        username: "Me",
        text: cleanMessage,
      },
    ]);

    setInput("");
  };

  const handleDragStart = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
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

    event.currentTarget.setPointerCapture(
      event.pointerId,
    );
  };

  const handleDragMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!dragStateRef.current.dragging) {
      return;
    }

    const deltaX =
      event.clientX -
      dragStateRef.current.startPointerX;

    const deltaY =
      event.clientY -
      dragStateRef.current.startPointerY;

    if (
      Math.abs(deltaX) > 3 ||
      Math.abs(deltaY) > 3
    ) {
      didDragRef.current = true;
    }

    setPosition({
      x: Math.max(
        0,
        dragStateRef.current.startPositionX +
          deltaX,
      ),
      y: Math.max(
        0,
        dragStateRef.current.startPositionY +
          deltaY,
      ),
    });
  };

  const handleDragEnd = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!dragStateRef.current.dragging) {
      return;
    }

    dragStateRef.current.dragging = false;

    if (
      event.currentTarget.hasPointerCapture(
        event.pointerId,
      )
    ) {
      event.currentTarget.releasePointerCapture(
        event.pointerId,
      );
    }
  };

  const handleHeaderClick = () => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }

    setIsMinimized((previous) => !previous);
  };

  return (
    <Box
      className="
        fixed
        z-40
        flex
        flex-col
        gap-2
        transition-[width,height]
        duration-200
        ease-in-out
      "
      style={{
        left: position.x,
        top: position.y,
        width: isMinimized
          ? "fit-content"
          : 320,
        height: isMinimized
          ? "auto"
          : 360,
      }}
    >
      {/*
       * CHAT HEADER / DRAG HANDLE
       */}
      <Group
        justify="space-between"
        className="
          bg-black/50
          backdrop-blur-md
          border
          border-white/10
          rounded-md
          px-2
          py-1.5
          shadow-lg
          cursor-grab
          active:cursor-grabbing
          select-none
        "
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        onClick={handleHeaderClick}
        style={{
          touchAction: "none",
        }}
      >
        <Group gap="xs">
          <MessageSquare
            size={14}
            className="text-teal-400"
          />

          <Text
            size="xs"
            fw={700}
            className="
              text-zinc-200
              uppercase
              tracking-wide
              whitespace-nowrap
            "
          >
            Text Chat
          </Text>
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
        className={`
          flex
          flex-col
          gap-2
          flex-1
          min-h-0
          transition-all
          duration-300
          ease-in-out
          overflow-hidden
          ${
            isMinimized
              ? "max-h-0 opacity-0 pointer-events-none"
              : "max-h-90 opacity-100"
          }
        `}
      >
        <ScrollArea
          style={{ flex: 1 }}
          viewportRef={scrollRef}
          className="px-2"
        >
          <Stack
            gap="xs"
            justify="end"
            className="min-h-full"
          >
            {messages.map((msg, index) => (
              <Box
                key={index}
                className="
                  bg-black/40
                  backdrop-blur-xs
                  p-2
                  rounded-md
                  border
                  border-white/5
                  self-start
                  max-w-[90%]
                "
              >
                <Text
                  size="11px"
                  fw={700}
                  color="teal.4"
                  mb={1}
                >
                  {msg.username}
                </Text>

                <Text
                  size="xs"
                  color="zinc.1"
                  className="
                    wrap-break-word
                    leading-relaxed
                  "
                >
                  {msg.text}
                </Text>
              </Box>
            ))}
          </Stack>
          </ScrollArea>

        <form
          onSubmit={handleSend}
          className="px-2"
        >
          <TextInput
            placeholder="Type message..."
            value={input}
            onChange={(e) =>
              setInput(e.currentTarget.value)
            }
            rightSection={
              <ActionIcon
                type="submit"
                variant="transparent"
                color="teal"
                disabled={!input.trim()}
              >
                <Send size={14} />
              </ActionIcon>
            }
            styles={{
              input: {
                backgroundColor:
                  "rgba(15, 15, 17, 0.7)",
                backdropFilter: "blur(8px)",
                borderColor:
                  "rgba(39, 39, 42, 0.6)",
                color: "#fff",
              },
            }}
          />
        </form>
      </div>
    </Box>
  );
}