"use client";

import React, { useEffect, useRef, useState } from "react";
import { Paper } from "@mantine/core";

import { MediaSyncController } from "@/core/sync/MediaSyncController";
import { QualityLevel } from "@/core/sync/ISyncAdapter";
import PlayerControls from "./PlayerControls";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("VideoPlayer");

interface VideoPlayerProps {
    controller: MediaSyncController | null;

    onControllerAttachmentChange?: (
        controller: MediaSyncController,
        attached: boolean,
    ) => void;

    isPlaying: boolean;
    currentTime: number;
    duration: number;

    qualityLevels: QualityLevel[];

    onSeek: (value: number) => void;
    onDurationChange: (duration: number) => void;
    onQualityLevelsChange: (levels: QualityLevel[]) => void;

    /** Shown blurred behind the start screen until playback first begins. */
    posterUrl?: string;
    title?: string;
    /** One line under the start button, e.g. "3 watching". */
    startSubtitle?: string;
}

export default function VideoPlayer({
    controller,
    onControllerAttachmentChange,
    isPlaying,
    currentTime,
    duration,
    qualityLevels,
    onSeek,
    onDurationChange,
    onQualityLevelsChange,
    posterUrl,
    title,
    startSubtitle,
}: VideoPlayerProps) {
    // Start screen: shown until the film has played at all, so a new room is
    // not a black rectangle. Any seek or play past 0.5 s dismisses it.
    const showStartScreen = !isPlaying && currentTime < 0.5;

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const playerContainerRef = useRef<HTMLDivElement | null>(null);

    const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(
        null,
    );

    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [prevVolume, setPrevVolume] = useState(1);

    const [isFullscreen, setIsFullscreen] = useState(false);

    const [showControls, setShowControls] = useState(true);
    const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [currentQuality, setCurrentQuality] = useState("Auto");
    const [qualityMenuOpen, setQualityMenuOpen] = useState(false);

    /*
     * Ambient glow: a tiny canvas mirrors the current frame a few times a
     * second and is shown heavily blurred behind the player, so the page
     * picks up the film's colours. Drawing a cross-origin video into a
     * canvas only "taints" it for pixel reads, which we never do.
     */
    const ambientCanvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = ambientCanvasRef.current;
        const ctx = canvas?.getContext("2d");

        if (!videoElement || !canvas || !ctx) {
            return;
        }

        const paint = () => {
            if (document.hidden || videoElement.readyState < 2) {
                return;
            }

            try {
                ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
            } catch {
                // Frame not decodable yet; try again on the next tick.
            }
        };

        const intervalId = window.setInterval(paint, 300);
        videoElement.addEventListener("seeked", paint);
        videoElement.addEventListener("loadeddata", paint);

        return () => {
            window.clearInterval(intervalId);
            videoElement.removeEventListener("seeked", paint);
            videoElement.removeEventListener("loadeddata", paint);
        };
    }, [videoElement]);

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

        onControllerAttachmentChange?.(controller, true);

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

            onControllerAttachmentChange?.(controller, false);

            controller.detach();

            onDurationChange(0);
            onQualityLevelsChange([]);
        };
    }, [
        videoElement,
        controller,
        onControllerAttachmentChange,
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

        document.addEventListener("fullscreenchange", handleFullscreenChange);

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

            handleVolumeChange(prevVolume > 0 ? prevVolume : 1);

            return;
        }

        setPrevVolume(volume);
        setIsMuted(true);

        if (videoRef.current) {
            videoRef.current.volume = 0;
        }
    };

    const handleQualityChange = (levelIndex: number | "auto") => {
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
            log.error(
                "Failed to shift display bounds context configuration:",
                error,
            );
        }
    };

    return (
        <div className="relative w-full">
            <canvas
                ref={ambientCanvasRef}
                width={32}
                height={18}
                aria-hidden="true"
                className="pointer-events-none absolute -inset-x-16 -inset-y-12 z-0 h-[calc(100%+6rem)] w-[calc(100%+8rem)] opacity-90 blur-[60px] saturate-150"
            />
            <div
                ref={playerContainerRef}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                className={`w-full flex items-center justify-center bg-black transition-none relative z-10 overflow-hidden rounded-xl border border-white/10 shadow-2xl shadow-black/60 ${
                    showControls ? "cursor-default" : "cursor-none"
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

                    {showStartScreen && (
                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 overflow-hidden">
                            {posterUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={posterUrl}
                                    alt=""
                                    aria-hidden="true"
                                    className="absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-sm"
                                />
                            )}
                            <div className="absolute inset-0 bg-radial from-black/30 via-black/60 to-black/90" />

                            <button
                                type="button"
                                onClick={() => void controller?.play()}
                                disabled={!controller}
                                aria-label="Play"
                                className="group relative flex h-20 w-20 cursor-pointer items-center justify-center rounded-full bg-teal-400 text-zinc-950 shadow-[0_0_40px_rgba(45,212,191,0.55)] transition-transform hover:scale-110 disabled:cursor-wait disabled:opacity-60"
                            >
                                <span className="absolute inset-0 animate-ping rounded-full bg-teal-400/40 [animation-duration:2s] group-disabled:hidden" />
                                <svg
                                    viewBox="0 0 24 24"
                                    className="relative ml-1 h-8 w-8"
                                    fill="currentColor"
                                    aria-hidden="true"
                                >
                                    <path d="M7 4.5v15l13-7.5z" />
                                </svg>
                            </button>

                            {title && (
                                <div className="relative text-center">
                                    <div className="text-2xl font-black tracking-tight text-white md:text-3xl">
                                        {title}
                                    </div>
                                    {startSubtitle && (
                                        <div className="mt-1 text-sm text-zinc-300">
                                            {startSubtitle}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

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
                            onQualityMenuClose={() => setQualityMenuOpen(false)}
                            onQualityChange={handleQualityChange}
                            onFullscreenToggle={toggleFullscreen}
                        />
                    </div>
                </Paper>
            </div>
        </div>
    );
}
