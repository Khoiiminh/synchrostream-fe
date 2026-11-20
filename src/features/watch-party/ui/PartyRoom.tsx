"use client";

import { memo, useEffect, useLayoutEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Box, Button, Group, Modal, Text } from "@mantine/core";
import { KeyRound, LogOut, Mic, MicOff } from "lucide-react";
import { RoomPasswordInput } from "@/shared/ui/RoomPasswordInput";
import ModalHeading from "@/shared/ui/ModalHeading";
import { createLogger } from "@/shared/lib/logger";
import { useAppSelector } from "@/store/hooks";
import WatchClientLeaf from "@/components/watch/WatchClientLeaf";
import NavbarWrapper from "@/components/commons/NavbarWrapper";
import { RequireAuthenticatedSession } from "@/components/auth/RequireAuthenticatedSession";
import { useEngine } from "../engine/EngineContext";
import {
    consumeJoinPasswordFromUrl,
    ROOM_PASSWORD_MAX_LENGTH,
    ROOM_PASSWORD_MIN_LENGTH,
} from "../model/roomAccessKeys";
import { usePartyGateway } from "../hooks/usePartyGateway";
import { usePartyLeave } from "../hooks/usePartyLeave";
import { useLiveKitMedia } from "../hooks/useLiveKitMedia";
import { usePushToTalk } from "../hooks/usePushToTalk";
import {
    useDisconnectOnUnload,
    usePartyPlayback,
    useRoomSessionEnd,
} from "../hooks/useRoomLifecycle";
import StyleControllerPanel from "./StyleControllerPanel";
import FloatingChatOverlay from "./FloatingChatOverlay";
import ParticipantMediaMesh from "./ParticipantMediaMesh";
import RoomPill from "./RoomPill";

const log = createLogger("PartyPage");

/**
 * -------------------------------------------------------------
 *                    memoized components
 * -------------------------------------------------------------
 */
const MemoizedParticipantMediaMesh = memo(ParticipantMediaMesh);
const MemoizedWatchClientLeaf = memo(WatchClientLeaf);
const MemoizedStyleControllerPanel = memo(StyleControllerPanel);
const MemoizedFloatingChatOverlay = memo(FloatingChatOverlay);

/** The whole watch-party room for /party/[roomCode]: auth gate, gateway, media and UI. */
export function PartyRoom() {
    const { roomCode } = useParams<{ roomCode: string }>();

    // Move an invite link's password out of the address bar into this tab's
    // sessionStorage before anything else. A layout effect runs before the
    // auth guard's (passive) redirect effect, so a signed-out guest keeps the
    // password across sign-in: the URL fragment would not survive the redirect.
    useLayoutEffect(() => {
        if (roomCode) consumeJoinPasswordFromUrl(roomCode);
    }, [roomCode]);

    return (
        <RequireAuthenticatedSession>
            <IntegratedWatchPartyContent />
        </RequireAuthenticatedSession>
    );
}

/*
 * The room once signed in. The hooks run their effects in this order, the
 * same order the effects had when they were written inline: gateway join,
 * leave guard, LiveKit token and engine, push-to-talk, unload disconnect,
 * auth log, room-ended redirect.
 */
