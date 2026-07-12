'use client';

import { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Box, AspectRatio, Text } from "@mantine/core";
import { useAppSelector } from "@/store/hooks";
import { useEngine } from "@/context/EngineContext";
import WatchClientLeaf from "@/components/watch/WatchClientLeaf";
import StyleControllerPanel from "@/components/watch-party/StyleControllerPanel";
import FloatingChatOverlay from "@/components/watch-party/FloatingChatOverlay";
import NavbarWrapper from "@/components/commons/NavbarWrapper";

export default function IntegratedWatchPartyPage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const { gatewayEngine } = useEngine();
  const router = useRouter();
  const activeRoom = useAppSelector((state) => state.room.activeRoom);
  const { videoSize, videoOpacity } = useAppSelector((state) => state.room.uiOptions);
  const searchParams = useSearchParams();

  // Fallback Hierarchy
  // Read from incoming webscoket activeRoom state, if empty fetch from the source URL (?mediaId=...)
  const queryMediaId = searchParams.get('mediaId');
  const queryPassword = searchParams.get('pwd') || '';
  const resolvedMovieId = activeRoom?.movieId || queryMediaId || '';

  // Utilize the roomCode parameter to hook into our real websocket sync hub
  useEffect(() => {
    if (!roomCode) return;

    // Connects to the 'sync-hub' namespace as defined in watch-party.gateway.ts
    gatewayEngine.connect({
      dto: {
        roomCode: roomCode,
        passwordPlain: queryPassword, // Will be filled via join gate logic later
      },
      rtcIdentity: `user_${Math.random().toString(36).substring(7)}`,
    });

    const handleRoomTerminated = (data: { message: string }) => {
      alert(data.message || 'The watch party session has been closed by the host.');
      router.push('/catalog');
    };

    gatewayEngine.on({event: 'room:terminated', callback: handleRoomTerminated});

    return () => {
      gatewayEngine.off({ event: 'room:terminated', callback: handleRoomTerminated})
      gatewayEngine.disconnect();
    };
  }, [roomCode, queryPassword, gatewayEngine, router]);

  useEffect(() => {
    const handleWindowClose = () => {
      gatewayEngine.disconnect();   // Explicitly cut socket link before tab thread dies
    };

    window.addEventListener("beforeunload", handleWindowClose);
    return () => {
      window.removeEventListener("beforeunload", handleWindowClose);
    }
  }, [gatewayEngine]);

  // Prevent downstream player crashing if neither the ws room state nor URL query params contain an ID
  if (!resolvedMovieId) {
    return (
      <NavbarWrapper>
        <Box className="w-full h-[calc(100vh-64px)] bg-black flex items-center justify-center text-zinc-500">
          <Text size="sm">Resolving movie identity reference indices...</Text>
        </Box>
      </NavbarWrapper>
    )
  }
  return (
    <>
      {/* Subtract the fixed 64px header thickness from your absolute layout background container */}
      <Box className="w-full h-[calc(100vh-64px)] bg-black overflow-hidden relative select-none">
        
        {/* BASE LAYER: Standalone film stream component */}
        <Box className="w-full h-full absolute inset-0 z-0 pointer-events-auto">
          <WatchClientLeaf mediaId={resolvedMovieId} isPartyMode={true} />
        </Box>

        {/* OVERLAY LAYER 1: WebRTC Video Call Frame Mesh */}
        <Box 
          className="absolute top-6 left-6 z-40 flex flex-wrap gap-3 pointer-events-none"
          style={{ maxWidth: "calc(100% - 48px)" }}
        >
          {activeRoom?.members.map((member) => (
            <Box
              key={member.userId}
              className="rounded-lg overflow-hidden border border-white/10 bg-zinc-950 shadow-xl pointer-events-auto transition-all duration-200"
              style={{
                width: videoSize,
                height: (videoSize * 3) / 4,
                opacity: videoOpacity,
              }}
            >
              <AspectRatio ratio={4 / 3} className="w-full h-full relative">
                <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
                  <Text size="10px" color="dimmed" className="font-mono">
                    {member.username}
                  </Text>
                </div>
              </AspectRatio>
            </Box>
          ))}
        </Box>

        {/* OVERLAY LAYER 2: Floating Style Adjustments HUD Panel */}
        <StyleControllerPanel />

        {/* OVERLAY LAYER 3: Boundary-less Floating Transparent Chat */}
        <FloatingChatOverlay />

      </Box>
    </>
  );
}