'use client';

import { memo, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Box, Text } from "@mantine/core";
import { useAppSelector } from "@/store/hooks";
import { useEngine } from "@/context/EngineContext";
import WatchClientLeaf from "@/components/watch/WatchClientLeaf";
import StyleControllerPanel from "@/components/watch-party/StyleControllerPanel";
import FloatingChatOverlay from "@/components/watch-party/FloatingChatOverlay";
import NavbarWrapper from "@/components/commons/NavbarWrapper";
import { useGetLiveKitMediaSessionConnectionMutation } from "@/store/services/mediaSessionApi";
import {
  LiveKitMediaEngine,
  LiveKitMediaEngineStatus,
} from "@/core/services/LiveKitMediaEngine";
import ParticipantMediaMesh from "@/components/watch-party/ParticipantMediaMesh";
import { ParticipantMedia } from "@/core/types/ParticipantMedia.type";
  
/**
 * -------------------------------------------------------------
 *                    memoized components
 * -------------------------------------------------------------
 */
const MemoizedParticipantMediaMesh = memo(ParticipantMediaMesh);
const MemoizedWatchClientLeaf = memo(WatchClientLeaf);
const MemoizedStyleControllerPanel = memo(StyleControllerPanel);
const MemoizedFloatingChatOverlay = memo(FloatingChatOverlay);