function IntegratedWatchPartyContent() {
    const { roomCode } = useParams<{ roomCode: string }>();
    const { gatewayEngine } = useEngine();
    const router = useRouter();
    const activeRoom = useAppSelector((state) => state.room.activeRoom);

    const mediaSessionId = activeRoom?.mediaSessionId;
    const roomMembers = activeRoom?.members;

    const { videoSize, videoOpacity } = useAppSelector(
        (state) => state.room.uiOptions,
    );
    const roomErrorMessage = useAppSelector((state) => state.room.errorMessage);
    const roomErrorDetail = useAppSelector((state) => state.room.errorDetail);
    const userId = useAppSelector((state) => state.auth.userId);
    const isAuthenticated = useAppSelector(
        (state) => state.auth.isAuthenticated,
    );
    const isAuthHydrated = useAppSelector((state) => state.auth.isAuthHydrated);

    const { createPartyController, handleControllerAttachmentChange } =
        usePartyPlayback({
            roomId: activeRoom?.roomId,
            roomCode: activeRoom?.roomCode,
            ownerId: activeRoom?.ownerId,
            userId,
            gatewayEngine,
        });
    const watcherCount = roomMembers?.length ?? 1;
    const resolvedMovieId = activeRoom?.movieId || "";

    const {
        retryPassword,
        setRetryPassword,
        switchIntoThisRoom,
        retryJoin,
        retryWithPassword,
    } = usePartyGateway({
        roomCode,
        userId,
        isAuthenticated,
        isAuthHydrated,
        gatewayEngine,
        router,
    });

    const isOwner = !!activeRoom && !!userId && activeRoom.ownerId === userId;
    const { isLeaving, pendingLeave, cancelLeave, performLeave, requestLeave } =
        usePartyLeave({
            roomCode,
            isOwner,
            hasActiveRoom: !!activeRoom,
            gatewayEngine,
            router,
        });

    const {
        engineRef,
        participantMedia,
        liveKitStatus,
        localStream,
        isMicActive,
        micError,
        localParticipantId,
    } = useLiveKitMedia({
        mediaSessionId,
        userId,
        isAuthenticated,
        isAuthHydrated,
    });

    const { isTalkHeld, setIsTalkHeld, canTalk } = usePushToTalk(
        engineRef,
        liveKitStatus,
    );

    useDisconnectOnUnload(gatewayEngine);

    // Auth logging effect
    useEffect(() => {
        log.debug("Auth state", {
            userId,
            roomCode,
            isAuthenticated,
        });
    }, [userId, roomCode, isAuthenticated]);

    const isRoomSessionEnded = useRoomSessionEnd(roomErrorDetail, router);

    // Server rejections about the room password (missing, wrong, too many tries).
    const isPasswordError =
        !!roomErrorMessage && /password|credential/i.test(roomErrorMessage);

    // Prevent downstream player crashing if neither the ws room state nor URL query params contain an ID
    if (!resolvedMovieId) {
        return (
            <NavbarWrapper>
                <Box className="w-full h-[calc(100vh-64px)] bg-black flex flex-col items-center justify-center gap-3 text-zinc-500">
                    {isRoomSessionEnded ? (
                        <>
                            <Text size="sm" c="zinc.2" ta="center" maw={420}>
                                {roomErrorMessage}
                            </Text>
                            <Text size="xs" c="dimmed">
                                Returning to the catalog…
                            </Text>
                            <Button
                                size="xs"
                                variant="light"
                                onClick={() => router.replace("/catalog")}
                            >
                                Back to catalog
                            </Button>
                        </>
                    ) : roomErrorDetail?.code ===
                      "ACTIVE_MEMBERSHIP_ELSEWHERE" ? (
                        <>
                            <Text size="sm" c="zinc.2" ta="center" maw={420}>
                                {roomErrorDetail.currentRoomIsOwned
                                    ? `You are still hosting room ${roomErrorDetail.currentRoomCode}. Joining this room will close it for everyone in it.`
                                    : `You are still in room ${roomErrorDetail.currentRoomCode}. Leave it to join this room?`}
                            </Text>
                            <Group gap="sm">
                                <Button
                                    size="xs"
                                    color={
                                        roomErrorDetail.currentRoomIsOwned
                                            ? "red"
                                            : "blue"
                                    }
                                    onClick={switchIntoThisRoom}
                                >
                                    {roomErrorDetail.currentRoomIsOwned
                                        ? `Close ${roomErrorDetail.currentRoomCode} and join`
                                        : `Leave ${roomErrorDetail.currentRoomCode} and join`}
                                </Button>
                                <Button
                                    size="xs"
                                    variant="subtle"
                                    onClick={() => router.push("/catalog")}
                                >
                                    Cancel
                                </Button>
                            </Group>
                        </>
                    ) : roomErrorMessage && isPasswordError ? (
                        // Rejected for a missing or wrong password (e.g. an
                        // old invite link without one): ask for it here.
                        <form
                            onSubmit={retryWithPassword}
                            className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950/80 p-6 shadow-2xl"
                        >
                            <ModalHeading
                                icon={<KeyRound size={20} />}
                                title={`Room ${roomCode?.toUpperCase()}`}
                                subtitle="This room is password protected"
                            />
                            <Text size="xs" c="red.4" mt="md">
                                {roomErrorMessage}
                            </Text>
                            <RoomPasswordInput
                                mt="sm"
                                placeholder="Enter the room password"
                                aria-label="Room password"
                                autoFocus
                                maxLength={ROOM_PASSWORD_MAX_LENGTH}
                                leftSection={<KeyRound size={16} />}
                                value={retryPassword}
                                onChange={(e) =>
                                    setRetryPassword(e.currentTarget.value)
                                }
                            />
                            <Button
                                type="submit"
                                fullWidth
                                mt="md"
                                variant="gradient"
                                gradient={{
                                    from: "teal.4",
                                    to: "cyan.5",
                                    deg: 90,
                                }}
                                className="text-zinc-950!"
                                disabled={
                                    retryPassword.trim().length <
                                    ROOM_PASSWORD_MIN_LENGTH
                                }
                            >
                                Enter A Room
                            </Button>
                            <Button
                                fullWidth
                                mt="xs"
                                variant="subtle"
                                color="gray"
                                onClick={() => router.push("/catalog")}
                            >
                                Back to catalog
                            </Button>
                        </form>
                    ) : roomErrorMessage ? (
                        <>
                            <Text size="sm" c="red.4">
                                {roomErrorMessage}
                            </Text>
                            <Group gap="sm">
                                <Button
                                    size="xs"
                                    variant="light"
                                    onClick={retryJoin}
                                >
                                    Try again
                                </Button>
                                <Button
                                    size="xs"
                                    variant="subtle"
                                    onClick={() => router.push("/catalog")}
                                >
                                    Back to catalog
                                </Button>
                            </Group>
                        </>
                    ) : (
                        <Text size="sm">Waiting for watch room state...</Text>
                    )}
                </Box>
            </NavbarWrapper>
        );
    }
    return (
        <>
            {/* Subtract the fixed 64px header thickness from your absolute layout background container */}
            {/* The party page has no navbar, so the stage fills the whole viewport. */}
            <Box
                className="w-full bg-black overflow-hidden relative select-none"
                style={{ height: "100dvh" }}
            >
                <MemoizedParticipantMediaMesh
                    members={roomMembers ?? []}
                    participantMedia={participantMedia}
                    localStream={localStream}
                    localParticipantId={localParticipantId}
                    videoSize={videoSize}
                    videoOpacity={videoOpacity}
                    isLocalTalking={isMicActive}
                />

                {/* BASE LAYER: Standalone film stream component */}
                <Box className="w-full h-full absolute inset-0 z-0 pointer-events-auto">
                    <MemoizedWatchClientLeaf
                        mediaId={resolvedMovieId}
                        isPartyMode={true}
                        createController={createPartyController}
                        watcherCount={watcherCount}
                        onControllerAttachmentChange={
                            handleControllerAttachmentChange
                        }
                    />
                </Box>

                {/* OVERLAY LAYER 2: Floating Style Adjustments HUD Panel */}
                <MemoizedStyleControllerPanel />

                {/* OVERLAY LAYER 3: Boundary-less Floating Transparent Chat */}
                <MemoizedFloatingChatOverlay />

                {/* OVERLAY LAYER 4: Voluntary leave (immediate, no reconnection grace).
                    Quiet until hovered so it does not compete with the film. */}
                <Box className="absolute top-3 right-3 z-[60] pointer-events-auto">
                    <Button
                        size="xs"
                        radius="xl"
                        variant="default"
                        leftSection={<LogOut size={14} />}
                        loading={isLeaving}
                        className="border-white/10! bg-black/50! text-zinc-300! backdrop-blur-md transition-colors hover:border-red-500/50! hover:bg-red-500/20! hover:text-red-300!"
                        onClick={() =>
                            requestLeave({ kind: "href", href: "/catalog" })
                        }
                    >
                        {isOwner ? "Close room" : "Leave room"}
                    </Button>
                </Box>

                {/* OVERLAY LAYER 5: Room pill + push-to-talk */}
                <Box className="absolute top-3 left-1/2 -translate-x-1/2 z-[60] pointer-events-auto flex flex-col items-center gap-1.5">
                    <div className="flex items-center gap-2">
                        {activeRoom && (
                            <RoomPill
                                roomCode={activeRoom.roomCode}
                                memberCount={roomMembers?.length ?? 1}
                            />
                        )}
                        <button
                            type="button"
                            disabled={!canTalk}
                            aria-pressed={isTalkHeld}
                            title="Hold to talk (or hold V)"
                            className={
                                "relative flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold shadow-lg backdrop-blur-md transition-all touch-none " +
                                (isMicActive
                                    ? "border-teal-300 bg-teal-400 text-zinc-950 shadow-[0_0_24px_rgba(45,212,191,0.6)] scale-105"
                                    : isTalkHeld
                                      ? "border-teal-500/60 bg-teal-900/80 text-teal-100"
                                      : "border-white/10 bg-black/50 text-zinc-200 hover:bg-white/10") +
                                (!canTalk
                                    ? " opacity-50 cursor-not-allowed"
                                    : " cursor-pointer")
                            }
                            onPointerDown={(event) => {
                                if (event.button !== 0) return;
                                event.currentTarget.setPointerCapture(
                                    event.pointerId,
                                );
                                setIsTalkHeld(true);
                            }}
                            onPointerUp={() => setIsTalkHeld(false)}
                            onPointerCancel={() => setIsTalkHeld(false)}
                            onLostPointerCapture={() => setIsTalkHeld(false)}
                            onContextMenu={(event) => event.preventDefault()}
                        >
                            {isMicActive && (
                                <span className="pointer-events-none absolute inset-0 animate-ping rounded-full border-2 border-teal-300/70" />
                            )}
                            {isMicActive ? (
                                <Mic size={14} />
                            ) : (
                                <MicOff size={14} />
                            )}
                            {isMicActive ? (
                                "Talking…"
                            ) : isTalkHeld ? (
                                "Opening mic…"
                            ) : (
                                <>
                                    Hold
                                    <kbd className="rounded border border-white/20 bg-white/10 px-1.5 font-mono text-[10px] leading-4">
                                        V
                                    </kbd>
                                    to talk
                                </>
                            )}
                        </button>
                    </div>
                    {micError && (
                        <span className="max-w-xs rounded bg-zinc-900/90 px-2 py-1 text-center text-[11px] text-amber-200">
                            {micError}
                        </span>
                    )}
                </Box>
            </Box>

            <Modal
                opened={pendingLeave !== null}
                onClose={cancelLeave}
                title="Close this watch room?"
                centered
            >
                <Text size="sm" mb="md">
                    You are the host. Leaving will close room{" "}
                    {activeRoom?.roomCode} for everyone watching, and they will
                    be returned to the catalog.
                </Text>
                <Group justify="flex-end" gap="sm">
                    <Button variant="subtle" onClick={cancelLeave}>
                        Stay in room
                    </Button>
                    <Button
                        color="red"
                        onClick={() => {
                            if (pendingLeave) void performLeave(pendingLeave);
                        }}
                    >
                        Leave and close room
                    </Button>
                </Group>
            </Modal>
        </>
    );
}
