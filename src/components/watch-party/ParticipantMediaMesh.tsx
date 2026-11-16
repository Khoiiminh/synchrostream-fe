import { ParticipantNode } from "@/store/slices/roomSlice";
import { ParticipantMedia } from "@/types/participantMedia";
import React, { useEffect, useRef, useState } from "react";
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
}

interface ParticipantMediaTileProps {
    member: ParticipantNode;
    media: ParticipantMedia | null;
    isLocalParticipant: boolean;
    videoSize: number;
    videoOpacity: number;

    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
}

interface MeshPosition {
    x: number;
    y: number;
}

function ParticipantMediaTile({
    member,
    media,
    isLocalParticipant,
    videoSize,
    videoOpacity,
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

    return (
        <Box
            className="rounded-lg overflow-hidden border border-white/10 bg-zinc-950 shadow-xl pointer-events-auto transition-all duration-200 relative cursor-grab active:cursor-grabbing"
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
                        <Box className="w-full h-full flex items-center justify-center">
                            <Text size="10px" c="dimmed" className="font-mono">
                                {member.username}
                            </Text>
                        </Box>
                    )}

                    <Box className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/50">
                        <Text size="10px" c="white" className="font-mono">
                            {member.username}
                            {isLocalParticipant ? " (You)" : ""}
                        </Text>

                        {!hasVideo && hasAudio && (
                            <Text size="9px" c="dimmed" className="font-mono">
                                Audio only
                            </Text>
                        )}

                        {!hasVideo && !hasAudio && (
                            <Text size="9px" c="dimmed" className="font-mono">
                                Camera and microphone off
                            </Text>
                        )}
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
}: ParticipantMediaMeshProp) {
    const mediaByParticipantId = new Map(
        participantMedia.map((media) => [media.participantId, media]),
    );

    /**
     * The entire participant mesh is treated as one floating overlay.
     *
     * x/y represent the mesh's position relative to the viewport.
     */
    const [position, setPosition] = useState<MeshPosition>({
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

                let media =
                    mediaByParticipantId.get(member.participantId) ?? null;

                if (isLocalParticipant && localStream) {
                    const videoTrack = localStream.getVideoTracks()[0];

                    if (videoTrack) {
                        const cameraOnlyStream = new MediaStream([videoTrack]);

                        media = {
                            participantId: localParticipantId,
                            stream: cameraOnlyStream,
                            hasAudio: false,
                            hasVideo: true,
                        };
                    }
                }

                return (
                    <ParticipantMediaTile
                        key={member.participantId}
                        member={member}
                        media={media}
                        isLocalParticipant={isLocalParticipant}
                        videoSize={videoSize}
                        videoOpacity={videoOpacity}
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
