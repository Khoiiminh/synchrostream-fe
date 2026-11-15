import { io, Socket } from "socket.io-client";
import { Store } from "@reduxjs/toolkit";
import {
    syncRoomState,
    updateRoomPlayback,
    removeMember,
    setRoomError,
    clearRoomSession,
    RoomErrorDetail,
    RoomSnapshotPayload,
    PlaybackStateSnapshot,
} from "@/store/slices/roomSlice";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("WatchPartyGateway");

interface JoinRoomDto {
    roomCode: string;
    passwordPlain: string;
}

interface ConnectionHandshakePayload {
    dto: JoinRoomDto;
    userId: string;
    /**
     * The user confirmed "leave my current room and join this one". The server
     * acts on it only when the current membership is the sole obstacle.
     */
    leaveCurrent?: boolean;
}

interface LeaveRoomAck {
    ok: boolean;
    status?: string;
    message?: string;
}

/** How long a voluntary leave waits for the socket ack before using REST. */
const LEAVE_ACK_TIMEOUT_MS = 3000;

interface SyncPulseBroadcastPayload {
    action: "PLAY" | "PAUSE" | "SEEK";
    playhead: number;
    originatorId: string;
    serverExecutionTime: number;
}

interface TelemetryPongPayload {
    currentLatency: number;
}

interface RoomErrorPayload {
    message: string;
    /** Set by the gateway: true for infrastructure failures worth retrying. */
    retryable?: boolean;
    /** Structured conflict code, e.g. ACTIVE_MEMBERSHIP_ELSEWHERE. */
    code?: string;
    currentRoomCode?: string;
    currentRoomIsOwned?: boolean;
}

/** Retries after a retryable server-side disconnect (ms). The first retry must land
 * well inside the backend's 10 s reconnection grace, or an owner's room terminates.
 * The ~32 s total also covers a room that is still PROVISIONING after creation. */
const SERVER_DISCONNECT_RETRY_DELAYS_MS = [
    1000, 2000, 4000, 5000, 5000, 5000, 5000, 5000,
];

interface ChatMessagePayload {
    userId: string;
    username: string;
    message: string;
    timestamp: number;
}

interface GatewayEventMap {
    "room:state_update": RoomSnapshotPayload;
    "room:sync:broadcast": SyncPulseBroadcastPayload;
    "room:member_left": { userId: string };
    "room:error": RoomErrorPayload;
    "room:telemetry:pong": TelemetryPongPayload;
    "room:chat:broadcast": ChatMessagePayload;
    "room:terminated": { message: string };
    /** This user left the room from another tab/window (voluntary leave). */
    "room:left": { message: string };
}

interface GatewayClientEventMap {
    "room:connect": {
        dto: JoinRoomDto;
        leaveCurrent?: boolean;
    };
    "room:sync:pulse": {
        roomId: string;
        roomCode: string;
        action: "PLAY" | "PAUSE" | "SEEK";
        playhead: number;
    };
    "room:chat:message": {
        roomCode: string;
        message: string;
    };
    "room:telemetry:ping": {
        roomId: string;
        userId: string;
        clientTimestamp: number;
    };
}

type GatewayServerEvents = {
    [K in keyof GatewayEventMap]: (data: GatewayEventMap[K]) => void;
};

/**
 * Any server-event listener. socket.io's types cannot relate a generic event
 * name to its listener, so listeners are widened to this union after on<K>()
 * has checked the pairing; no type assertion is needed for the widening.
 */
type AnyGatewayListener = GatewayServerEvents[keyof GatewayEventMap];

type GatewayClientEvents = {
    [K in keyof GatewayClientEventMap]: (
        data: GatewayClientEventMap[K],
    ) => void;
} & {
    "room:leave": (
        data: Record<string, never>,
        ack: (response: LeaveRoomAck) => void,
    ) => void;
    "clock:sync": (
        data: { clientSendTime: number },
        ack: (response: ClockSyncAck) => void,
    ) => void;
};

interface ClockSyncAck {
    clientSendTime: number | null;
    serverReceiveTime: number;
    serverSendTime: number;
}

const CLOCK_PROBE_TIMEOUT_MS = 2000;

