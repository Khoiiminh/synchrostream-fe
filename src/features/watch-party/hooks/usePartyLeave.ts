import { useCallback, useState } from "react";
import type { useRouter } from "next/navigation";
import {
    completeBackNavigation,
    type LeaveDestination,
    usePartyLeaveGuard,
} from "@/shared/lib/leaveGuard";
import type { WatchPartyGatewayEngine } from "../engine/WatchPartyGatewayEngine";
import {
    clearJoinPassword,
    clearOwnedRoomPassword,
} from "../model/roomAccessKeys";

/**
 * Voluntary leave. Choosing to leave (Leave button, in-app navigation, Back)
 * cleans up immediately on the server: an owner's room closes for everyone,
 * a participant's membership ends. Only connection loss (network drop, tab
 * close, refresh) keeps the 10 s reconnection grace.
 */
export function usePartyLeave(p: {
    roomCode: string;
    isOwner: boolean;
    hasActiveRoom: boolean;
    gatewayEngine: WatchPartyGatewayEngine;
    router: ReturnType<typeof useRouter>;
}) {
    const { roomCode, isOwner, hasActiveRoom, gatewayEngine, router } = p;

    const [isLeaving, setIsLeaving] = useState(false);
    const [pendingLeave, setPendingLeave] = useState<LeaveDestination | null>(
        null,
    );

    // A navbar room switch reuses this page instance with a new roomCode; reset
    // the leave state for the new room (state adjustment during render, the
    // React-recommended alternative to a resetting effect).
    const [leaveStateRoomCode, setLeaveStateRoomCode] = useState(roomCode);
    if (leaveStateRoomCode !== roomCode) {
        setLeaveStateRoomCode(roomCode);
        setIsLeaving(false);
        setPendingLeave(null);
    }

    const performLeave = useCallback(
        async (destination: LeaveDestination) => {
            setPendingLeave(null);
            setIsLeaving(true);
            await gatewayEngine.leaveRoom();
            // Membership ended: coming back must go through the password again.
            clearJoinPassword(roomCode);
            // An owner's leave closes the room ("Close room"). Only the owner's
            // browser has this entry, so for a guest this is a no-op.
            clearOwnedRoomPassword(roomCode);
            if (destination.kind === "back") {
                completeBackNavigation();
            } else {
                router.push(destination.href);
            }
        },
        [gatewayEngine, router, roomCode],
    );

    const requestLeave = useCallback(
        (destination: LeaveDestination) => {
            if (isLeaving) return;
            if (isOwner) {
                // Owner leave closes the room for everyone (rule 3): confirm first.
                setPendingLeave(destination);
                return;
            }
            void performLeave(destination);
        },
        [isLeaving, isOwner, performLeave],
    );

    usePartyLeaveGuard(hasActiveRoom && !isLeaving, requestLeave);

    return {
        isLeaving,
        pendingLeave,
        cancelLeave: () => setPendingLeave(null),
        performLeave,
        requestLeave,
    };
}
