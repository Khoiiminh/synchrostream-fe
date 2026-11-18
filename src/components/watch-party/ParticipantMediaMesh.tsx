import { ParticipantNode } from "@/store/slices/roomSlice";
import { ParticipantMedia } from "@/types/participantMedia";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AspectRatio, Box, Text } from "@mantine/core";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("ParticipantMediaMesh");

interface ParticipantMediaMeshProp {
    members: ParticipantNode[];
    participantMedia: ParticipantMedia[];
    localStream: MediaStream | null;
    localParticipantId: string;
    videoSize: number;
    videoOpacity: number;
    /** The local push-to-talk mic is open (the self tile has no audio track). */
    isLocalTalking?: boolean;
}

interface ParticipantMediaTileProps {
    member: ParticipantNode;
    media: ParticipantMedia | null;
    isLocalParticipant: boolean;
    videoSize: number;
    videoOpacity: number;
    isLocalTalking: boolean;

    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
}

interface MeshPosition {
    x: number;
    y: number;
}

/**
 * True while the stream's audio is above a speaking threshold. Uses a Web
 * Audio analyser on the remote stream (never the local mic), sampled ~8x/s.
 * An AudioContext created before any user gesture starts suspended, so it is
 * resumed on the first pointer or key press.
 */
function useIsSpeaking(stream: MediaStream | null, enabled: boolean): boolean {
    const [isSpeaking, setIsSpeaking] = useState(false);

    useEffect(() => {
        if (!enabled || !stream || stream.getAudioTracks().length === 0) {
            return;
        }

        const AudioContextCtor =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
                .webkitAudioContext;

        if (!AudioContextCtor) {
            return;
        }

        const context = new AudioContextCtor();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        const samples = new Uint8Array(analyser.fftSize);
        let speaking = false;
        let quietTicks = 0;

        const intervalId = window.setInterval(() => {
            analyser.getByteTimeDomainData(samples);

            let sumSquares = 0;
            for (const sample of samples) {
                const centered = (sample - 128) / 128;
                sumSquares += centered * centered;
            }
            const rms = Math.sqrt(sumSquares / samples.length);

            // Hysteresis: light up immediately, fade after ~0.5 s of quiet.
            if (rms > 0.02) {
                quietTicks = 0;
                if (!speaking) {
                    speaking = true;
                    setIsSpeaking(true);
                }
            } else if (speaking && ++quietTicks > 4) {
                speaking = false;
                setIsSpeaking(false);
            }
        }, 120);

        const resume = () => void context.resume();
        window.addEventListener("pointerdown", resume, { once: true });
        window.addEventListener("keydown", resume, { once: true });

        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener("pointerdown", resume);
            window.removeEventListener("keydown", resume);
            source.disconnect();
            void context.close();
            setIsSpeaking(false);
        };
    }, [stream, enabled]);

    return isSpeaking;
}

function initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ParticipantMediaTile({
    member,
    media,
    isLocalParticipant,
    videoSize,
    videoOpacity,
    isLocalTalking,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
}: ParticipantMediaTileProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        if (!videoRef.current) {
            return;
        }

        const videoElement = videoRef.current;

        if (!media?.hasVideo) {
            videoElement.srcObject = null;
            return;
        }

        videoElement.srcObject = media.stream;

        const playVideo = async () => {
            try {
                await videoElement.play();
            } catch (error) {
                log.debug("Video autoplay was blocked", {
                    participantId: member.participantId,
                    error,
                });
            }
        };

        void playVideo();

        return () => {
            if (videoElement.srcObject === media.stream) {
                videoElement.srcObject = null;
            }
        };
    }, [media, member.participantId]);

    useEffect(() => {
        if (!audioRef.current) {
            return;
        }

        const audioElement = audioRef.current;

        if (!media?.hasAudio) {
            audioElement.srcObject = null;
            return;
        }

        audioElement.srcObject = media.stream;

        const playAudio = async () => {
            try {
                await audioElement.play();
            } catch (error) {
                log.debug("Audio autoplay was blocked", {
                    participantId: member.participantId,
                    error,
                });
            }
        };

        void playAudio();

        return () => {
            if (audioElement.srcObject === media.stream) {
                audioElement.srcObject = null;
            }
        };
    }, [media, member.participantId]);

    const hasVideo = media?.hasVideo === true;
    const hasAudio = media?.hasAudio === true;

    const isRemoteSpeaking = useIsSpeaking(
        media?.stream ?? null,
        hasAudio && !isLocalParticipant,
    );
    const isSpeaking = isLocalParticipant ? isLocalTalking : isRemoteSpeaking;

    return (
        <Box
            className={`rounded-xl overflow-hidden border bg-zinc-950 pointer-events-auto transition-[box-shadow,border-color,width,height] duration-200 relative cursor-grab active:cursor-grabbing ${
                isSpeaking
                    ? "border-teal-300 shadow-[0_0_0_2px_rgba(45,212,191,0.9),0_0_24px_rgba(45,212,191,0.55)]"
                    : "border-white/10 shadow-xl shadow-black/50"
            }`}
            style={{
                width: videoSize,
                height: (videoSize * 3) / 4,
                opacity: videoOpacity,
                touchAction: "none",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
        >
            <AspectRatio ratio={4 / 3} className="w-full h-full relative">
                <Box className="w-full h-full bg-zinc-900 relative overflow-hidden">
                    {hasVideo ? (
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted={isLocalParticipant}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        // Camera off: initials avatar on a soft brand gradient.
                        <Box className="w-full h-full flex items-center justify-center bg-linear-to-br from-teal-900/60 via-zinc-900 to-sky-950/60">
                            <span
                                className="flex items-center justify-center rounded-full bg-teal-400/15 font-bold text-teal-200 ring-1 ring-teal-300/30"
                                style={{
                                    width: videoSize * 0.36,
                                    height: videoSize * 0.36,
                                    fontSize: videoSize * 0.13,
                                }}
                            >
                                {initialsOf(member.username)}
                            </span>
                        </Box>
                    )}

                    <Box className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center gap-1">
                        <span className="flex min-w-0 items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 backdrop-blur-sm">
                            {isSpeaking && (
                                <span
                                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-300"
                                    aria-label="Speaking"
                                />
                            )}
                            <Text
                                size="10px"
                                fw={600}
                                c="white"
                                truncate
                                title={
                                    !hasVideo && !hasAudio
                                        ? "Camera and microphone off"
                                        : !hasVideo && hasAudio
                                          ? "Audio only"
                                          : undefined
                                }
                            >
                                {member.username}
                                {isLocalParticipant ? " (You)" : ""}
                            </Text>
                        </span>
                    </Box>

                    {hasAudio && (
                        <audio
                            ref={audioRef}
                            autoPlay
                            playsInline
                            controls={false}
                        />
                    )}
                </Box>
            </AspectRatio>
        </Box>
    );
}

export default function ParticipantMediaMesh({
    members,
    participantMedia,
    localStream,
    localParticipantId,
    videoSize,
    videoOpacity,
    isLocalTalking = false,
}: ParticipantMediaMeshProp) {
    const mediaByParticipantId = new Map(
        participantMedia.map((media) => [media.participantId, media]),
    );

    // Self preview: camera only (never play our own mic back). Built once per
    // localStream; creating it on every render would give the tile a new
    // stream on each slider move or room update and reload the <video>.
    const localPreviewMedia = useMemo<ParticipantMedia | null>(() => {
        const videoTrack = localStream?.getVideoTracks()[0];

        if (!videoTrack) {
            return null;
        }

        return {
            participantId: localParticipantId,
            stream: new MediaStream([videoTrack]),
            hasAudio: false,
            hasVideo: true,
        };
    }, [localStream, localParticipantId]);

    /**
     * The entire participant mesh is treated as one floating overlay.
     *
     * x/y represent the mesh's position relative to the viewport.
     */
    // Below the top bar row (Back, settings, room pill), over the film's corner.
    const [position, setPosition] = useState<MeshPosition>({
        x: 40,
        y: 92,
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

    const handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;

        dragStateRef.current = {
            dragging: true,
            startPointerX: event.clientX,
            startPointerY: event.clientY,
            startPositionX: position.x,
            startPositionY: position.y,
        };

        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!dragStateRef.current.dragging) return;

        const deltaX = event.clientX - dragStateRef.current.startPointerX;
        const deltaY = event.clientY - dragStateRef.current.startPointerY;

        setPosition({
            x: Math.max(0, dragStateRef.current.startPositionX + deltaX),
            y: Math.max(0, dragStateRef.current.startPositionY + deltaY),
        });
    };

    const handleDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!dragStateRef.current.dragging) return;

        dragStateRef.current.dragging = false;

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    return (
        <Box
            className="fixed z-40 flex flex-wrap gap-3 pointer-events-auto cursor-grab active:cursor-grabbing"
            style={{
                left: position.x,
                top: position.y,
                maxWidth: "calc(100% - 48px)",
            }}
        >
            {members.map((member) => {
                const isLocalParticipant =
                    member.participantId === localParticipantId;

                const media =
                    isLocalParticipant && localPreviewMedia
                        ? localPreviewMedia
                        : (mediaByParticipantId.get(member.participantId) ??
                          null);

                return (
                    <ParticipantMediaTile
                        key={member.participantId}
                        member={member}
                        media={media}
                        isLocalParticipant={isLocalParticipant}
                        videoSize={videoSize}
                        videoOpacity={videoOpacity}
                        isLocalTalking={isLocalTalking}
                        onPointerDown={handleDragStart}
                        onPointerMove={handleDragMove}
                        onPointerUp={handleDragEnd}
                        onPointerCancel={handleDragEnd}
                    />
                );
            })}
        </Box>
    );
}
