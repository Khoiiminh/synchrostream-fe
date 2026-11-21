import { useCallback, useEffect, useRef, useState } from "react";
import type { useRouter } from "next/navigation";
import type { WatchPartyGatewayEngine } from "../engine/WatchPartyGatewayEngine";
import {
    clearJoinPassword,
    clearOwnedRoomPassword,
    consumeJoinPasswordFromUrl,
    ROOM_PASSWORD_MIN_LENGTH,
    saveJoinPassword,
} from "../model/roomAccessKeys";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("PartyPage");

/**
 * Joins the room through the gateway once auth is ready, and offers the
 * re-join paths the error screens need (switch rooms, retry, retry with a
 * new password).
 *
 * The room password is never kept in the URL: the effect moves any #pwd=
 * (or legacy ?pwd=) into this tab's sessionStorage, strips it from the
 * address bar, and records it here for the room-switch and retry buttons.
 * See docs/room-password-handling.md.
 */
export function usePartyGateway(p: {
    roomCode: string;
    userId: string | null;
    isAuthenticated: boolean;
    isAuthHydrated: boolean;
    gatewayEngine: WatchPartyGatewayEngine;
    router: ReturnType<typeof useRouter>;
}) {
    const {
        roomCode,
        userId,
        isAuthenticated,
        isAuthHydrated,
        gatewayEngine,
        router,
    } = p;

    const joinPasswordRef = useRef("");
    const [retryPassword, setRetryPassword] = useState("");

    useEffect(() => {
        // Runs first so the password leaves the address bar even before auth
        // hydration finishes. Idempotent: a second run reads sessionStorage.
        const joinPassword = roomCode
            ? consumeJoinPasswordFromUrl(roomCode)
            : "";
        joinPasswordRef.current = joinPassword;

        log.debug("Gateway effect entered", {
            roomCode,
            userId,
            hasRoomPassword: joinPassword.length > 0,
        });

        if (!isAuthHydrated) {
            log.debug("Waiting for auth hydration");
            return;
        }

        if (!roomCode || !userId || !isAuthenticated) {
            log.debug("Gateway connection blocked", {
                hasRoomCode: !!roomCode,
                hasUserId: !!userId,
                isAuthenticated,
            });

            return;
        }

        log.debug("Calling gatewayEngine.connect()", {
            roomCode,
            userId,
        });

        gatewayEngine.connect({
            dto: {
                roomCode,
                passwordPlain: joinPassword,
            },
            userId,
        });

        log.debug("gatewayEngine.connect() called");

        // The gateway engine records why the session ended in the store; the
        // page then shows a "room closed" screen and returns to the catalog.
        // No alert(): it blocks the page, and a dialog in a background tab
        // can hold the redirect indefinitely.
        const handleRoomTerminated = () => {
            // The room is gone: drop both saved passwords for it.
            clearJoinPassword(roomCode);
            clearOwnedRoomPassword(roomCode);
        };

        const removeRoomTerminatedListener = gatewayEngine.on({
            event: "room:terminated",
            callback: handleRoomTerminated,
        });

        // This user left the room from another tab or window.
        const handleRoomLeftElsewhere = () => {
            clearJoinPassword(roomCode);
        };
        const removeRoomLeftListener = gatewayEngine.on({
            event: "room:left",
            callback: handleRoomLeftElsewhere,
        });

        return () => {
            removeRoomTerminatedListener();
            removeRoomLeftListener();
            gatewayEngine.disconnect();
        };
    }, [
        userId,
        roomCode,
        gatewayEngine,
        router,
        isAuthHydrated,
        isAuthenticated,
    ]);

    // The user confirmed leaving their other room in order to join this one.
    const switchIntoThisRoom = useCallback(() => {
        if (!roomCode || !userId) return;
        gatewayEngine.connect({
            dto: { roomCode, passwordPlain: joinPasswordRef.current },
            userId,
            leaveCurrent: true,
        });
    }, [gatewayEngine, roomCode, userId]);

    /** "Try again" after a non-password rejection, with the same password. */
    const retryJoin = () => {
        if (!roomCode || !userId) return;
        gatewayEngine.connect({
            dto: {
                roomCode,
                passwordPlain: joinPasswordRef.current,
            },
            userId,
        });
    };

    /** The password form shown after a missing or wrong password. */
    const retryWithPassword = (event: React.FormEvent) => {
        event.preventDefault();
        const password = retryPassword.trim();
        if (!roomCode || !userId || password.length < ROOM_PASSWORD_MIN_LENGTH)
            return;

        saveJoinPassword({ roomCode, password });
        joinPasswordRef.current = password;
        gatewayEngine.connect({
            dto: { roomCode, passwordPlain: password },
            userId,
        });
    };

    return {
        retryPassword,
        setRetryPassword,
        switchIntoThisRoom,
        retryJoin,
        retryWithPassword,
    };
}
