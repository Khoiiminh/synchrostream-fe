"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Button, Text, Loader, Center } from "@mantine/core";
import { useStore } from "react-redux";

import { useAppSelector } from "@/store/hooks";
import { mediaApi, useGetSoloStreamQuery } from "@/store/services/mediaApi";

import {
    resetPlayback,
    updatePlaybackSnapshot,
} from "@/shared/playback-sync/playbackSlice";

import NavbarWrapper from "../commons/NavbarWrapper";

import { useEngine } from "@/context/EngineContext";

import {
    createPartyMediaController,
    createSoloMediaController,
} from "@/core/sync/createMediaSyncController";

import { MediaSyncController } from "@/shared/playback-sync/MediaSyncController";
import { QualityLevel } from "@/shared/playback-sync/ISyncAdapter";

import VideoPlayer from "./player/VideoPlayer";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("WatchPage");

interface WatchClientLeafProps {
    mediaId: string;
    isPartyMode: boolean;

    onControllerAttachmentChange?: (
        controller: MediaSyncController,
        attached: boolean,
    ) => void;
}

export default function WatchClientLeaf({
    mediaId,
    isPartyMode,
    onControllerAttachmentChange,
}: WatchClientLeafProps) {
    const router = useRouter();
    const store = useStore();

    const { gatewayEngine } = useEngine();

    const [duration, setDuration] = useState(0);
    const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);

    const playbackState = useAppSelector((state) => state.playback);

    const isPlaying = playbackState?.isPlaying ?? false;

    const currentTime = playbackState?.currentTime ?? 0;

    const activeRoom = useAppSelector((state) => state.room.activeRoom);

    const userId = useAppSelector((state) => state.auth.userId);

    const cachedCatalogMovie = useAppSelector((state) => {
        const catalogResult =
            mediaApi.endpoints.getMediaCatalog.select()(state);

        return catalogResult.data?.find((movie) => movie.movieId === mediaId);
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

    const streamUrl = streamData?.streaming?.hlsUrl;
    const roomId = activeRoom?.roomId;
    const roomCode = activeRoom?.roomCode;
    const ownerId = activeRoom?.ownerId;
    const watcherCount = activeRoom?.members?.length ?? 1;
    const controller = useMemo<MediaSyncController | null>(() => {
        if (!streamUrl) {
            return null;
        }

        if (isPartyMode) {
            if (!roomId || !roomCode || !partyUserId || !ownerId) {
                return null;
            }

            return createPartyMediaController(store, gatewayEngine, {
                streamUrl,
                roomId,
                roomCode,
                userId: partyUserId,
                ownerId,
            });
        }

        return createSoloMediaController(store, streamUrl);
    }, [
        streamUrl,
        roomId,
        roomCode,
        partyUserId,
        ownerId,
        isPartyMode,
        store,
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
    const handleDurationChange = useCallback((value: number) => {
        setDuration(value);
    }, []);

    const handleQualityLevelsChange = useCallback((levels: QualityLevel[]) => {
        setQualityLevels(levels);
    }, []);

    const handleSeek = useCallback(
        (value: number) => {
            controller?.seek(value);
        },
        [controller],
    );
    const handleDownloadSyncMetrics = useCallback(() => {
        if (!controller) {
            log.warn("Cannot download sync metrics without a controller.");

            return;
        }

        controller.downloadSyncMetrics();
    }, [controller]);

    /**
     * The local metrics export is a research tool (backup copy and the MEAS-03
     * completeness check), not a viewer feature. It is shown only in party mode
     * and only when the page is opened with ?metricsDebug=1. Server-side
     * collection and the admin Sync Metrics page do not depend on it.
     */
    const searchParams = useSearchParams();
    const showMetricsExport =
        isPartyMode && searchParams.get("metricsDebug") === "1";

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
                <Text color="red">Failed to resolve stream metadata.</Text>
            </Center>
        );
    }

    // The inner page content
    const innerContent = (
        <div
            className={`w-full flex-1 flex flex-col justify-between relative overflow-hidden ${
                isPartyMode ? "h-full" : "min-h-[calc(100vh-60px)]"
            }`}
        >
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

            <div
                className={`w-full mx-auto px-4 py-4 flex flex-col justify-between relative z-10 h-full ${
                    isPartyMode ? "md:px-6" : "max-w-[76rem] md:px-10"
                }`}
            >
                <Button
                    onClick={() => router.push("/catalog")}
                    variant="subtle"
                    color="gray"
                    mb="xs"
                    className="self-start relative z-10"
                >
                    &larr; Back to Catalog
                </Button>

                {showMetricsExport && (
                    <div className="fixed top-20 right-6 z-100">
                        <Button
                            onClick={handleDownloadSyncMetrics}
                            variant="light"
                        >
                            Download Sync Metrics
                        </Button>
                    </div>
                )}

                <VideoPlayer
                    controller={controller}
                    onControllerAttachmentChange={onControllerAttachmentChange}
                    isPlaying={isPlaying}
                    currentTime={currentTime}
                    duration={duration}
                    qualityLevels={qualityLevels}
                    onSeek={handleSeek}
                    onDurationChange={handleDurationChange}
                    onQualityLevelsChange={handleQualityLevelsChange}
                    posterUrl={activePosterUrl}
                    title={streamData?.title ?? cachedCatalogMovie?.title}
                    startSubtitle={
                        isPartyMode
                            ? `${watcherCount} ${watcherCount === 1 ? "person" : "people"} in the room · press play to start for everyone`
                            : undefined
                    }
                />

                <div className="w-full pl-4 md:pl-8">
                    <Text size="xl" fw={700} mt="xs" className="text-white">
                        {streamData?.title}
                    </Text>
                </div>
            </div>
        </div>
    );

    // If in party mode, bypass NavbarWrapper directly to fit into IntegratedWatchPartyPage's container
    if (isPartyMode) {
        return innerContent;
    }

    // Solo viewing mode retains NavbarWrapper
    return <NavbarWrapper>{innerContent}</NavbarWrapper>;
}