/** Accepts a bare ClockSyncAck or one wrapped as `{ data: ClockSyncAck }`. */
function unwrapClockSyncAck(
    raw: unknown,
): { serverReceiveTime: number; serverSendTime: number } | null {
    const reply: unknown =
        typeof raw === "object" && raw !== null && "data" in raw
            ? raw.data
            : raw;
    if (
        typeof reply !== "object" ||
        reply === null ||
        !("serverReceiveTime" in reply) ||
        !("serverSendTime" in reply) ||
        typeof reply.serverReceiveTime !== "number" ||
        typeof reply.serverSendTime !== "number"
    ) {
        return null;
    }
    return {
        serverReceiveTime: reply.serverReceiveTime,
        serverSendTime: reply.serverSendTime,
    };
}

export class WatchPartyGatewayEngine {
    private socket: Socket<GatewayServerEvents, GatewayClientEvents> | null =
        null;
    private telemetryIntervalId: NodeJS.Timeout | null = null;
    private currentUserId: string | null = null;
    private disconnectTimeoutId: NodeJS.Timeout | null = null;

    // Server-disconnect recovery state.
    private lastConnectPayload: ConnectionHandshakePayload | null = null;
    private lastRoomErrorRetryable: boolean | null = null;
    private lastRoomErrorMessage: string | null = null;
    private lastRoomErrorDetail: RoomErrorDetail | null = null;
    private roomTerminated = false;
    private currentRoomId: string | null = null;
    /**
     * Latest known room playback state (from room:state_update, kept current by
     * broadcasts). Lets a coordinator created after the join sync immediately.
     */
    private lastPlaybackSnapshot: PlaybackStateSnapshot | null = null;

    public getLastPlaybackSnapshot(): PlaybackStateSnapshot | null {
        return this.lastPlaybackSnapshot
            ? { ...this.lastPlaybackSnapshot }
            : null;
    }
    private retryAttempts = 0;
    private retryTimeoutId: NodeJS.Timeout | null = null;

    // Listeners registered through on(). Kept here so they survive socket
    // replacement after a server-side disconnect.
    private readonly externalListeners = new Map<
        keyof GatewayEventMap,
        Set<AnyGatewayListener>
    >();

    constructor(private readonly store: Store) {}

    public connect(payload: ConnectionHandshakePayload): void {
        /**
         * A React effect may be replayed by Strict Mode.
         * If cleanup scheduled a disconnect, cancel it because the effect has
         * immediately establish a new lifecycle.
         */
        if (this.disconnectTimeoutId) {
            clearTimeout(this.disconnectTimeoutId);
            this.disconnectTimeoutId = null;
        }

        /**
         * Do not create another socket if one already exists,
         * including a socket that is still CONNECTING.
         */
        if (this.socket) {
            log.debug("Connection already exists", {
                connected: this.socket.connected,
                socketId: this.socket.id,
            });

            return;
        }

        this.lastConnectPayload = payload;
        this.roomTerminated = false;
        this.retryAttempts = 0;

        this.openSocket(payload);
    }

    private openSocket(payload: ConnectionHandshakePayload): void {
        const token =
            typeof window !== "undefined"
                ? localStorage.getItem("access_token")
                : null;
        const { roomCode, passwordPlain } = payload.dto;
        this.currentUserId = payload.userId;
        this.lastRoomErrorRetryable = null;
        this.lastRoomErrorMessage = null;
        this.lastRoomErrorDetail = null;

        const baseUrl =
            process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:7000";

        // Matches backend: namspace: 'sync-hub' (incorporating the backend parameter typo safely)
        this.socket = io(`${baseUrl}/sync-hub`, {
            path: "/socket.io",
            transports: ["websocket"],
            autoConnect: true,
            query: {
                token: token,
            },
        });

        this.setupGatewayListeners();

        // On open wire execution, immediately authorize and join the room channel
        this.socket.on("connect", () => {
            // Read the flag at emit time: it is cleared after the first successful
            // join, so an automatic reconnect never repeats a room switch.
            const leaveCurrent =
                (this.lastConnectPayload ?? payload).leaveCurrent === true;
            this.socket?.emit("room:connect", {
                dto: {
                    roomCode: roomCode.trim().toUpperCase(),
                    passwordPlain: passwordPlain,
                },
                leaveCurrent,
            });
        });
    }

