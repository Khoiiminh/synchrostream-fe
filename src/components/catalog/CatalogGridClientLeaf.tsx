"use client";

import Link from "next/link";
import {
    Alert,
    Text,
    SimpleGrid,
    Button,
    Group,
    Center,
    Modal,
    Stack,
} from "@mantine/core";
import { RoomPasswordInput } from "@/shared/ui/RoomPasswordInput";
import { useGetMediaCatalogQuery } from "../../store/services/mediaApi";
import { useRouter } from "next/navigation";
import { LoadingPage } from "@/shared/ui/LoadingPage";
import { useState } from "react";
import { KeyRound, Play, Users, Video } from "lucide-react";
import { useCreateRoomMutation } from "@/store/services/watchPartyApi";
import {
    ROOM_PASSWORD_MAX_LENGTH,
    ROOM_PASSWORD_MIN_LENGTH,
    saveOwnedRoomPassword,
} from "@/lib/roomAccessKeys";
import ModalHeading from "@/shared/ui/ModalHeading";

export default function CatalogGridClientLeaf() {
    const { data: catalog, isLoading, error } = useGetMediaCatalogQuery();
    const router = useRouter();
    const [createRoom] = useCreateRoomMutation();

    const [modalOpened, setModalOpened] = useState(false);
    const [selectedMovieId, setSelectedMovieId] = useState<string | null>(null);
    const [roomPassword, setRoomPassword] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [createRoomError, setCreateRoomError] = useState<{
        message: string;
        /** The room the user is still in; set when the conflict can be resolved by switching. */
        existingRoomCode?: string;
        /** True when the user owns that room (switching closes it for everyone). */
        existingRoomIsOwned?: boolean;
    } | null>(null);

    if (isLoading) {
        return (
            <Center style={{ height: "40vh" }}>
                <LoadingPage />
            </Center>
        );
    }

    if (error || !catalog) {
        return (
            <Center style={{ height: "40vh" }}>
                <Text color="red" size="lg" fw={700}>
                    Failed to load active streaming assets.
                </Text>
            </Center>
        );
    }

    const featured = catalog[0];
    const posterOf = (movie: (typeof catalog)[number]) =>
        movie.metadata?.posterUrl || "/spring_poster_pillar_medium.jpg";

    const selectedMovie = catalog.find(
        (movie) => movie.movieId === selectedMovieId,
    );
    // Every room has its own password; the Create button stays locked until then.
    const isPasswordValid =
        roomPassword.trim().length >= ROOM_PASSWORD_MIN_LENGTH &&
        roomPassword.length <= ROOM_PASSWORD_MAX_LENGTH;

    const handleOpenPasswordModal = (movieId: string) => {
        setSelectedMovieId(movieId);
        setRoomPassword("");
        setCreateRoomError(null);
        setModalOpened(true);
    };

    const handleCreateRoom = async (e: React.SubmitEvent) => {
        e.preventDefault();
        await submitCreateRoom(false);
    };

    /**
     * @param leaveCurrent The user confirmed leaving (and, as owner, closing) the
     * room they are still in; the server leaves it immediately, then creates.
     */
    const submitCreateRoom = async (leaveCurrent: boolean) => {
        // Also guards the "Close … and create" path, which skips the form.
        if (!selectedMovieId || !isPasswordValid) return;

        setCreateRoomError(null);
        setIsSubmitting(true);
        const cleanPassword = roomPassword.trim();

        try {
            // The server generates a unique code (retrying collisions with reserved
            // codes). A PROVISIONING result is still a created room: the party page's
            // join retries until the room is ACTIVE.
            const createdRoom = await createRoom({
                passwordPlain: cleanPassword,
                movieId: selectedMovieId,
                maxParticipants: 5,
                ...(leaveCurrent ? { leaveCurrent: true } : {}),
            }).unwrap();

            saveOwnedRoomPassword({
                roomCode: createdRoom.roomCode,
                password: cleanPassword,
            });

            setModalOpened(false);
            // The owner joins without a password; it is kept only for sharing.
            router.push(`/party/${createdRoom.roomCode}`);
        } catch (err: unknown) {
            // RTK Query puts the whole response body in `err.data`. The backend's
            // GlobalExceptionFilter returns { success, message, data, timestamp },
            // so the structured conflict detail is nested at `err.data.data`.
            const queryError = err as {
                status?: number;
                data?: {
                    message?: string;
                    data?: {
                        code?: string;
                        roomCode?: string;
                        isOwner?: boolean;
                    } | null;
                };
            };
            const conflict = queryError.data?.data;
            const existingRoomCode = conflict?.roomCode;

            if (
                queryError.status === 409 &&
                (conflict?.code === "ACTIVE_OWNER_ROOM" ||
                    conflict?.code === "ACTIVE_MEMBERSHIP_ELSEWHERE") &&
                existingRoomCode
            ) {
                const isOwned =
                    conflict.code === "ACTIVE_OWNER_ROOM" ||
                    conflict.isOwner === true;
                setCreateRoomError({
                    message: isOwned
                        ? `You are still hosting room ${existingRoomCode}. Open it, or close it for everyone and create this room.`
                        : `You are still in room ${existingRoomCode}. Leave it to create this room?`,
                    existingRoomCode,
                    existingRoomIsOwned: isOwned,
                });
            } else {
                setCreateRoomError({
                    message:
                        queryError.data?.message ??
                        "We could not create this room. Please check your details and try again.",
                });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            {featured && (
                <section className="animate-fade-rise relative mb-10 flex min-h-[340px] items-end overflow-hidden rounded-2xl border border-white/5 md:min-h-[400px]">
                    {/* Blurred poster backdrop + gradients keep the text readable. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={posterOf(featured)}
                        alt=""
                        aria-hidden="true"
                        className="absolute inset-0 h-full w-full scale-110 object-cover object-[center_40%] opacity-70 blur-[6px] saturate-125"
                    />
                    <div className="absolute inset-0 bg-linear-to-r from-[#070b12] via-[#070b12]/75 to-[#070b12]/10" />
                    <div className="absolute inset-0 bg-[radial-gradient(40rem_20rem_at_0%_100%,rgba(45,212,191,0.18),transparent)]" />
                    <div className="absolute inset-0 bg-linear-to-t from-[#070b12] via-transparent to-transparent" />

                    <div className="relative z-10 flex w-full items-end justify-between gap-8 p-6 md:p-10">
                        <div className="max-w-xl">
                            <span className="inline-block rounded-full border border-teal-400/30 bg-teal-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-teal-300">
                                Featured
                            </span>
                            <h1 className="mt-4 text-4xl font-black tracking-tight text-white md:text-6xl">
                                {featured.title}
                            </h1>
                            {featured.metadata?.genre && (
                                <div className="mt-3 text-sm text-zinc-300">
                                    {featured.metadata.genre}
                                </div>
                            )}
                            {featured.metadata?.description && (
                                <Text
                                    mt="md"
                                    lineClamp={3}
                                    className="text-zinc-300 md:text-lg"
                                >
                                    {featured.metadata.description}
                                </Text>
                            )}
                            <Group mt="xl" gap="sm">
                                <Button
                                    component={Link}
                                    href={`/watch/${featured.movieId}`}
                                    size="md"
                                    variant="gradient"
                                    gradient={{
                                        from: "teal.4",
                                        to: "cyan.5",
                                        deg: 90,
                                    }}
                                    leftSection={
                                        <Play size={18} fill="currentColor" />
                                    }
                                    className="text-zinc-950! shadow-lg shadow-teal-500/20"
                                >
                                    Watch now
                                </Button>
                                <Button
                                    size="md"
                                    variant="default"
                                    leftSection={<Users size={18} />}
                                    className="border-white/10! bg-white/10! text-white! backdrop-blur hover:bg-white/20!"
                                    onClick={() =>
                                        handleOpenPasswordModal(
                                            featured.movieId,
                                        )
                                    }
                                >
                                    Watch together
                                </Button>
                            </Group>
                        </div>

                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={posterOf(featured)}
                            alt={featured.title}
                            className="hidden aspect-2/3 w-52 rotate-2 rounded-xl object-cover shadow-2xl shadow-black/60 ring-1 ring-white/10 lg:block"
                        />
                    </div>
                </section>
            )}

            <Group justify="space-between" mb="md">
                <Text size="lg" fw={800} className="tracking-tight text-white">
                    Browse library
                </Text>
                <Text size="sm" className="text-zinc-500">
                    {catalog.length} {catalog.length === 1 ? "title" : "titles"}
                </Text>
            </Group>

            <SimpleGrid
                cols={{ base: 2, sm: 3, md: 4, lg: 5 }}
                spacing={{ base: "md", md: "lg" }}
                verticalSpacing="xl"
            >
                {catalog.map((movie, index) => (
                    <div
                        key={movie.movieId}
                        className="animate-fade-rise"
                        style={{ animationDelay: `${index * 50}ms` }}
                    >
                        <div className="poster-card relative aspect-2/3 overflow-hidden rounded-xl border border-white/5 bg-zinc-900">
                            <Link
                                href={`/watch/${movie.movieId}`}
                                aria-label={`Watch ${movie.title}`}
                                className="absolute inset-0"
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={posterOf(movie)}
                                    alt={movie.title}
                                    loading="lazy"
                                    className="poster-img h-full w-full object-cover"
                                />
                            </Link>

                            {/* Hover overlay: play badge + room action */}
                            <div className="poster-overlay pointer-events-none absolute inset-0 flex flex-col justify-end bg-linear-to-t from-black/95 via-black/40 to-transparent p-3">
                                <div className="poster-play absolute inset-0 flex items-center justify-center">
                                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-400/90 text-zinc-950 shadow-lg shadow-teal-500/40">
                                        <Play
                                            size={24}
                                            fill="currentColor"
                                            className="ml-0.5"
                                        />
                                    </span>
                                </div>
                                <Button
                                    size="xs"
                                    fullWidth
                                    variant="default"
                                    leftSection={<Users size={14} />}
                                    className="pointer-events-auto relative border-white/10! bg-white/15! text-white! backdrop-blur-md hover:bg-white/25!"
                                    onClick={() =>
                                        handleOpenPasswordModal(movie.movieId)
                                    }
                                >
                                    Create room
                                </Button>
                            </div>
                        </div>

                        <div className="mt-3 px-0.5">
                            <Link
                                href={`/watch/${movie.movieId}`}
                                className="block truncate font-semibold text-zinc-100 transition-colors hover:text-teal-300"
                            >
                                {movie.title}
                            </Link>
                            <Text size="xs" className="text-zinc-500" truncate>
                                {movie.metadata?.genre ?? "Film"}
                            </Text>
                        </div>
                    </div>
                ))}
            </SimpleGrid>

            <Modal
                opened={modalOpened}
                onClose={() => !isSubmitting && setModalOpened(false)}
                title={
                    <ModalHeading
                        icon={<Video size={20} />}
                        title="Create a watch party"
                        subtitle={
                            selectedMovie
                                ? `${selectedMovie.title} · up to 5 people`
                                : "Watch together in sync"
                        }
                    />
                }
            >
                <form onSubmit={handleCreateRoom}>
                    <Stack gap="md" mt="xs">
                        {createRoomError && (
                            <Alert color="red" title="Room was not created">
                                <Stack gap="sm">
                                    <Text size="sm">
                                        {createRoomError.message}
                                    </Text>
                                    {createRoomError.existingRoomCode && (
                                        <Group gap="xs">
                                            {/* Owners re-enter without a password; participants would need theirs. */}
                                            {createRoomError.existingRoomIsOwned && (
                                                <Button
                                                    type="button"
                                                    size="xs"
                                                    variant="light"
                                                    onClick={() => {
                                                        setModalOpened(false);
                                                        router.push(
                                                            `/party/${createRoomError.existingRoomCode}`,
                                                        );
                                                    }}
                                                >
                                                    Open room{" "}
                                                    {
                                                        createRoomError.existingRoomCode
                                                    }
                                                </Button>
                                            )}
                                            <Button
                                                type="button"
                                                size="xs"
                                                color="red"
                                                loading={isSubmitting}
                                                onClick={() =>
                                                    void submitCreateRoom(true)
                                                }
                                            >
                                                {createRoomError.existingRoomIsOwned
                                                    ? `Close ${createRoomError.existingRoomCode} and create`
                                                    : `Leave ${createRoomError.existingRoomCode} and create`}
                                            </Button>
                                        </Group>
                                    )}
                                </Stack>
                            </Alert>
                        )}
                        <RoomPasswordInput
                            label="Room password"
                            description={`Guests need it to join. ${ROOM_PASSWORD_MIN_LENGTH}–${ROOM_PASSWORD_MAX_LENGTH} characters.`}
                            placeholder="Choose a room password"
                            leftSection={<KeyRound size={16} />}
                            required
                            data-autofocus
                            maxLength={ROOM_PASSWORD_MAX_LENGTH}
                            value={roomPassword}
                            onChange={(e) => {
                                setRoomPassword(e.currentTarget.value);
                                setCreateRoomError(null);
                            }}
                            disabled={isSubmitting}
                        />
                        <Button
                            type="submit"
                            fullWidth
                            size="md"
                            radius="md"
                            variant="gradient"
                            gradient={{ from: "teal.4", to: "cyan.5", deg: 90 }}
                            leftSection={<Users size={18} />}
                            className="text-zinc-950! disabled:bg-none! disabled:bg-white/5! disabled:text-zinc-500!"
                            disabled={!isPasswordValid}
                            loading={isSubmitting}
                        >
                            Create Room
                        </Button>
                    </Stack>
                </form>
            </Modal>
        </>
    );
}
