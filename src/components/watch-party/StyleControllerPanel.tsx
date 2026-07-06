"use client";

import React, { useState } from "react";
import { Paper, Stack, Slider, Text, Box, Group, Tooltip, ActionIcon } from "@mantine/core";
import { Sliders, Eye, Maximize2, Copy, Ticket } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setUiStyles } from "@/store/slices/roomSlice";

export default function StyleControllerPanel() {
  const dispatch = useAppDispatch();
  const activeRoom = useAppSelector((state) => state.room.activeRoom);
  const { videoSize, videoOpacity } = useAppSelector((state) => state.room.uiOptions);

  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

  const handleCopyText = (p: { text: string, type: 'code' | 'pass' }) => {
    navigator.clipboard.writeText(p.text);
    if (p.type === 'code') {
      setCopiedCode(true);
      setTimeout(() => 
        setCopiedCode(false), 2000
      );
    } else {
      setCopiedPass(true);
      setTimeout(() => setCopiedPass(false), 2000);
    }
  };

  return (
    <Paper
      withBorder
      p="sm"
      radius="md"
      className="fixed bottom-6 left-6 z-50 bg-zinc-900/90 border-zinc-800 backdrop-blur-md shadow-2xl select-none"
      style={{ width: 260 }}
    >
      <Stack gap="xs">
        
        {/* ROOM OWNER SHARE HUB SUB-PANEL */}
        {activeRoom && (
          <Box className="bg-zinc-950/90 border border-teal-500/30 rounded-md p-2 shadow-inner mb-1">
            <Group gap="xs" mb={6} className="border-b border-zinc-800 pb-1">
              <Ticket size={12} className="text-teal-400" />
              <Text size="10px" fw={800} className="text-teal-400 tracking-wider uppercase font-sans">
                Room Access Keys
              </Text>
            </Group>
            
            <Stack gap={4}>
              <Group justify="space-between">
                <Text size="11px" className="text-zinc-400">Room Code:</Text>
                <Group gap={4}>
                  <Text size="11px" fw={700} className="font-mono text-zinc-100 bg-zinc-900 px-1 rounded border border-zinc-800">
                    {activeRoom.roomCode}
                  </Text>
                  <Tooltip label={copiedCode ? "Copied!" : "Copy Code"} position="top" withArrow>
                    <ActionIcon size="xs" variant="subtle" color="teal" onClick={() => handleCopyText({text: activeRoom.roomCode, type: 'code'})}>
                      <Copy size={10} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>

              <Group justify="space-between">
                <Text size="11px" className="text-zinc-400">Password:</Text>
                <Group gap={4}>
                  <Text size="11px" fw={700} className="font-mono text-zinc-100 bg-zinc-900 px-1 rounded border border-zinc-800 max-w-27.5 truncate">
                    {activeRoom.passwordPlain || <span className="italic text-zinc-600 font-sans fw-normal">None</span>}
                  </Text>
                  {activeRoom.passwordPlain && (
                    <Tooltip label={copiedPass ? "Copied!" : "Copy Password"} position="top" withArrow>
                      <ActionIcon size="xs" variant="subtle" color="teal" onClick={() => handleCopyText({text: activeRoom.passwordPlain, type: 'pass'})}>
                        <Copy size={10} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              </Group>
            </Stack>
          </Box>
        )}

        <Group gap="xs" className="border-b border-zinc-800 pb-2">
          <Sliders size={14} className="text-teal-400" />
          <Text size="xs" fw={700} className="text-zinc-200 uppercase tracking-wide">
            Canvas Overlay HUD
          </Text>
        </Group>

        <Box>
          <Group justify="space-between" mb={4}>
            <Text size="11px" color="zinc.4" className="flex items-center gap-1">
              <Maximize2 size={11} /> Frame Scale
            </Text>
            <Text size="11px" color="teal.4" fw={600}>{videoSize}px</Text>
          </Group>
          <Slider
            min={80}
            max={240}
            step={10}
            value={videoSize}
            onChange={(val) => dispatch(setUiStyles({ videoSize: val }))}
            color="teal"
            size="xs"
            label={null}
          />
        </Box>

        <Box>
          <Group justify="space-between" mb={4}>
            <Text size="11px" color="zinc.4" className="flex items-center gap-1">
              <Eye size={11} /> Alpha Transparency
            </Text>
            <Text size="11px" color="teal.4" fw={600}>{Math.round(videoOpacity * 100)}%</Text>
          </Group>
          <Slider
            min={0.1}
            max={1.0}
            step={0.05}
            value={videoOpacity}
            onChange={(val) => dispatch(setUiStyles({ videoOpacity: val }))}
            color="teal"
            size="xs"
            label={null}
          />
        </Box>
      </Stack>
    </Paper>
  );
}