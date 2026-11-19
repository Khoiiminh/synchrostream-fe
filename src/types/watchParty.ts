/**
 * One chat message as the watch-party gateway sends it, in
 * `room:chat:broadcast` and in each entry of `room:chat:history`.
 */
export interface ChatMessageBroadcastPayload {
    /** chat_history id; null when the server could only relay it live. */
    id: string | null;
    /** Null for history rows whose sender account was deleted. */
    userId: string | null;
    username: string;
    message: string;
    /** Server time in epoch ms. */
    timestamp: number;
    /** Echo of the sender's optimistic id, so the sending tab can match it. */
    clientMessageId: string | null;
}

/** Payload of `room:chat:history`, sent to a socket right after it binds. */
export interface ChatHistoryPayload {
    roomId: string;
    messages: ChatMessageBroadcastPayload[];
}

/** Ack of `room:chat:message`. */
export type ChatSendAck =
    | { ok: true; id: string | null; timestamp: number }
    | {
          ok: false;
          code:
              | "NOT_IN_ROOM"
              | "INVALID_MESSAGE"
              | "RATE_LIMITED"
              | "NO_CONNECTION"
              | "TIMEOUT";
          message: string;
          retryAfterMs?: number;
      };

/** Must match CHAT_MESSAGE_MAX_LENGTH on the backend (code points). */
export const CHAT_MESSAGE_MAX_LENGTH = 500;
