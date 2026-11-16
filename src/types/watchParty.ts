/** Payload of the watch-party gateway's chat broadcast event. */
export interface ChatMessageBroadcastPayload {
    userId: string;
    username: string;
    message: string;
    timestamp: number;
}
