import { io, Socket } from "socket.io-client";
import { configureStore, Store } from "@reduxjs/toolkit";
import {
  syncRoomState,
  updateRoomPlayback,
  removeMember,
  setRoomError,
  clearRoomSession,
  RoomSnapshotPayload,
} from "@/store/slices/roomSlice";

interface JoinRoomDto {
  roomCode: string;
  passwordPlain: string;
}

interface ConnectionHandshakePayload {
  dto: JoinRoomDto;
  rtcIdentity: string;
}

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
}

interface ChatMessagePayload {
  userId: string;
  username: string;
  message: string;
  timestamp: number;
}

export class WatchPartyGatewayEngine {
  private socket: Socket | null = null;
  private telemetryIntervalId: NodeJS.Timeout | null = null;
  private queueListeners: { event: string; callback: (...args: any[]) => void }[] = [];

  constructor(private readonly store: Store) {}

  public connect(payload: ConnectionHandshakePayload): void {
    if (this.socket?.connected || this.socket?.connect) return;

    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("access_token")
        : null;
    const { roomCode, passwordPlain } = payload.dto;
    const rtcIdentity = payload.rtcIdentity;

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
      this.socket?.emit("room:connect", {
        dto: {
          roomCode: roomCode.trim().toUpperCase(),
          passwordPlain: passwordPlain,
        },
        rtcIdentity: rtcIdentity,
      });
    });
  }

  private setupGatewayListeners(): void {
    if (!this.socket) return;

    // Direct structural mirrors of your gateway server emitters
    this.socket.on("room:state_update", (snapshot: RoomSnapshotPayload) => {
      console.log("Room Sync Payload:", snapshot);
      this.store.dispatch(syncRoomState(snapshot));
      this.startTelemetryHeartbeat(
        snapshot.roomId,
        snapshot.members[0]?.userId || "",
      );
    });

    this.socket.on("room:sync:broadcast", (data: SyncPulseBroadcastPayload) => {
      this.store.dispatch(
        updateRoomPlayback({
          status: data.action === "PLAY" ? "PLAYING" : "PAUSED",
          playhead: data.playhead,
          lastUpdated: data.serverExecutionTime,
        }),
      );
    });

    this.socket.on("room:member_left", (data: { userId: string }) => {
      this.store.dispatch(removeMember({ userId: data.userId }));
    });

    this.socket.on("room:error", (data: RoomErrorPayload) => {
      this.store.dispatch(setRoomError({ message: data.message }));
    });

    this.socket.on("room:telemetry:pong", (data: TelemetryPongPayload) => {
      // Catch network roundtrip telemetry metrics directly from the server if debugging
    });

    this.socket.on("disconnect", () => {
      this.stopTelemetryHeartbeat();
      this.store.dispatch(clearRoomSession());
    });

    // Emits the incoming payload straight through the custom proxy event listener pipeline
    this.socket.on("room:chat:broadcast", (data: ChatMessagePayload) => {
      // By piping this event through, UI layers using engine.on({ event: 'room:chat:broadcast', callback }) capture this cleanly
    });

    this.queueListeners.forEach((p) => {
      this.socket?.on(p.event, p.callback);
    })
  }

  public emitPlaybackPulse(payload: {
    roomId: string;
    roomCode: string;
    userId: string;
    action: "PLAY" | "PAUSE" | "SEEK";
    playhead: number;
  }): void {
    if (!this.socket) return;
    this.socket.emit("room:sync:pulse", payload);
  }

  public emitChatMessage(payload: { roomCode: string; message: string }): void {
    if (!this.socket) return;

    this.socket.emit("room:chat:message", payload);
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

  public disconnect(): void {
    this.stopTelemetryHeartbeat();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Allows React components to attach ephemeral listeners for events
   * that require UI side-effects (like routing/alerts) rather than Redux state changes.
   */
  public on(p: { event: string; callback: (...args: any[]) => void }): void {
    if (!this.socket) {
      this.queueListeners.push(p)
      console.warn(
        `Attempted to listen to event '${p.event}' before socket initialization.`,
      );
      return;
    }

    this.socket.on(p.event, p.callback);
  }

  public off(p: { event: string; callback?: (...args: any[]) => void }): void {
    this.queueListeners = this.queueListeners.filter(
      (l) => !(l.event === p.event && (!p.callback || l.callback === p.callback))
    );
    if (this.socket) {
      if (p.callback) this.socket.off(p.event, p.callback);
      else this.socket.off(p.event);
    }
  }
}