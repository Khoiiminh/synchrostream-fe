import { io, Socket } from "socket.io-client";
import { Store } from "@reduxjs/toolkit";
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
  userId: string;
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
  private currentUserId: string | null = null;

  constructor(private readonly store: Store) {}

  public connect(payload: ConnectionHandshakePayload): void {
    if (this.socket?.connected) return;

    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("access_token")
        : null;
    const { roomCode, passwordPlain } = payload.dto;
    const rtcIdentity = payload.rtcIdentity;
    this.currentUserId = payload.userId;

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
    this.socket.on("room:state_update", this.handleRoomStateUpdate);

    this.socket.on("room:sync:broadcast", this.handlePlaybackBroadcast);

    this.socket.on("room:member_left", this.handleMemberLeft);

    this.socket.on("room:error", this.handleRoomError);

    this.socket.on("room:telemetry:pong", this.handleTelemetryPong);

    this.socket.on("disconnect", this.handleDisconnect);

    // Emits the incoming payload straight through the custom proxy event listener pipeline
    this.socket.on("room:chat:broadcast", this.handleChatBroadcast);

    this.queueListeners.forEach((p) => {
      this.socket?.on(p.event, p.callback);
    })
  }

  private handleRoomStateUpdate = (snapshot: RoomSnapshotPayload): void => {
    console.log("Room Sync Payload:", snapshot);
      this.store.dispatch(syncRoomState(snapshot));
      this.startTelemetryHeartbeat(
        snapshot.roomId,
        this.currentUserId ?? "",
      );
  }
  
  private handlePlaybackBroadcast = (data: SyncPulseBroadcastPayload): void => {
    console.log("[WatchPartyGatewayEngine] RECEIVED room:sync:broadcast", data);

    this.store.dispatch(
        updateRoomPlayback({
          status:
            data.action==="PLAY"
              ?"PLAYING"
              :"PAUSED",
          playhead:data.playhead,
          lastUpdated:data.serverExecutionTime
        })
      );

      this.playbackListeners.forEach((listener) => {
        listener(data)
      });
  }

  private handleMemberLeft = (data: { userId: string }): void => {
    this.store.dispatch(removeMember({ userId: data.userId }));
  }

  private handleRoomError = (data: RoomErrorPayload) => {
    this.store.dispatch(setRoomError({ message: data.message }));
  }

  private handleDisconnect = () => {
    this.stopTelemetryHeartbeat();
    this.store.dispatch(clearRoomSession());
  }

  private handleTelemetryPong = (data: TelemetryPongPayload): void => {
     // Future latency calculations.
     // Catch network roundtrip telemetry metrics directly from the server if debugging
  }

  private handleChatBroadcast = (data: ChatMessagePayload) => {
    // By piping this event through, UI layers using engine.on({ event: 'room:chat:broadcast', callback }) capture this cleanly
  }

  public emitPlaybackPulse(payload: {
    roomId: string;
    roomCode: string;
    userId: string;
    action: "PLAY" | "PAUSE" | "SEEK";
    playhead: number;
  }): void {
    console.log("[WatchPartyGatewayEngine] emitPlaybackPulse", {
        connected: this.socket?.connected,
        socketId: this.socket?.id,
        payload,
    });

    if (!this.socket) {
        console.error(
            "[WatchPartyGatewayEngine] Cannot emit playback pulse: socket is null"
        );
        return;
    }

    if (!this.socket.connected) {
        console.error(
            "[WatchPartyGatewayEngine] Cannot emit playback pulse: socket is disconnected"
        );
        return;
    }

    this.socket.emit("room:sync:pulse", payload);
  }

  public emitChatMessage(payload: { roomCode: string; message: string }): void {
    if (!this.socket) return;

    this.socket.emit("room:chat:message", payload);
  }

  public onPlaybackSync(callback: (payload: SyncPulseBroadcastPayload) => void) {
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
      (
        payload: SyncPulseBroadcastPayload
      ) => void
    >();

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
  public on(p: { event: string; callback: (...args: any[]) => void }): () => void {
    this.queueListeners.push(p);

    if (this.socket) {
      this.socket.on(p.event, p.callback);
    }

    return () => {
      this.off(p)
    };
  }

  public off(p: { event: string; callback?: (...args: any[]) => void }): void {
    this.queueListeners = this.queueListeners.filter(
      (listener) => !(listener.event === p.event && (!p.callback || listener.callback === p.callback)),
    );
    
    this.socket?.off(p.event, p.callback);
  }
}