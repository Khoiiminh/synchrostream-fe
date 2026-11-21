"use client";

import { useState } from "react";
import { Tooltip } from "@mantine/core";
import { Check, Copy, Users } from "lucide-react";

interface RoomPillProps {
    roomCode: string;
    memberCount: number;
}

/**
 * Compact "who and where" pill for the party top bar: a live dot, the room
 * code (click to copy) and how many people are in the room. The full access
 * keys (password, invite link) stay in the overlay settings panel.
 */
export default function RoomPill({ roomCode, memberCount }: RoomPillProps) {
    const [copied, setCopied] = useState(false);

    const copyCode = () => {
        void navigator.clipboard.writeText(roomCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/50 py-1 pl-3 pr-1 text-xs shadow-lg backdrop-blur-md">
            <span className="relative mr-1 flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-400" />
            </span>
            <span className="font-semibold uppercase tracking-wider text-zinc-400">
                Room
            </span>
            <Tooltip label={copied ? "Copied!" : "Copy room code"} withArrow>
                <button
                    type="button"
                    onClick={copyCode}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-0.5 font-mono font-bold tracking-widest text-white transition-colors hover:bg-white/10"
                >
                    {roomCode}
                    {copied ? (
                        <Check size={12} className="text-teal-300" />
                    ) : (
                        <Copy size={12} className="text-zinc-400" />
                    )}
                </button>
            </Tooltip>
            <span className="ml-1 flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-zinc-300">
                <Users size={12} />
                {memberCount}
            </span>
        </div>
    );
}