    private setupGatewayListeners(): void {
        if (!this.socket) return;

        // Direct structural mirrors of the gateway server emitters
        this.socket.on("room:state_update", this.handleRoomStateUpdate);

        this.socket.on("room:sync:broadcast", this.handlePlaybackBroadcast);

        this.socket.on("room:member_left", this.handleMemberLeft);

        this.socket.on("room:error", this.handleRoomError);

        this.socket.on("room:telemetry:pong", this.handleTelemetryPong);

        this.socket.on("disconnect", this.handleDisconnect);

        // Emits the incoming payload straight through the custom proxy event listener pipeline
        this.socket.on("room:chat:broadcast", this.handleChatBroadcast);

        this.socket.on("room:terminated", this.handleRoomTerminated);

        // Left from another tab: like termination, never auto-rejoin.
        this.socket.on("room:left", this.handleRoomTerminated);

        // Re-attach listeners registered through on() to this (possibly new) socket.
        for (const [event, callbacks] of this.externalListeners) {
            for (const callback of callbacks) {
                this.socket.on(event, callback);
            }
        }
    }

    private handleRoomTerminated = (): void => {
        // A terminated room must never be rejoined automatically.
        this.roomTerminated = true;
    };

    private handleRoomStateUpdate = (snapshot: RoomSnapshotPayload): void => {
        log.debug("Room sync snapshot received", {
            roomId: snapshot.roomId,
            roomCode: snapshot.roomCode,
            movieId: snapshot.movieId,
            mediaSessionId: snapshot.mediaSessionId,
            memberCount: snapshot.members.length,
        });
        this.store.dispatch(syncRoomState(snapshot));
        this.currentRoomId = snapshot.roomId;
        if (snapshot.playback)
            this.lastPlaybackSnapshot = { ...snapshot.playback };
        // A successful handshake ends any server-disconnect retry sequence and
        // consumes a confirmed room switch.
        this.retryAttempts = 0;
        if (this.lastConnectPayload?.leaveCurrent) {
            this.lastConnectPayload = {
                ...this.lastConnectPayload,
                leaveCurrent: false,
            };
        }
        this.startTelemetryHeartbeat(snapshot.roomId, this.currentUserId ?? "");
    };

    private handlePlaybackBroadcast = (
        data: SyncPulseBroadcastPayload,
    ): void => {
        log.debug("Received room:sync:broadcast", data);

        this.store.dispatch(
            updateRoomPlayback({
                status: data.action === "PLAY" ? "PLAYING" : "PAUSED",
                playhead: data.playhead,
                lastUpdated: data.serverExecutionTime,
            }),
        );

        // Keep the cached snapshot current; SEEK keeps the previous play state.
        this.lastPlaybackSnapshot = {
            status:
                data.action === "PLAY"
                    ? "PLAYING"
                    : data.action === "PAUSE"
                      ? "PAUSED"
                      : (this.lastPlaybackSnapshot?.status ?? "PAUSED"),
            playhead: data.playhead,
            lastUpdated: data.serverExecutionTime,
        };

        this.playbackListeners.forEach((listener) => {
            listener(data);
        });
    };

    private handleMemberLeft = (data: { userId: string }): void => {
        this.store.dispatch(removeMember({ userId: data.userId }));
    };

    private handleRoomError = (data: RoomErrorPayload) => {
        if (typeof data.retryable === "boolean") {
            this.lastRoomErrorRetryable = data.retryable;
        }
        this.lastRoomErrorMessage = data.message;
        this.lastRoomErrorDetail = data.code
            ? {
                  code: data.code,
                  currentRoomCode: data.currentRoomCode,
                  currentRoomIsOwned: data.currentRoomIsOwned,
              }
            : null;
        this.store.dispatch(
            setRoomError({
                message: data.message,
                detail: this.lastRoomErrorDetail,
            }),
        );
    };

