"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
    Group,
    Text,
    Container,
    Button,
    Stack,
    TextInput,
    Modal,
} from "@mantine/core";
import { RoomPasswordInput } from "@/shared/ui/RoomPasswordInput";
import { RoomPasswordInput } from "@/shared/ui/RoomPasswordInput";
import ProfileMenuClientLeaf from "./ProfileMenuClientLeaf";
import { useRouter } from "next/navigation";
import { Hash, KeyRound, LogIn, Users } from "lucide-react";
import { guardedNavigate } from "@/shared/lib/leaveGuard";
import { guardedNavigate } from "@/shared/lib/leaveGuard";
import {
    ROOM_CODE_PATTERN,
    ROOM_PASSWORD_MAX_LENGTH,
    ROOM_PASSWORD_MIN_LENGTH,
    saveJoinPassword,
} from "@/features/watch-party";
import ModalHeading from "@/shared/ui/ModalHeading";

interface NavbarWrapperProps {
    children: React.ReactNode;
}

export default function NavbarWrapper({ children }: NavbarWrapperProps) {
    const router = useRouter();
    const [targetRoomCode, setTargetRoomCode] = useState("");
    const [targetPassword, setTargetPassword] = useState("");
    const [opened, setOpened] = useState(false);

    const canJoin =
        ROOM_CODE_PATTERN.test(targetRoomCode.trim().toUpperCase()) &&
        targetPassword.trim().length >= ROOM_PASSWORD_MIN_LENGTH;

    const handleJoinRoomSubmit = (e: React.SubmitEvent) => {
        e.preventDefault();
        const cleanCode = targetRoomCode.trim().toUpperCase();
        const cleanPassword = targetPassword.trim();

        // Locked until both fields are filled in (the button is disabled too).
        if (!canJoin) {
            return;
        }

        // The password goes to this tab's storage, never into the URL. The
        // party page reads it from there for the join handshake.
        saveJoinPassword({ roomCode: cleanCode, password: cleanPassword });

        // From inside a party this is a room switch: leave the current room first.
        guardedNavigate(router, `/party/${cleanCode}`);

        setTargetRoomCode("");
        setTargetPassword("");
        setOpened(false);
    };

    return (
        <div className="min-h-screen flex flex-col">
            <header className="w-full bg-[#070b12]/70 backdrop-blur-md border-b border-white/5 sticky top-0 z-50">
                <Container size="xl" h={64}>
                    <Group justify="space-between" h="100%">
                        <Link
                            href="/catalog"
                            passHref
                            style={{ textDecoration: "none" }}
                        >
                            <Group
                                gap={10}
                                className="hover:opacity-90 transition-opacity"
                            >
                                {/* Logo mark: two offset play triangles = "in sync". */}
                                <svg
                                    width="28"
                                    height="28"
                                    viewBox="0 0 28 28"
                                    aria-hidden="true"
                                >
                                    <defs>
                                        <linearGradient
                                            id="ss-logo"
                                            x1="0"
                                            y1="0"
                                            x2="1"
                                            y2="1"
                                        >
                                            <stop
                                                offset="0"
                                                stopColor="#5eead4"
                                            />
                                            <stop
                                                offset="1"
                                                stopColor="#60a5fa"
                                            />
                                        </linearGradient>
                                    </defs>
                                    <path
                                        d="M4 5 L17 14 L4 23 Z"
                                        fill="url(#ss-logo)"
                                        opacity="0.55"
                                    />
                                    <path
                                        d="M11 5 L24 14 L11 23 Z"
                                        fill="url(#ss-logo)"
                                    />
                                </svg>
                                <Text
                                    fw={900}
                                    className="text-xl tracking-tighter text-brand-gradient"
                                >
                                    SYNCHROSTREAM
                                </Text>
                            </Group>
                        </Link>

                        <Group gap="md">
                            {/* Trigger Button to open the Room Join HUD Panel */}
                            <Button
                                variant="subtle"
                                color="teal"
                                size="sm"
                                leftSection={<Users size={16} />}
                                onClick={() => setOpened(true)}
                                className="hover:bg-zinc-800/60 text-teal-400"
                            >
                                Join Room
                            </Button>

                            <ProfileMenuClientLeaf />
                        </Group>
                    </Group>
                </Container>
            </header>

            {/* Join a room: both the code and the room's password are required. */}
            <Modal
                opened={opened}
                onClose={() => setOpened(false)}
                title={
                    <ModalHeading
                        icon={<Users size={20} />}
                        title="Join a watch party"
                        subtitle="Use the code and password from your host"
                    />
                }
            >
                <form onSubmit={handleJoinRoomSubmit}>
                    <Stack gap="md">
                        <TextInput
                            label="Room code"
                            description="6 letters or numbers"
                            placeholder="7E29T6"
                            required
                            data-autofocus
                            maxLength={6}
                            autoComplete="off"
                            spellCheck={false}
                            leftSection={<Hash size={16} />}
                            value={targetRoomCode}
                            onChange={(e) =>
                                setTargetRoomCode(
                                    e.currentTarget.value
                                        .toUpperCase()
                                        .replace(/[^A-Z0-9]/g, ""),
                                )
                            }
                            classNames={{
                                input: "font-mono! tracking-[0.35em]! text-base! font-bold!",
                            }}
                        />

                        <RoomPasswordInput
                            label="Room password"
                            placeholder="Enter the room password"
                            required
                            maxLength={ROOM_PASSWORD_MAX_LENGTH}
                            leftSection={<KeyRound size={16} />}
                            value={targetPassword}
                            onChange={(e) =>
                                setTargetPassword(e.currentTarget.value)
                            }
                        />

                        <Button
                            type="submit"
                            fullWidth
                            size="md"
                            radius="md"
                            variant="gradient"
                            gradient={{ from: "teal.4", to: "cyan.5", deg: 90 }}
                            className="text-zinc-950!"
                            disabled={!canJoin}
                            leftSection={<LogIn size={18} />}
                        >
                            Enter A Room
                        </Button>
                    </Stack>
                </form>
            </Modal>

            <main className="grow flex flex-col">{children}</main>
        </div>
    );
}
