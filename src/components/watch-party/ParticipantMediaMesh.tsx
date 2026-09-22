import { ParticipantNode } from "@/store/slices/roomSlice";
import { ParticipantMedia } from "@/core/services/SfuMediaEngine";
import { useEffect, useMemo, useRef } from "react";
import { AspectRatio, Box, Text } from "@mantine/core";

interface ParticipantMediaMeshProp {
    members: ParticipantNode[];
    participantMedia: ParticipantMedia[];
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
}

function ParticipantMediaTile({
    member,
    media,
    isLocalParticipant,
    videoSize,
    videoOpacity,
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
                console.debug(
                    "[ParticipantMediaTile] Video autoplay was blocked",
                    {
                        participantId: member.participantId,
                        error,
                    },
                );
            }
        };

        void playVideo();

        return () => {
            if (videoElement.srcObject === media.stream) {
                videoElement.srcObject = null;
            }
        };
    }, [
        media,
        member.participantId,
    ]);

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
                console.debug(
                    "[ParticipantMediaTile] Audio autoplay was blocked",
                    {
                        participantId: member.participantId,
                        error,
                    },
                );
            }
        };

        void playAudio();

        return () => {
            if (audioElement.srcObject === media.stream) {
                audioElement.srcObject = null;
            }
        };
    }, [
        media,
        member.participantId,
    ]);

    const hasVideo = media?.hasVideo === true;
    const hasAudio = media?.hasAudio === true;

    return (
        <Box
            className="rounded-lg overflow-hidden border border-white/10 bg-zinc-950 shadow-xl pointer-events-auto transition-all duration-200 relative"
            style={{
                width: videoSize,
                height: (videoSize * 3) / 4,
                opacity: videoOpacity,
            }}
        >
            <AspectRatio
                ratio={4 / 3}
                className="w-full h-full relative"
            >
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
                        <Text
                            size="10px"
                            c="dimmed"
                            className="font-mono"
                        >
                            {member.username}
                        </Text>
                    </Box>
                )}

                <Box className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/50">
                    <Text
                        size="10px"
                        c="white"
                        className="font-mono"
                    >
                        {member.username}
                        {isLocalParticipant ? " (You)" : ""}
                    </Text>

                    {!hasVideo && hasAudio && (
                    <Text
                        size="9px"
                        c="dimmed"
                        className="font-mono"
                    >
                        Audio only
                    </Text>
                    )}

                    {!hasVideo && !hasAudio && (
                    <Text
                        size="9px"
                        c="dimmed"
                        className="font-mono"
                    >
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
    localParticipantId,
    videoSize,
    videoOpacity,
}: ParticipantMediaMeshProp) {
    const mediaByParticipantId = useMemo(() => {
        const map = new Map<string, ParticipantMedia>();

        participantMedia.forEach((media) => {
            map.set(media.participantId, media);
        });

        return map;
    }, [participantMedia]);

    return (
        <Box
            className="absolute top-6 left-6 z-40 flex flex-wrap gap-3 pointer-events-none"
            style={{
                maxWidth: "calc(100% - 48px)",
            }}
        >
            {members.map((member) => {
                const media =  mediaByParticipantId.get(
                    member.participantId,
                ) ?? null;

                return (
                <ParticipantMediaTile
                    key={member.participantId}
                    member={member}
                    media={media}
                    isLocalParticipant={
                        member.participantId === localParticipantId
                    }
                    videoSize={videoSize}
                    videoOpacity={videoOpacity}
                />
                );
            })}
        </Box>
    )
}