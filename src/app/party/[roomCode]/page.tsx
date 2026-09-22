'use client';

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Box, AspectRatio, Text } from "@mantine/core";
import { useAppSelector } from "@/store/hooks";
import { useEngine } from "@/context/EngineContext";
import WatchClientLeaf from "@/components/watch/WatchClientLeaf";
import StyleControllerPanel from "@/components/watch-party/StyleControllerPanel";
import FloatingChatOverlay from "@/components/watch-party/FloatingChatOverlay";
import NavbarWrapper from "@/components/commons/NavbarWrapper";
import SfuTransportTest from "@/components/watch-party/SfuTransportTest";
import { useGetMediaSessionConnectionMutation } from "@/store/services/mediaSessionApi";
import { ParticipantMedia, SfuMediaEngine, SfuMediaEngineStatus } from "@/core/services/SfuMediaEngine";
import ParticipantMediaMesh from "@/components/watch-party/ParticipantMediaMesh";

export default function IntegratedWatchPartyPage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const { gatewayEngine } = useEngine();
  const router = useRouter();
  const activeRoom = useAppSelector((state) => state.room.activeRoom);
  const { videoSize, videoOpacity } = useAppSelector((state) => state.room.uiOptions);
  const userId = useAppSelector((state) => state.auth.userId);
  const searchParams = useSearchParams();
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const isAuthHydrated = useAppSelector((state) => state.auth.isAuthHydrated);
  const [
    getMediaSessionConnection,
    {
      data: mediaSessionConnection,
      isLoading: isMediaSessionConnectionLoading,
      error: mediaSessionConnectionError,
    },
  ] = useGetMediaSessionConnectionMutation();

    const sfuMediaEngineRef = useRef<SfuMediaEngine | null>(null);
    const [participantMedia, setParticipantMedia] = useState<ParticipantMedia[]>([]);
    const [sfuStatus, setSfuStatus] = useState<SfuMediaEngineStatus>('DISCONNECTED');

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

    const rtcIdentity = `user_${Math.random().toString(36).substring(7)}`;

    console.log("[PartyPage] Calling gatewayEngine.connect()", {
      roomCode,
      userId,
      rtcIdentity,
    });

    gatewayEngine.connect({
      dto: {
        roomCode,
        passwordPlain: queryPassword,
      },
      userId,
      rtcIdentity,
    });

    console.log("[PartyPage] gatewayEngine.connect() called");

    const handleRoomTerminated = (data: { message: string }) => {
      alert(data.message || 'The watch party session has been closed by the host.');
      router.push('/catalog');
    };

    gatewayEngine.on({event: 'room:terminated', callback: handleRoomTerminated});

    return () => {
      gatewayEngine.off({ event: 'room:terminated', callback: handleRoomTerminated})
      gatewayEngine.disconnect();
    };
  }, [userId, roomCode, queryPassword, gatewayEngine, router, isAuthHydrated, isAuthenticated]);

  // Get MediaSession connection
 useEffect(() => {
  if (!activeRoom) {
      return;
    }

    if (!activeRoom.mediaSessionId) {
      return;
    }

    if (!isAuthHydrated) {
      return;
    }

    if (!userId || !isAuthenticated) {
      return;
    }

    const connectToMediaSession = async () => {
      try {
        console.log("[PartyPage] Resolving MediaSession connection", {
          roomId: activeRoom.mediaSessionId,
        });

        const connection = await getMediaSessionConnection(
          activeRoom.mediaSessionId,
        ).unwrap();

        console.log("[PartyPage] SFU connection blueprint received", {
          mediaSessionId: connection.data.mediaSessionId,
          participantId: connection.data.participantId,
          sfuNodeId: connection.data.sfuNodeId,
          signalingEndpoint: connection.data.signalingEndpoint,
          hasSignalingToken: !!connection.data.signalingToken,
        });
      } catch (error) {
        console.error(
          "[PartyPage] Failed to obtain SFU connection blueprint",
          error,
        );
      }
    };

    void connectToMediaSession();
  }, [
    activeRoom,
    getMediaSessionConnection,
    userId,
    isAuthenticated,
    isAuthHydrated,
  ]);

  // Connect SfuMediaEngine using the connection
  useEffect(() => {
    if (!activeRoom) {
      return;
    }

    if (!activeRoom.mediaSessionId) {
      return;
    }

    if (!isAuthHydrated) {
      return;
    }

    if (!userId || !isAuthenticated) {
      return;
    }

    if (!mediaSessionConnection?.data) {
      return;
    }

    const connection = mediaSessionConnection.data;

    const engine = new SfuMediaEngine();

    sfuMediaEngineRef.current = engine;

    const removeMediaListener = engine.onMediaUpdate((media) => {
      setParticipantMedia(media);
    });

    const removeStatusListener = engine.onStatusUpdate(
      (status, error) => {
        setSfuStatus(status);

        if (error) {
          console.error(
            "[PartyPage] SFU media error",
            error,
          );
        }
      },
    );

    const connectToSfu = async () => {
      try {
        console.log(
          "[PartyPage] Connecting production SFU media engine",
          {
            mediaSessionId: connection.mediaSessionId,
            participantId: connection.participantId,
            sfuNodeId: connection.sfuNodeId,
            signalingEndpoint: connection.signalingEndpoint,
          },
        );

        await engine.connect({
          mediaSessionId: connection.mediaSessionId,
          participantId: connection.participantId,
          signalingEndpoint: connection.signalingEndpoint,
          signalingToken: connection.signalingToken,
        });

        console.log(
          "[PartyPage] Production SFU media engine connected",
        );
      } catch (error) {
        console.error(
          "[PartyPage] Failed to connect production SFU media engine",
          error,
        );
      }
    };

    void connectToSfu();

    return () => {
      removeMediaListener();
      removeStatusListener();

      void engine.disconnect();

      if (sfuMediaEngineRef.current === engine) {
        sfuMediaEngineRef.current = null;
      }

      setParticipantMedia([]);
      setSfuStatus("DISCONNECTED");
    };
  }, [
    activeRoom,
    mediaSessionConnection,
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
      <ParticipantMediaMesh
        members={activeRoom?.members ?? []}
        participantMedia={participantMedia}
        localParticipantId={
          mediaSessionConnection?.data.participantId ?? ""
        }
        videoSize={videoSize}
        videoOpacity={videoOpacity}
      />

      {/* Subtract the fixed 64px header thickness from your absolute layout background container */}
      <Box className="w-full h-[calc(100vh-64px)] bg-black overflow-hidden relative select-none">
        
        {/* BASE LAYER: Standalone film stream component */}
        <Box className="w-full h-full absolute inset-0 z-0 pointer-events-auto">
          <WatchClientLeaf mediaId={resolvedMovieId} isPartyMode={true} />
        </Box>

        {/* OVERLAY LAYER 2: Floating Style Adjustments HUD Panel */}
        <StyleControllerPanel />

        {/* OVERLAY LAYER 3: Boundary-less Floating Transparent Chat */}
        <FloatingChatOverlay />

      </Box>
    </>
  );
}