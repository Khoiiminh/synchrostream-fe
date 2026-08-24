import React from "react";
import { Group, Slider } from "@mantine/core";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Minimize,
  Maximize,
} from "lucide-react";

import { MediaSyncController } from "@/core/sync/MediaSyncController";
import { QualityLevel } from "@/core/sync/ISyncAdapter";
import PlaybackTime from "./PlaybackTime";
import QualityMenu from "./QualityMenu";

interface PlayerControlsProps {
  controller: MediaSyncController | null;

  videoElement: HTMLVideoElement | null;

  isPlaying: boolean;
  currentTime: number;
  duration: number;

  volume: number;
  isMuted: boolean;

  isFullscreen: boolean;

  qualityLevels: QualityLevel[];
  currentQuality: string;
  qualityMenuOpen: boolean;

  onVolumeChange: (value: number) => void;
  onMuteToggle: () => void;

  onSeek: (value: number) => void;

  onQualityMenuToggle: () => void;
  onQualityMenuClose: () => void;
  onQualityChange: (levelIndex: number | "auto") => void;

  onFullscreenToggle: () => void;
}

export default function PlayerControls({
  controller,
  isPlaying,
  currentTime,
  duration,
  volume,
  isMuted,
  isFullscreen,
  qualityLevels,
  currentQuality,
  qualityMenuOpen,
  onVolumeChange,
  onMuteToggle,
  onSeek,
  onQualityMenuToggle,
  onQualityMenuClose,
  onQualityChange,
  onFullscreenToggle,
}: PlayerControlsProps) {
    
  return (
    <div className="absolute bottom-0 left-0 right-0 w-full p-4 bg-linear-to-t from-black/95 via-black/60 to-transparent transition-opacity duration-300 z-30">
      <div className="w-full px-1 mb-2">
        <Slider
          size="sm"
          color="blue"
          label={(value) => {
            const hours = Math.floor(value / 3600);
            const minutes = Math.floor((value % 3600) / 60);
            const seconds = Math.floor(value % 60);

            const pad = (num: number) => String(num).padStart(2, "0");

            return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
          }}
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={onSeek}
          styles={{
            root: {
              display: "flex",
              alignItems: "center",
            },
            track: {
              cursor: "pointer",
              height: 4,
            },
            thumb: {
              transition: "transform 0.1s ease",
              cursor: "pointer",
            },
          }}
        />
      </div>

      <Group justify="space-between" align="center" className="w-full">
        <Group gap="md">
          {isPlaying ? (
            <button
              onClick={() => {
                void controller?.pause();
              }}
              className="text-white hover:text-zinc-300 transition-colors focus:outline-hidden cursor-pointer flex items-center"
              title="Pause"
            >
              <Pause size={20} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => {
                void controller?.play();
              }}
              className="text-blue-400 hover:text-blue-300 transition-colors focus:outline-hidden cursor-pointer flex items-center"
              title="Play"
            >
              <Play size={20} fill="currentColor" />
            </button>
          )}

          <PlaybackTime
            currentTime={currentTime}
            duration={duration}
          />

          <Group gap="xs" style={{ width: 110 }} className="ml-2">
            <button
              onClick={onMuteToggle}
              className="text-white hover:text-zinc-300 transition-colors focus:outline-hidden cursor-pointer flex items-center"
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted || volume === 0 ? (
                <VolumeX size={18} />
              ) : (
                <Volume2 size={18} />
              )}
            </button>

            <Slider
              size="xs"
              color="blue"
              label={null}
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={onVolumeChange}
              style={{ flex: 1 }}
              styles={{
                thumb: {
                  transition: "transform 0.1s ease",
                },
              }}
            />
          </Group>
        </Group>

        <Group gap="sm">
          <QualityMenu
            qualityLevels={qualityLevels}
            currentQuality={currentQuality}
            qualityMenuOpen={qualityMenuOpen}
            onToggle={onQualityMenuToggle}
            onClose={onQualityMenuClose}
            onQualityChange={onQualityChange}
          />

          <button
            onClick={onFullscreenToggle}
            className="text-white hover:text-zinc-300 transition-colors focus:outline-hidden cursor-pointer p-1 z-50 relative flex items-center"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize size={20} />
            ) : (
              <Maximize size={20} />
            )}
          </button>
        </Group>
      </Group>
    </div>
  );
}