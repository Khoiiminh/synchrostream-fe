import { useEffect, useRef, useState } from "react";
import { useGetLiveKitMediaSessionConnectionMutation } from "../api/mediaSessionApi";
import {
    LiveKitMediaEngine,
    type LiveKitMediaEngineStatus,
} from "../engine/LiveKitMediaEngine";
import type { ParticipantMedia } from "../types/participantMedia";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("PartyPage");

/**
 * The room's LiveKit media: fetches this member's connection token for the
 * room's media session, then runs a LiveKitMediaEngine with it. Exposes the
 * remote participants' media, the local stream and the microphone state.
 */
export function useLiveKitMedia(p: {
    mediaSessionId: string | null | undefined;
    userId: string | null;
    isAuthenticated: boolean;
    isAuthHydrated: boolean;
}) {
    const { mediaSessionId, userId, isAuthenticated, isAuthHydrated } = p;

    const [
        getLiveKitMediaSessionConnection,
        { data: liveKitMediaSessionConnection },
    ] = useGetLiveKitMediaSessionConnectionMutation();

    const engineRef = useRef<LiveKitMediaEngine | null>(null);

    const [participantMedia, setParticipantMedia] = useState<
        ParticipantMedia[]
    >([]);

    const [liveKitStatus, setLiveKitStatus] =
        useState<LiveKitMediaEngineStatus>("DISCONNECTED");

    const [localStream, setLocalStream] = useState<MediaStream | null>(null);

    // Push-to-talk keeps the microphone closed unless the talk key or button
    // is held: a browser tab that holds the mic gets its playback (the movie)
    // lowered by Windows, so an always-open mic would break the movie.
    const [isMicActive, setIsMicActive] = useState(false);
    const [micError, setMicError] = useState<string | null>(null);

    // Get LiveKit MediaSession connection
    useEffect(() => {
        if (!mediaSessionId) {
            return;
        }

        if (!isAuthHydrated) {
            return;
        }

        if (!userId || !isAuthenticated) {
            return;
        }

        const connectToLiveKitMediaSession = async () => {
            try {
                log.debug("Resolving LiveKit MediaSession connection", {
                    mediaSessionId,
                });

                const connection =
                    await getLiveKitMediaSessionConnection(
                        mediaSessionId,
                    ).unwrap();

                log.debug("LiveKit connection blueprint received", {
                    mediaSessionId: connection.data.mediaSessionId,
                    participantId: connection.data.participantId,
                    serverUrl: connection.data.serverUrl,
                    hasParticipantToken: !!connection.data.participantToken,
                });
            } catch (error) {
                log.error(
                    "Failed to obtain LiveKit connection blueprint",
                    error,
                );
            }
        };

        void connectToLiveKitMediaSession();
    }, [
        mediaSessionId,
        getLiveKitMediaSessionConnection,
        userId,
        isAuthenticated,
        isAuthHydrated,
    ]);

    // Connect LiveKitMediaEngine using the connection
    useEffect(() => {
        if (!mediaSessionId) {
            return;
        }

        if (!isAuthHydrated) {
            return;
        }

        if (!userId || !isAuthenticated) {
            return;
        }

        if (!liveKitMediaSessionConnection?.data) {
            return;
        }

        const connection = liveKitMediaSessionConnection.data;

        const engine = new LiveKitMediaEngine();

        engineRef.current = engine;

        const removeMediaListener = engine.onMediaUpdate((media) => {
            setParticipantMedia(media);
        });

        const removeStatusListener = engine.onStatusUpdate((status, error) => {
            setLiveKitStatus(status);

            if (error) {
                log.error("LiveKit media error", error);
            }
        });

        const removeLocalStreamListener = engine.onLocalStreamUpdate(
            (stream) => {
                log.debug("LiveKit local stream received", {
                    streamId: stream?.id ?? null,
                    audioTracks: stream?.getAudioTracks().length ?? 0,
                    videoTracks: stream?.getVideoTracks().length ?? 0,
                });

                setLocalStream(stream);
            },
        );

        const removeMicrophoneListener = engine.onMicrophoneUpdate(
            (active, error) => {
                setIsMicActive(active);

                if (error) {
                    setMicError(
                        error.name === "NotAllowedError"
                            ? "Microphone access is blocked. Allow it in the browser address bar to talk."
                            : error.message,
                    );
                } else if (active) {
                    setMicError(null);
                }
            },
        );

        const connectToLiveKit = async () => {
            try {
                log.debug("Connecting LiveKit media engine", {
                    mediaSessionId: connection.mediaSessionId,
                    participantId: connection.participantId,
                    serverUrl: connection.serverUrl,
                });

                await engine.connect({
                    mediaSessionId: connection.mediaSessionId,
                    participantId: connection.participantId,
                    serverUrl: connection.serverUrl,
                    participantToken: connection.participantToken,
                });

                log.debug("LiveKit media engine connected");

                await engine.enableLocalMedia();

                log.debug("Local camera and microphone enabled");
            } catch (error) {
                log.error("Failed to connect LiveKit media engine", error);
            }
        };

        void connectToLiveKit();

        return () => {
            removeMediaListener();
            removeStatusListener();
            removeLocalStreamListener();
            removeMicrophoneListener();

            void engine.disconnect();

            if (engineRef.current === engine) {
                engineRef.current = null;
            }

            setParticipantMedia([]);
            setLocalStream(null);
            setIsMicActive(false);
            setLiveKitStatus("DISCONNECTED");
        };
    }, [
        mediaSessionId,
        liveKitMediaSessionConnection,
        userId,
        isAuthenticated,
        isAuthHydrated,
    ]);

    return {
        engineRef,
        participantMedia,
        liveKitStatus,
        localStream,
        isMicActive,
        micError,
        localParticipantId:
            liveKitMediaSessionConnection?.data.participantId ?? "",
    };
}