export default function IntegratedWatchPartyPage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const { gatewayEngine } = useEngine();
  const router = useRouter();
  const activeRoom = useAppSelector((state) => state.room.activeRoom);

  const mediaSessionId = activeRoom?.mediaSessionId;
  const roomMembers = activeRoom?.members;

  const { videoSize, videoOpacity } = useAppSelector((state) => state.room.uiOptions);
  const userId = useAppSelector((state) => state.auth.userId);
  const searchParams = useSearchParams();
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const isAuthHydrated = useAppSelector((state) => state.auth.isAuthHydrated);
 
  const [
    getLiveKitMediaSessionConnection,
    {
      data: liveKitMediaSessionConnection,
      isLoading: isLiveKitMediaSessionConnectionLoading,
      error: liveKitMediaSessionConnectionError,
    },
  ] = useGetLiveKitMediaSessionConnectionMutation();

  const liveKitMediaEngineRef = useRef<LiveKitMediaEngine | null>(null);

  const [participantMedia, setParticipantMedia] = useState<ParticipantMedia[]>([]);

  const [liveKitStatus, setLiveKitStatus] = useState<LiveKitMediaEngineStatus>("DISCONNECTED");

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  // Fallback Hierarchy
  // Read from incoming webscoket activeRoom state, if empty fetch from the source URL (?mediaId=...)
  const queryPassword = searchParams.get('pwd') || '';
  const resolvedMovieId = activeRoom?.movieId || '';

  console.log("[PartyPage] activeRoom state", {
    activeRoom,
    movieId: activeRoom?.movieId,
    resolvedMovieId,
  });

  // Gateway connection effect
  useEffect(() => {
    console.log("[PartyPage] Gateway effect entered", {
      roomCode,
      userId,
      queryPassword,
    });

    if (!isAuthHydrated) {
      console.log(
        '[PartyPage] Waiting for auth hydration'
      );
      return;
    }

    if (!roomCode || !userId || !isAuthenticated) {
      console.log('[PartyPage] Gateway connection blocked', {
        hasRoomCode: !!roomCode,
        hasUserId: !!userId,
        isAuthenticated,
      });

      return;
    }

    console.log("[PartyPage] Calling gatewayEngine.connect()", {
      roomCode,
      userId,
    });

    gatewayEngine.connect({
      dto: {
        roomCode,
        passwordPlain: queryPassword,
      },
      userId,
    });

    console.log("[PartyPage] gatewayEngine.connect() called");

    const handleRoomTerminated = (data: { message: string }) => {
      alert(data.message || 'The watch party session has been closed by the host.');
      router.push('/catalog');
    };

    const removeRoomTerminatedListener = gatewayEngine.on({event: 'room:terminated', callback: handleRoomTerminated});

    return () => {
      removeRoomTerminatedListener();
      gatewayEngine.disconnect();
    };
  }, [userId, roomCode, queryPassword, gatewayEngine, router, isAuthHydrated, isAuthenticated]);

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
        console.log("[PartyPage] Resolving LiveKit MediaSession connection", {
          mediaSessionId,
        });

        const connection = await getLiveKitMediaSessionConnection(
          mediaSessionId,
        ).unwrap();

        console.log(
          "[PartyPage] LiveKit connection blueprint received",
          {
            mediaSessionId: connection.data.mediaSessionId,
            participantId: connection.data.participantId,
            serverUrl: connection.data.serverUrl,
            hasParticipantToken: !!connection.data.participantToken,
          },
        );
      } catch (error) {
        console.error(
          "[PartyPage] Failed to obtain LiveKit connection blueprint",
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

    liveKitMediaEngineRef.current = engine;

    const removeMediaListener = engine.onMediaUpdate((media) => {
      setParticipantMedia(media);
    });

    const removeStatusListener = engine.onStatusUpdate((status, error) => {
      setLiveKitStatus(status);

      if (error) {
        console.error(
          "[PartyPage] LiveKit media error",
          error,
        );
      }
    });

    const removeLocalStreamListener =engine.onLocalStreamUpdate((stream) => {
      console.log(
        "[PartyPage DEBUG] LIVEKIT LOCAL STREAM RECEIVED",
        {
          streamId: stream?.id ?? null,
          audioTracks:
            stream?.getAudioTracks().length ?? 0,
          videoTracks:
            stream?.getVideoTracks().length ?? 0,
        },
      );

      setLocalStream(stream);
    });

    const connectToLiveKit = async () => {
      try {
        console.log(
          "[PartyPage] Connecting LiveKit media engine",
          {
            mediaSessionId: connection.mediaSessionId,
            participantId: connection.participantId,
            serverUrl: connection.serverUrl,
          },
        );

        await engine.connect({
          mediaSessionId: connection.mediaSessionId,
          participantId: connection.participantId,
          serverUrl: connection.serverUrl,
          participantToken: connection.participantToken,
        });

        console.log(
          "[PartyPage] LiveKit media engine connected",
        );

        await engine.enableLocalMedia();

        console.log(
          "[PartyPage] Local camera and microphone enabled",
        );
      } catch (error) {
        console.error(
          "[PartyPage] Failed to connect LiveKit media engine",
          error,
        );
      }
    };

    void connectToLiveKit();

    return () => {
      removeMediaListener();
      removeStatusListener();
      removeLocalStreamListener();

      void engine.disconnect();

      if (liveKitMediaEngineRef.current === engine) {
        liveKitMediaEngineRef.current = null;
      }

      setParticipantMedia([]);
      setLocalStream(null);
      setLiveKitStatus("DISCONNECTED");
    };
  }, [
    mediaSessionId,
    liveKitMediaSessionConnection,
    userId,
    isAuthenticated,
    isAuthHydrated,
  ]);

  // beforeunload effect
  useEffect(() => {
    const handleWindowClose = () => {
      gatewayEngine.disconnect();   // Explicitly cut socket link before tab thread dies
    };

    window.addEventListener("beforeunload", handleWindowClose);
    return () => {
      window.removeEventListener("beforeunload", handleWindowClose);
    }
  }, [gatewayEngine]);

  // Auth logging effect
  useEffect(() => {
    console.log('[PartyPage] Auth state', {
      userId,
      roomCode,
      isAuthenticated,
    });
  }, [userId, roomCode, isAuthenticated]);

  // Prevent downstream player crashing if neither the ws room state nor URL query params contain an ID
  if (!resolvedMovieId) {
    return (
      <NavbarWrapper>
        <Box className="w-full h-[calc(100vh-64px)] bg-black flex items-center justify-center text-zinc-500">
          <Text size="sm">Waiting for watch room state...</Text>
        </Box>
      </NavbarWrapper>
    )
  }
  return (
    <>
      <MemoizedParticipantMediaMesh
        members={roomMembers ?? []}
        participantMedia={participantMedia}
        localStream={localStream}
        localParticipantId={
          liveKitMediaSessionConnection?.data.participantId ?? ""
        }
        videoSize={videoSize}
        videoOpacity={videoOpacity}
      />

      {/* Subtract the fixed 64px header thickness from your absolute layout background container */}
      <Box className="w-full h-[calc(100vh-64px)] bg-black overflow-hidden relative select-none">
        
        {/* BASE LAYER: Standalone film stream component */}
        <Box className="w-full h-full absolute inset-0 z-0 pointer-events-auto">
          <MemoizedWatchClientLeaf mediaId={resolvedMovieId} isPartyMode={true} />
        </Box>

        {/* OVERLAY LAYER 2: Floating Style Adjustments HUD Panel */}
        <MemoizedStyleControllerPanel />

        {/* OVERLAY LAYER 3: Boundary-less Floating Transparent Chat */}
        <MemoizedFloatingChatOverlay />

      </Box>
    </>
  );
}