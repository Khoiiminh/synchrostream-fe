"use client";

import { PartyRoom } from "@/features/watch-party/routes";

/** /party/[roomCode]: the room lives in the watch-party slice. */
export default function IntegratedWatchPartyPage() {
    return <PartyRoom />;
}