    private handleDisconnect = (reason: Socket.DisconnectReason) => {
        this.stopTelemetryHeartbeat();

        // Transport-level drops are retried by socket.io itself, and its "connect"
        // handler re-sends room:connect. Keep the room context meanwhile, so the
        // LiveKit connection (keyed on activeRoom.mediaSessionId) is not torn down
        // by a network blip; the next room:state_update replaces it.
        if (reason !== "io server disconnect") {
            if (reason === "io client disconnect") {
                this.store.dispatch(clearRoomSession());
            }
            return;
        }

        // A server-initiated disconnect is final for that socket object, so
        // connect() would otherwise early-return forever.
        this.lastPlaybackSnapshot = null;
        this.store.dispatch(clearRoomSession());
        // clearRoomSession resets errorMessage; keep the reason the server gave.
        if (this.lastRoomErrorMessage) {
            this.store.dispatch(
                setRoomError({
                    message: this.lastRoomErrorMessage,
                    detail: this.lastRoomErrorDetail,
                }),
            );
        }

        const deadSocket = this.socket;
        this.socket = null;
        deadSocket?.removeAllListeners();

        const payload = this.lastConnectPayload;
        const delayMs = SERVER_DISCONNECT_RETRY_DELAYS_MS[this.retryAttempts];
        const shouldRetry =
            !!payload &&
            !this.roomTerminated &&
            this.lastRoomErrorRetryable === true &&
            delayMs !== undefined;

        if (!shouldRetry) {
            // Non-retryable rejection, room termination, or replacement by another
            // tab. Leave the socket null so a later connect() can start fresh.
            return;
        }

        this.retryAttempts += 1;
        log.warn("Retrying room handshake after server disconnect", {
            attempt: this.retryAttempts,
            delayMs,
        });

        this.retryTimeoutId = setTimeout(() => {
            this.retryTimeoutId = null;
            if (this.socket || this.lastConnectPayload !== payload) return;
            this.openSocket(payload);
        }, delayMs);
    };

    private handleTelemetryPong = (data: TelemetryPongPayload): void => {
        // Future latency calculations.
        // Catch network roundtrip telemetry metrics directly from the server if debugging
    };

    private handleChatBroadcast = (data: ChatMessagePayload) => {
        // By piping this event through, UI layers using engine.on({ event: 'room:chat:broadcast', callback }) capture this cleanly
    };

    public emitPlaybackPulse(payload: {
        roomId: string;
        roomCode: string;
        action: "PLAY" | "PAUSE" | "SEEK";
        playhead: number;
    }): void {
        log.debug("Emitting playback pulse", {
            connected: this.socket?.connected,
            socketId: this.socket?.id,
            payload,
        });

        if (!this.socket) {
            log.error("Cannot emit playback pulse: socket is null");
            return;
        }

        if (!this.socket.connected) {
            log.error("Cannot emit playback pulse: socket is disconnected");
            return;
        }

        this.socket.emit("room:sync:pulse", payload);
    }

    /**
     * One NTP-style clock probe (see ClockSync). Resolves with the server's
     * receive/send timestamps, or null when the socket is unavailable or the
     * probe times out.
     */
    public async probeClock(
        clientSendTime: number,
    ): Promise<{ serverReceiveTime: number; serverSendTime: number } | null> {
        const socket = this.socket;
        if (!socket?.connected) return null;

        try {
            const raw = await socket
                .timeout(CLOCK_PROBE_TIMEOUT_MS)
                .emitWithAck("clock:sync", { clientSendTime });
            // Tolerate a response-wrapping interceptor ({ data: {...} }).
            const reply = unwrapClockSyncAck(raw);
            if (!reply) {
                return null;
            }
            return {
                serverReceiveTime: reply.serverReceiveTime,
                serverSendTime: reply.serverSendTime,
            };
        } catch {
            return null;
        }
    }

    public emitChatMessage(payload: {
        roomCode: string;
        message: string;
    }): void {
        if (!this.socket) return;

        this.socket.emit("room:chat:message", payload);
    }

    public onPlaybackSync(
        callback: (payload: SyncPulseBroadcastPayload) => void,
    ) {
        this.playbackListeners.add(callback);

        return () => {
            this.playbackListeners.delete(callback);
        };
    }

    private startTelemetryHeartbeat(roomId: string, userId: string): void {
        this.stopTelemetryHeartbeat();
        this.telemetryIntervalId = setInterval(() => {
            if (this.socket?.connected) {
                this.socket.emit("room:telemetry:ping", {
                    roomId,
                    userId,
                    clientTimestamp: Date.now(),
                });
            }
        }, 5000); // Pulse network ping metrics up-pipe every 5 seconds
    }

    private stopTelemetryHeartbeat(): void {
        if (this.telemetryIntervalId) {
            clearInterval(this.telemetryIntervalId);
            this.telemetryIntervalId = null;
        }
    }

