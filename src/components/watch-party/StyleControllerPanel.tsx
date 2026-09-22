"use client";

import React, { useRef, useState } from "react";
import {
  Paper,
  Stack,
  Slider,
  Text,
  Box,
  Group,
  Tooltip,
  ActionIcon,
} from "@mantine/core";
import {
  Sliders,
  Eye,
  Maximize2,
  Copy,
  Ticket,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setUiStyles } from "@/store/slices/roomSlice";

interface PanelPosition {
  x: number;
  y: number;
}

export default function StyleControllerPanel() {
  const dispatch = useAppDispatch();

  const activeRoom = useAppSelector(
    (state) => state.room.activeRoom,
  );

  const { videoSize, videoOpacity } = useAppSelector(
    (state) => state.room.uiOptions,
  );

  const [isMinimized, setIsMinimized] = useState(false);

  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

  const [position, setPosition] = useState<PanelPosition>({
    x: 24,
    y: 24,
  });

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

    event.currentTarget.setPointerCapture(event.pointerId);
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

    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      didDragRef.current = true;
    }

    setPosition({
      x: Math.max(
        0,
        dragStateRef.current.startPositionX + deltaX,
      ),
      y: Math.max(
        0,
        dragStateRef.current.startPositionY + deltaY,
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
    // A drag should never also trigger minimize.
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }

    setIsMinimized((previous) => !previous);
  };

  const handleCopyText = (p: {
    text: string;
    type: "code" | "pass";
  }) => {
    navigator.clipboard.writeText(p.text);

    if (p.type === "code") {
      setCopiedCode(true);

      setTimeout(
        () => setCopiedCode(false),
        2000,
      );
    } else {
      setCopiedPass(true);

      setTimeout(
        () => setCopiedPass(false),
        2000,
      );
    }
  };

  return (
    <Paper
      withBorder
      p={isMinimized ? "7px" : "sm"}
      radius="md"
      className="
        fixed
        z-50
        bg-zinc-900/90
        border-zinc-800
        backdrop-blur-md
        shadow-2xl
        select-none
        transition-[width,padding]
        duration-200
        ease-in-out
      "
      style={{
        left: position.x,
        top: position.y,
        width: isMinimized ? "fit-content" : 260,
      }}
    >
      <Stack gap="xs">
        {/*
         * HEADER / DRAG HANDLE
         *
         * The same area is used for:
         * - dragging
         * - minimizing/restoring
         */}
        <Group
          justify="space-between"
          className="cursor-grab active:cursor-grabbing"
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
            <Sliders
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
              Canvas Overlay HUD
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
         * CONTENT
         *
         * Completely disappears when minimized.
         */}
        <div
          className={`
            transition-all
            duration-300
            ease-in-out
            overflow-hidden
            ${
              isMinimized
                ? "max-h-0 opacity-0 pointer-events-none"
                : "max-h-100 opacity-100 pt-2"
            }
          `}
        >
          <Stack gap="xs">
            {activeRoom && (
              <Box
                className="
                  bg-zinc-950/90
                  border
                  border-teal-500/30
                  rounded-md
                  p-2
                  shadow-inner
                  mb-1
                "
              >
                <Group
                  gap="xs"
                  mb={6}
                  className="
                    border-b
                    border-zinc-800
                    pb-1
                  "
                >
                  <Ticket
                    size={12}
                    className="text-teal-400"
                  />

                  <Text
                    size="10px"
                    fw={800}
                    className="
                      text-teal-400
                      tracking-wider
                      uppercase
                      font-sans
                    "
                  >
                    Room Access Keys
                  </Text>
                </Group>

                <Stack gap={4}>
                  <Group justify="space-between">
                    <Text
                      size="11px"
                      className="text-zinc-400"
                    >
                      Room Code:
                    </Text>

                    <Group gap={4}>
                      <Text
                        size="11px"
                        fw={700}
                        className="
                          font-mono
                          text-zinc-100
                          bg-zinc-900
                          px-1
                          rounded
                          border
                          border-zinc-800
                        "
                      >
                        {activeRoom.roomCode}
                      </Text>

                      <Tooltip
                        label={
                          copiedCode
                            ? "Copied!"
                            : "Copy Code"
                        }
                        position="top"
                        withArrow
                      >
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color="teal"
                          onClick={(event) => {
                            event.stopPropagation();

                            handleCopyText({
                              text: activeRoom.roomCode,
                              type: "code",
                            });
                          }}
                        >
                          <Copy size={10} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>

                  <Group justify="space-between">
                    <Text
                      size="11px"
                      className="text-zinc-400"
                    >
                      Password:
                    </Text>

                    <Group gap={4}>
                      <Text
                        size="11px"
                        fw={700}
                        className="
                          font-mono
                          text-zinc-100
                          bg-zinc-900
                          px-1
                          rounded
                          border
                          border-zinc-800
                          max-w-27.5
                          truncate
                        "
                      >
                        {activeRoom.passwordPlain || (
                          <span className="italic text-zinc-600 font-sans">
                            None
                          </span>
                        )}
                      </Text>

                      {activeRoom.passwordPlain && (
                        <Tooltip
                          label={
                            copiedPass
                              ? "Copied!"
                              : "Copy Password"
                          }
                          position="top"
                          withArrow
                        >
                          <ActionIcon
                            size="xs"
                            variant="subtle"
                            color="teal"
                            onClick={(event) => {
                              event.stopPropagation();

                              handleCopyText({
                                text:
                                  activeRoom.passwordPlain!,
                                type: "pass",
                              });
                            }}
                          >
                            <Copy size={10} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  </Group>
                </Stack>
              </Box>
            )}

            <Box>
              <Group
                justify="space-between"
                mb={4}
              >
                <Text
                  size="11px"
                  color="zinc.4"
                  className="flex items-center gap-1"
                >
                  <Maximize2 size={11} />
                  Frame Scale
                </Text>

                <Text
                  size="11px"
                  color="teal.4"
                  fw={600}
                >
                  {videoSize}px
                </Text>
              </Group>

              <Slider
                min={80}
                max={240}
                step={10}
                value={videoSize}
                onChange={(val) =>
                  dispatch(
                    setUiStyles({
                      videoSize: val,
                    }),
                  )
                }
                color="teal"
                size="xs"
                label={null}
              />
            </Box>

            <Box>
              <Group
                justify="space-between"
                mb={4}
              >
                <Text
                  size="11px"
                  color="zinc.4"
                  className="flex items-center gap-1"
                >
                  <Eye size={11} />
                  Alpha Transparency
                </Text>

                <Text
                  size="11px"
                  color="teal.4"
                  fw={600}
                >
                  {Math.round(
                    videoOpacity * 100,
                  )}
                  %
                </Text>
              </Group>

              <Slider
                min={0.1}
                max={1.0}
                step={0.05}
                value={videoOpacity}
                onChange={(val) =>
                  dispatch(
                    setUiStyles({
                      videoOpacity: val,
                    }),
                  )
                }
                color="teal"
                size="xs"
                label={null}
              />
            </Box>
          </Stack>
        </div>
      </Stack>
    </Paper>
  );
}