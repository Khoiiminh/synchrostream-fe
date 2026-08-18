"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button, Text, Loader, Center } from "@mantine/core";
import { useStore } from "react-redux";

import { useAppSelector } from "@/store/hooks";
import {
  mediaApi,
  useGetSoloStreamQuery,
} from "@/store/services/mediaApi";

import {
  resetPlayback,
  updatePlaybackSnapshot,
} from "@/store/slices/playbackSlice";

import NavbarWrapper from "../commons/NavbarWrapper";

import { useEngine } from "@/context/EngineContext";

import {
  createPartyMediaController,
  createSoloMediaController,
} from "@/core/sync/createMediaSyncController";

import { MediaSyncController } from "@/core/sync/MediaSyncController";
import { QualityLevel } from "@/core/sync/ISyncAdapter";

import VideoPlayer from "./player/VideoPlayer";

interface WatchClientLeafProps {
  mediaId: string;
  isPartyMode: boolean;
}

export default function WatchClientLeaf({
  mediaId,
  isPartyMode,
}: WatchClientLeafProps) {
  const router = useRouter();
  const store = useStore();

  const { gatewayEngine } = useEngine();

  const [duration, setDuration] = useState(0);
  const [qualityLevels, setQualityLevels] = useState<
    QualityLevel[]
  >([]);

  const playbackState = useAppSelector(
    (state) => state.playback,
  );

  const isPlaying =
    playbackState?.isPlaying ?? false;

  const currentTime =
    playbackState?.currentTime ?? 0;

  const activeRoom = useAppSelector(
    (state) => state.room.activeRoom,
  );

  const userId = useAppSelector(
    (state) => state.auth.userId,
  );

  const cachedCatalogMovie = useAppSelector((state) => {
    const catalogResult =
      mediaApi.endpoints.getMediaCatalog.select()(state);

    return catalogResult.data?.find(
      (movie) => movie.movieId === mediaId,
    );
  });

  const {
    data: streamData,
    isLoading,
    error,
  } = useGetSoloStreamQuery(mediaId, {
    skip: !mediaId,
  });

  const activePosterUrl =
    cachedCatalogMovie?.metadata?.posterUrl ||
    streamData?.metadata?.posterUrl ||
    "/spring_poster_pillar_medium.jpg";

  /*
   * Resolve the current user's party identity from the
   * already-synchronized room state.
   */
  const partyUserId = isPartyMode ? userId : undefined;

  /*
   * Controller creation belongs here.
   *
   * It is derived from the current playback configuration,
   * not stored as React state.
   *
   */
  const controller = useMemo<MediaSyncController | null>(() => {
    const streamUrl = streamData?.streaming?.hlsUrl;

    if (!streamUrl) {
      return null;
    }

    if (
      isPartyMode &&
      activeRoom &&
      partyUserId
    ) {
      return createPartyMediaController(
        store,
        gatewayEngine,
        {
          streamUrl,
          roomId: activeRoom.roomId,
          roomCode: activeRoom.roomCode,
          userId: partyUserId,
        },
      );
    }

    return createSoloMediaController(
      store,
      streamUrl,
    );
  }, [
    streamData?.streaming?.hlsUrl,
    store,
    isPartyMode,
    activeRoom,
    partyUserId,
    gatewayEngine,
  ]);

  /*
   * Controller lifetime.
   *
   * VideoPlayer handles attaching the controller to the
   * <video> element. WatchClientLeaf handles the lifetime
   * of the controller object itself.
   */
  useEffect(() => {
    if (!controller) {
      return;
    }

    store.dispatch(
      updatePlaybackSnapshot({
        activeMediaId: mediaId,
      }),
    );

    return () => {
      controller.dispose();

      store.dispatch(resetPlayback());

      setDuration(0);
      setQualityLevels([]);
    };
}, [controller, mediaId, store]);

  /*
   * Keep callbacks stable so VideoPlayer's attachment effect
   * does not rerun unnecessarily.
   */
  const handleDurationChange = useCallback(
    (value: number) => {
      setDuration(value);
    },
    [],
  );

  const handleQualityLevelsChange = useCallback(
    (levels: QualityLevel[]) => {
      setQualityLevels(levels);
    },
    [],
  );

  const handleSeek = useCallback(
    (value: number) => {
      controller?.seek(value);
    },
    [controller],
  );

  if (isLoading && !cachedCatalogMovie) {
    return (
      <Center style={{ height: "100vh" }}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (error && !cachedCatalogMovie) {
    return (
      <Center style={{ height: "100vh" }}>
        <Text color="red">
          Failed to resolve stream metadata.
        </Text>
      </Center>
    );
  }

  return (
    <NavbarWrapper>
      <div className="w-full min-h-[calc(100vh-60px)] flex-1 flex flex-col justify-center relative overflow-hidden">
        {activePosterUrl && (
          <div className="absolute inset-0 w-full h-full pointer-events-none select-none z-0 overflow-hidden">
            <Image
              src={activePosterUrl}
              alt="Ambient theatre backdrop"
              fill
              sizes="100vw"
              priority
              className="object-cover blur-2xl scale-110 opacity-40 select-none pointer-events-none"
            />

            <div className="absolute inset-0 bg-radial from-transparent via-zinc-950/40 to-zinc-950" />
          </div>
        )}

        <div className="w-full max-w-(--size-xl) mx-auto px-4 md:px-6 py-6 flex flex-col justify-center relative z-10">
          <Button
            onClick={() => router.push("/catalog")}
            variant="subtle"
            color="gray"
            mb="md"
            className="self-start relative z-10"
          >
            &larr; Back to Catalog
          </Button>

          <VideoPlayer
            controller={controller}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            qualityLevels={qualityLevels}
            onSeek={handleSeek}
            onDurationChange={handleDurationChange}
            onQualityLevelsChange={
              handleQualityLevelsChange
            }
          />

          <div className="w-full pl-16 md:pl-22">
            <Text
              size="xl"
              fw={700}
              mt="md"
              className="text-white"
            >
              {streamData?.title}
            </Text>
          </div>
        </div>
      </div>
    </NavbarWrapper>
  );
}