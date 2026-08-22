"use client";

import React, { useEffect, useRef, useState } from "react";
import { Paper } from "@mantine/core";

import { MediaSyncController } from "@/core/sync/MediaSyncController";
import { QualityLevel } from "@/core/sync/ISyncAdapter";
import PlayerControls from "./PlayerControls";

interface VideoPlayerProps {
  controller: MediaSyncController | null;

  isPlaying: boolean;
  currentTime: number;
  duration: number;

  qualityLevels: QualityLevel[];

  onSeek: (value: number) => void;
  onDurationChange: (duration: number) => void;
  onQualityLevelsChange: (levels: QualityLevel[]) => void;
}

export default function VideoPlayer({
  controller,
  isPlaying,
  currentTime,
  duration,
  qualityLevels,
  onSeek,
  onDurationChange,
  onQualityLevelsChange,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);

  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [prevVolume, setPrevVolume] = useState(1);

  const [isFullscreen, setIsFullscreen] = useState(false);

  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [currentQuality, setCurrentQuality] = useState("Auto");
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);

  /*
   * Attach the controller to the actual video element.
   *
   * VideoPlayer owns the DOM element, so VideoPlayer also owns
   * the controller <-> video attachment lifecycle.
   */
  useEffect(() => {
    if (!videoElement || !controller) {
      return;
    }

    controller.attach(videoElement);

    const handleDurationChange = () => {
      onDurationChange(videoElement.duration || 0);
    };

    const syncQualityTracks = () => {
      const levels = controller.getQualityLevels();

      onQualityLevelsChange(levels);

      const currentIndex = controller.getCurrentQualityIndex();

      if (currentIndex === -1) {
        setCurrentQuality("Auto");
        return;
      }

      const currentLevel = levels.find(
        (level) => level.index === currentIndex,
      );

      if (currentLevel) {
        setCurrentQuality(`${currentLevel.height}p`);
      }
    };

    videoElement.addEventListener("durationchange", handleDurationChange);
    videoElement.addEventListener("loadedmetadata", handleDurationChange);
    videoElement.addEventListener("loadedmetadata", syncQualityTracks);

    return () => {
      videoElement.removeEventListener(
        "durationchange",
        handleDurationChange,
      );

      videoElement.removeEventListener(
        "loadedmetadata",
        handleDurationChange,
      );

      videoElement.removeEventListener(
        "loadedmetadata",
        syncQualityTracks,
      );

      controller.detach();

      onDurationChange(0);
      onQualityLevelsChange([]);
    };
  }, [
    videoElement,
    controller,
    onDurationChange,
    onQualityLevelsChange,
  ]);

  /*
   * Controls auto-hide timer.
   */
  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  /*
   * Native fullscreen state.
   */
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener(
      "fullscreenchange",
      handleFullscreenChange,
    );

    return () => {
      document.removeEventListener(
        "fullscreenchange",
        handleFullscreenChange,
      );
    };
  }, []);

  const handleMouseMove = () => {
    setShowControls(true);

    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }

    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 2500);
  };

  const handleMouseLeave = () => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }

    if (isPlaying) {
      setShowControls(false);
    }
  };

  const handleVolumeChange = (value: number) => {
    setVolume(value);

    if (videoRef.current) {
      videoRef.current.volume = value;
    }

    if (value > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);

      handleVolumeChange(
        prevVolume > 0 ? prevVolume : 1,
      );

      return;
    }

    setPrevVolume(volume);
    setIsMuted(true);

    if (videoRef.current) {
      videoRef.current.volume = 0;
    }
  };

  const handleQualityChange = (
    levelIndex: number | "auto",
  ) => {
    if (!controller) {
      return;
    }

    if (levelIndex === "auto") {
      controller.setQualityLevel(-1);
      setCurrentQuality("Auto");
      return;
    }

    controller.setQualityLevel(levelIndex);

    const selectedLevel = qualityLevels.find(
      (level) => level.index === levelIndex,
    );

    if (selectedLevel) {
      setCurrentQuality(`${selectedLevel.height}p`);
    }
  };

  const toggleFullscreen = async () => {
    if (!playerContainerRef.current) {
      return;
    }

    try {
      if (!document.fullscreenElement) {
        await playerContainerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error(
        "Failed to shift display bounds context configuration:",
        error,
      );
    }
  };

  return (
    <div
      ref={playerContainerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`w-full flex items-center justify-center bg-black transition-none relative overflow-hidden rounded-md border border-zinc-800/50 ${
        showControls
          ? "cursor-default"
          : "cursor-none"
      }`}
      style={
        isFullscreen
          ? {
              width: "100vw",
              height: "100vh",
              maxHeight: "100vh",
              maxWidth: "100vw",
            }
          : {
              aspectRatio: "16/9",
              maxHeight: "calc(100vh - 220px)",
            }
      }
    >
      <Paper
        radius="none"
        className="bg-transparent relative w-full h-full overflow-hidden z-10 flex items-center justify-center"
        style={{
          width: "100%",
          height: "100%",
          maxWidth: "100%",
          maxHeight: "100%",
        }}
      >
        <video
          ref={(element) => {
            videoRef.current = element;
            setVideoElement(element);
          }}
          className="w-full h-full object-contain block bg-black"
          controls={false}
          playsInline
        />

        <div
          className={`absolute bottom-0 left-0 right-0 w-full transition-opacity duration-300 z-30 ${
            showControls
              ? "opacity-100 pointer-events-auto"
              : "opacity-0 pointer-events-none"
          }`}
        >
          <PlayerControls
            videoElement={videoElement}
            controller={controller}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            volume={volume}
            isMuted={isMuted}
            isFullscreen={isFullscreen}
            qualityLevels={qualityLevels}
            currentQuality={currentQuality}
            qualityMenuOpen={qualityMenuOpen}
            onVolumeChange={handleVolumeChange}
            onMuteToggle={toggleMute}
            onSeek={onSeek}
            onQualityMenuToggle={() =>
              setQualityMenuOpen((open) => !open)
            }
            onQualityMenuClose={() =>
              setQualityMenuOpen(false)
            }
            onQualityChange={handleQualityChange}
            onFullscreenToggle={toggleFullscreen}
          />
        </div>
      </Paper>
    </div>
  );
}