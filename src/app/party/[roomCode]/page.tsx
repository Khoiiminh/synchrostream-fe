"use client";

import {
    memo,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { Box, Button, Group, Modal, Text } from "@mantine/core";
import { RoomPasswordInput } from "@/components/commons/RoomPasswordInput";
import { KeyRound, LogOut, Mic, MicOff } from "lucide-react";
import {
    completeBackNavigation,
    LeaveDestination,
    usePartyLeaveGuard,
} from "@/core/navigation/leaveGuard";
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
import RoomPill from "@/components/watch-party/RoomPill";
import { ParticipantMedia } from "@/types/participantMedia";
import { MediaSyncController } from "@/core/sync/MediaSyncController";
import { RequireAuthenticatedSession } from "@/components/auth/RequireAuthenticatedSession";
import { createLogger } from "@/core/logging/logger";
import {
    ROOM_CLOSED_CODE,
    ROOM_LEFT_ELSEWHERE_CODE,
} from "@/core/services/WatchPartyGatewayEngine";
import {
    clearJoinPassword,
    clearOwnedRoomPassword,
    consumeJoinPasswordFromUrl,
    ROOM_PASSWORD_MAX_LENGTH,
    ROOM_PASSWORD_MIN_LENGTH,
    saveJoinPassword,
} from "@/lib/roomAccessKeys";
import ModalHeading from "@/components/commons/ModalHeading";

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

const PUSH_TO_TALK_KEY = "KeyV";
const ROOM_ENDED_REDIRECT_MS = 4000;

export default function IntegratedWatchPartyPage() {
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

    const [
        getLiveKitMediaSessionConnection,
        {
            data: liveKitMediaSessionConnection,
            isLoading: isLiveKitMediaSessionConnectionLoading,
            error: liveKitMediaSessionConnectionError,
        },
    ] = useGetLiveKitMediaSessionConnectionMutation();

    const liveKitMediaEngineRef = useRef<LiveKitMediaEngine | null>(null);

    const [participantMedia, setParticipantMedia] = useState<
        ParticipantMedia[]
    >([]);

    const [liveKitStatus, setLiveKitStatus] =
        useState<LiveKitMediaEngineStatus>("DISCONNECTED");

    const [localStream, setLocalStream] = useState<MediaStream | null>(null);

    // Push-to-talk. The microphone is open only while the talk key/button is
    // held: a browser tab that holds the mic gets its playback (the movie)
    // lowered by Windows, so an always-open mic would break the movie.
    const [isTalkHeld, setIsTalkHeld] = useState(false);
    const [isMicActive, setIsMicActive] = useState(false);
    const [micError, setMicError] = useState<string | null>(null);

    const [activeSyncController, setActiveSyncController] =
        useState<MediaSyncController | null>(null);

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

    // Room password for the join handshake. Never kept in the URL: the gateway
    // effect moves any #pwd= (or legacy ?pwd=) into this tab's sessionStorage,
    // strips it from the address bar, and records it here for the room-switch
    // and retry buttons. See docs/room-password-handling.md.
    const joinPasswordRef = useRef("");
    const [retryPassword, setRetryPassword] = useState("");
    const resolvedMovieId = activeRoom?.movieId || "";

    // Gateway connection effect
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

    /*
     * ------------------------------------------------------------
     * VOLUNTARY LEAVE
     * ------------------------------------------------------------
     * Choosing to leave (Leave button, in-app navigation, Back) cleans up
     * immediately on the server: an owner's room closes for everyone, a
     * participant's membership ends. Only connection loss (network drop, tab
     * close, refresh) keeps the 10 s reconnection grace.
     */
    const isOwner = !!activeRoom && !!userId && activeRoom.ownerId === userId;
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

    usePartyLeaveGuard(!!activeRoom && !isLeaving, requestLeave);

    // The user confirmed leaving their other room in order to join this one.
    const handleSwitchIntoThisRoom = useCallback(() => {
        if (!roomCode || !userId) return;
        gatewayEngine.connect({
            dto: { roomCode, passwordPlain: joinPasswordRef.current },
            userId,
            leaveCurrent: true,
        });
    }, [gatewayEngine, roomCode, userId]);

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

        liveKitMediaEngineRef.current = engine;

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

            if (liveKitMediaEngineRef.current === engine) {
                liveKitMediaEngineRef.current = null;
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

    // Push-to-talk: apply the held state to the engine.
    const canTalk =
        liveKitStatus === "CONNECTED" || liveKitStatus === "MEDIA_CONNECTED";

    useEffect(() => {
        const engine = liveKitMediaEngineRef.current;

        if (!engine) {
            return;
        }

        void engine.setMicrophoneActive(isTalkHeld && canTalk);
    }, [isTalkHeld, canTalk]);

    // Push-to-talk: hold V anywhere except while typing (e.g. in chat).
    useEffect(() => {
        const isTypingTarget = (target: EventTarget | null) => {
            const element = target as HTMLElement | null;

            return (
                !!element &&
                (element.isContentEditable ||
                    element.tagName === "INPUT" ||
                    element.tagName === "TEXTAREA" ||
                    element.tagName === "SELECT")
            );
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                event.code !== PUSH_TO_TALK_KEY ||
                event.repeat ||
                isTypingTarget(event.target)
            ) {
                return;
            }

            if (event.ctrlKey || event.metaKey || event.altKey) {
                return;
            }

            event.preventDefault();
            setIsTalkHeld(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === PUSH_TO_TALK_KEY) {
                setIsTalkHeld(false);
            }
        };

        // A key-up is never delivered if focus leaves the page mid-press.
        const release = () => setIsTalkHeld(false);
        const handleVisibilityChange = () => {
            if (document.visibilityState !== "visible") release();
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", release);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", release);
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange,
            );
        };
    }, []);

    // beforeunload effect
    useEffect(() => {
        const handleWindowClose = () => {
            gatewayEngine.disconnect(); // Explicitly cut socket link before tab thread dies
        };

        window.addEventListener("beforeunload", handleWindowClose);
        return () => {
            window.removeEventListener("beforeunload", handleWindowClose);
        };
    }, [gatewayEngine]);

    // Auth logging effect
    useEffect(() => {
        log.debug("Auth state", {
            userId,
            roomCode,
            isAuthenticated,
        });
    }, [userId, roomCode, isAuthenticated]);

    // The session ended for good (host closed the room, or this user left it
    // in another tab): show why, then return to the catalog.
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

    // Server rejections about the room password (missing, wrong, too many tries).
    const isPasswordError =
        !!roomErrorMessage && /password|credential/i.test(roomErrorMessage);

    const handleRetryWithPassword = (event: React.FormEvent) => {
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
                                    onClick={handleSwitchIntoThisRoom}
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
                            onSubmit={handleRetryWithPassword}
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
                                    onClick={() => {
                                        if (!roomCode || !userId) return;
                                        gatewayEngine.connect({
                                            dto: {
                                                roomCode,
                                                passwordPlain:
                                                    joinPasswordRef.current,
                                            },
                                            userId,
                                        });
                                    }}
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
                    localParticipantId={
                        liveKitMediaSessionConnection?.data.participantId ?? ""
                    }
                    videoSize={videoSize}
                    videoOpacity={videoOpacity}
                    isLocalTalking={isMicActive}
                />

                {/* BASE LAYER: Standalone film stream component */}
                <Box className="w-full h-full absolute inset-0 z-0 pointer-events-auto">
                    <MemoizedWatchClientLeaf
                        mediaId={resolvedMovieId}
                        isPartyMode={true}
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
                onClose={() => setPendingLeave(null)}
                title="Close this watch room?"
                centered
            >
                <Text size="sm" mb="md">
                    You are the host. Leaving will close room{" "}
                    {activeRoom?.roomCode} for everyone watching, and they will
                    be returned to the catalog.
                </Text>
                <Group justify="flex-end" gap="sm">
                    <Button
                        variant="subtle"
                        onClick={() => setPendingLeave(null)}
                    >
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
