import React from "react";
import { Group, Text } from "@mantine/core";

interface PlaybackTimeProps {
  currentTime: number;
  duration: number;
}

const formatTime = (timeInSeconds: number): string => {
  if (isNaN(timeInSeconds) || timeInSeconds < 0) {
    return "00:00:00";
  }

  const hours = Math.floor(timeInSeconds / 3600);
  const minutes = Math.floor((timeInSeconds % 3600) / 60);
  const seconds = Math.floor(timeInSeconds % 60);

  const pad = (num: number) => String(num).padStart(2, "0");

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};

export default function PlaybackTime({
  currentTime,
  duration,
}: PlaybackTimeProps) {
  return (
    <Group gap="xs" className="select-none">
      <Text
        size="sm"
        fw={500}
        className="text-zinc-200 font-mono tracking-wider"
      >
        {formatTime(currentTime)}
      </Text>

      <Text size="sm" fw={500} className="text-zinc-500 font-mono">
        /
      </Text>

      <Text
        size="sm"
        fw={500}
        className="text-zinc-400 font-mono tracking-wider"
      >
        {formatTime(duration)}
      </Text>
    </Group>
  );
}

export { formatTime };