    private playbackListeners = new Set<
        (payload: SyncPulseBroadcastPayload) => void
    >();

    /**
     * Voluntary leave. Unlike disconnect() (connection-loss semantics, which the
     * server answers with a 10 s reconnection grace), this asks the server to
     * clean up immediately and resolves only after it has committed, so the
     * caller can create or join another room right away.
     *
     * Order: socket `room:leave` with ack → REST fallback → local teardown.
     * If both fail, nothing is stranded: the server's grace/presence path still
     * cleans up within seconds.
     */
    public async leaveRoom(): Promise<{ ok: boolean }> {
        const socket = this.socket;
        const roomId = this.currentRoomId;

        // Never auto-reconnect into the room we are leaving.
        this.lastConnectPayload = null;
        this.roomTerminated = true;
        if (this.retryTimeoutId) {
            clearTimeout(this.retryTimeoutId);
            this.retryTimeoutId = null;
        }

        let acknowledged = false;
        if (socket?.connected) {
            try {
                const response = await socket
                    .timeout(LEAVE_ACK_TIMEOUT_MS)
                    .emitWithAck("room:leave", {});
                acknowledged = response?.ok === true;
            } catch (error) {
                log.warn("room:leave ack failed; using REST fallback", error);
            }
        }

        if (!acknowledged && roomId) {
            acknowledged = await this.leaveRoomOverRest(roomId);
        }

        // Tear down now (not deferred): this is a deliberate end of the session.
        this.stopTelemetryHeartbeat();
        if (this.disconnectTimeoutId) {
            clearTimeout(this.disconnectTimeoutId);
            this.disconnectTimeoutId = null;
        }
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.currentUserId = null;
        this.currentRoomId = null;
        this.lastPlaybackSnapshot = null;
        this.store.dispatch(clearRoomSession());

        return { ok: acknowledged };
    }

    private async leaveRoomOverRest(roomId: string): Promise<boolean> {
        const token =
            typeof window !== "undefined"
                ? localStorage.getItem("access_token")
                : null;
        const baseUrl =
            process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:7000";
        try {
            const response = await fetch(
                `${baseUrl}/v1/watch-party/rooms/${roomId}/leave`,
                {
                    method: "POST",
                    headers: token ? { authorization: `Bearer ${token}` } : {},
                    // Survives an immediately following navigation.
                    keepalive: true,
                },
            );
            return response.ok;
        } catch (error) {
            log.warn(
                "REST leave failed; the server grace path will clean up",
                error,
            );
            return false;
        }
    }

    public disconnect(): void {
        this.stopTelemetryHeartbeat();

        if (this.retryTimeoutId) {
            clearTimeout(this.retryTimeoutId);
            this.retryTimeoutId = null;
        }

        // Avoid scheduling multiple disconnects.
        if (this.disconnectTimeoutId) return;

        /**
         * Delay the actual socket destruction by one event-loop turn.
         *
         * Because React Strict Mode can do:
         *    effect -> cleanup -> effect
         *
         * immediately during development.
         *
         * The second connect() gets a chance to cancel this disconnect.
         */
        this.disconnectTimeoutId = setTimeout(() => {
            this.disconnectTimeoutId = null;
            this.lastConnectPayload = null;

            if (this.retryTimeoutId) {
                clearTimeout(this.retryTimeoutId);
                this.retryTimeoutId = null;
            }

            if (!this.socket) return;

            this.socket.disconnect();
            this.socket = null;
            this.currentUserId = null;
        }, 0);
    }

    /**
     * Allows React components to attach ephemeral listeners for events
     * that require UI side-effects (like routing/alerts) rather than Redux state changes.
     */
    public on<K extends keyof GatewayEventMap>(p: {
        event: K;
        callback: GatewayServerEvents[K];
    }): () => void {
        const event: keyof GatewayEventMap = p.event;
        const callback: AnyGatewayListener = p.callback;
        let callbacks = this.externalListeners.get(p.event);
        if (!callbacks) {
            callbacks = new Set();
            this.externalListeners.set(p.event, callbacks);
        }
        callbacks.add(callback);

        this.socket?.on(event, callback);

        return () => {
            this.externalListeners.get(p.event)?.delete(callback);
            this.socket?.off(event, callback);
        };
    }
}
