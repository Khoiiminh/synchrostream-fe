import { useCallback, useEffect, useState } from "react";
import type { useRouter } from "next/navigation";
import { useStore } from "react-redux";
import type { MediaSyncController } from "@/shared/playback-sync/MediaSyncController";
import {
    ROOM_CLOSED_CODE,
    ROOM_LEFT_ELSEWHERE_CODE,
    type WatchPartyGatewayEngine,
} from "../engine/WatchPartyGatewayEngine";
import { createPartyMediaController } from "../engine/sync/createPartyMediaController";
import type { RoomErrorDetail } from "../model/roomSlice";

const ROOM_ENDED_REDIRECT_MS = 4000;

/**
 * The party's playback: the player is party-agnostic, so the party builds
 * its sync controller (room, owner and gateway) and hands the factory down.
 */
export function usePartyPlayback(p: {
    roomId: string | undefined;
    roomCode: string | undefined;
    ownerId: string | undefined;
    userId: string | null;
    gatewayEngine: WatchPartyGatewayEngine;
}) {
    const { roomId, roomCode, ownerId, userId, gatewayEngine } = p;
    const store = useStore();

    // Tracks the controller the player has attached (not read yet; kept so
    // the room re-renders on attach/detach exactly as before the split).
    const [, setActiveSyncController] = useState<MediaSyncController | null>(
        null,
    );

    const createPartyController = useCallback(
        (streamUrl: string) => {
            if (!roomId || !roomCode || !userId || !ownerId) {
                return null;
            }
            return createPartyMediaController(store, gatewayEngine, {
                streamUrl,
                roomId,
                roomCode,
                userId,
                ownerId,
            });
        },
        [roomId, roomCode, userId, ownerId, store, gatewayEngine],
    );

    const handleControllerAttachmentChange = useCallback(
        (controller: MediaSyncController, attached: boolean) => {
            setActiveSyncController((currentController) => {
                if (attached) return controller;

                if (currentController === controller) return null;

                return currentController;
            });
        },
        [],
    );

    return { createPartyController, handleControllerAttachmentChange };
}

/** Explicitly cut the socket link before the tab's thread dies. */
export function useDisconnectOnUnload(gatewayEngine: WatchPartyGatewayEngine) {
    useEffect(() => {
        const handleWindowClose = () => {
            gatewayEngine.disconnect();
        };

        window.addEventListener("beforeunload", handleWindowClose);
        return () => {
            window.removeEventListener("beforeunload", handleWindowClose);
        };
    }, [gatewayEngine]);
}

/**
 * The session ended for good (host closed the room, or this user left it in
 * another tab): report it, then return to the catalog after a short pause.
 */
export function useRoomSessionEnd(
    roomErrorDetail: RoomErrorDetail | null | undefined,
    router: ReturnType<typeof useRouter>,
): boolean {
    const isRoomSessionEnded =
        roomErrorDetail?.code === ROOM_CLOSED_CODE ||
        roomErrorDetail?.code === ROOM_LEFT_ELSEWHERE_CODE;

    useEffect(() => {
        if (!isRoomSessionEnded) return;
        const timeoutId = setTimeout(
            () => router.replace("/catalog"),
            ROOM_ENDED_REDIRECT_MS,
        );
        return () => clearTimeout(timeoutId);
    }, [isRoomSessionEnded, router]);

    return isRoomSessionEnded;
}
