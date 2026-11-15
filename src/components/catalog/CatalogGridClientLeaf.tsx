'use client';

import Link from 'next/link';
import { Alert, Card, Image, Text, SimpleGrid, Badge, Button, Group, Center, Modal, Stack, TextInput } from '@mantine/core';
import { useGetMediaCatalogQuery } from '../../store/services/mediaApi';
import { useRouter } from 'next/navigation';
import { LoadingPage } from '../commons/LoadingPage';
import { useState } from 'react';
import { Video } from 'lucide-react';
import { useCreateRoomMutation } from '@/store/services/watchPartyApi';

export default function CatalogGridClientLeaf() {
  const { data: catalog, isLoading, error } = useGetMediaCatalogQuery();
  const router = useRouter();
  const [createRoom] = useCreateRoomMutation();

  const [modalOpened, setModalOpened] = useState(false);
  const [selectedMovieId, setSelectedMovieId] = useState<string | null>(null);
  const [roomPassword, setRoomPassword] = useState('');
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
      <Center style={{ height: '40vh' }}>
        <LoadingPage />
      </Center>
    );
  }

  if (error || !catalog) {
    return (
      <Center style={{ height: '40vh' }}>
        <Text color="red" size="lg" fw={700}>Failed to load active streaming assets.</Text>
      </Center>
    );
  }

  const handleOpenPasswordModal = (movieId: string) => {
    setSelectedMovieId(movieId);
    setRoomPassword('');
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
    if (!selectedMovieId) return;

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

      setModalOpened(false);
      router.push(`/party/${createdRoom.roomCode}?pwd=${encodeURIComponent(cleanPassword)}`);
    } catch (err: unknown) {
      // RTK Query puts the whole response body in `err.data`. The backend's
      // GlobalExceptionFilter returns { success, message, data, timestamp },
      // so the structured conflict detail is nested at `err.data.data`.
      const queryError = err as {
        status?: number;
        data?: {
          message?: string;
          data?: { code?: string; roomCode?: string; isOwner?: boolean } | null;
        };
      };
      const conflict = queryError.data?.data;
      const existingRoomCode = conflict?.roomCode;

      if (
        queryError.status === 409 &&
        (conflict?.code === 'ACTIVE_OWNER_ROOM' || conflict?.code === 'ACTIVE_MEMBERSHIP_ELSEWHERE') &&
        existingRoomCode
      ) {
        const isOwned = conflict.code === 'ACTIVE_OWNER_ROOM' || conflict.isOwner === true;
        setCreateRoomError({
          message: isOwned
            ? `You are still hosting room ${existingRoomCode}. Open it, or close it for everyone and create this room.`
            : `You are still in room ${existingRoomCode}. Leave it to create this room?`,
          existingRoomCode,
          existingRoomIsOwned: isOwned,
        });
      } else {
        setCreateRoomError({
          message: queryError.data?.message
            ?? 'We could not create this room. Please check your details and try again.',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
    <SimpleGrid cols={{ base: 1, xs: 1, md: 2, lg: 3 }}>
        {catalog.map((movie) => (
          <Card key={movie.movieId} shadow="sm" padding="lg" radius="md" withBorder className="bg-zinc-900 border-zinc-800 flex flex-col justify-between">
            <Card.Section>
              <Image
                src={movie.metadata?.posterUrl || '/spring_poster_pillar_medium.jpg'}
                height={280}
                alt={movie.title}
              />
            </Card.Section>

            <Group justify="space-between" mt="md" mb="xs">
              <Text fw={700} className="text-zinc-100">{movie.title}</Text>
              <Group gap="xs">
                {movie.metadata?.genre && (
                  <Badge color="gray" variant="filled" className="bg-zinc-800 text-zinc-300">
                    {movie.metadata.genre}
                  </Badge>
                )}
                {movie.isCmafReady && (
                  <Badge color="cyan" variant="light">Ultra-Low Latency</Badge>
                )}
              </Group>
            </Group>

            <Text size="sm" color="dimmed" lineClamp={3} mb="xl">
              {movie.metadata?.description || 'No database profile notes attached to asset.'}
            </Text>

            <Group gap="xs" className="mt-auto">
              <Link href={`/watch/${movie.movieId}`} passHref style={{ flex: 1 }}>
                <Button variant="light" color="blue" fullWidth radius="md">
                  Watch 
                </Button>
              </Link>
              <Button 
                variant="outline" 
                color="teal" 
                radius="md" 
                style={{ flex: 1 }}
                onClick={() => handleOpenPasswordModal(movie.movieId)}
              >
                Create Room
              </Button>
            </Group>
          </Card>
        ))}
      </SimpleGrid>

      <Modal
        opened={modalOpened}
        onClose={() => !isSubmitting && setModalOpened(false)}
        title={
          <Group gap="xs">
            <Video size={18} className="text-teal-400" />
            <Text fw={700} size="sm" className="text-zinc-200 uppercase tracking-wide">
              Configure Watch Party Room
            </Text>
          </Group>
        }
        centered
        radius="md"
      >
        <form onSubmit={handleCreateRoom}>
          <Stack gap="md" mt="xs">
            {createRoomError && (
              <Alert color="red" title="Room was not created">
                <Stack gap="sm">
                  <Text size="sm">{createRoomError.message}</Text>
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
                            router.push(`/party/${createRoomError.existingRoomCode}`);
                          }}
                        >
                          Open room {createRoomError.existingRoomCode}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="xs"
                        color="red"
                        loading={isSubmitting}
                        onClick={() => void submitCreateRoom(true)}
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
            <TextInput
              label="Room Access Key / Password"
              placeholder="Leave completely blank for public open entry..."
              value={roomPassword}
              onChange={(e) => {
                setRoomPassword(e.currentTarget.value);
                setCreateRoomError(null);
              }}
              disabled={isSubmitting}
            />
            <Button type="submit" color="teal" fullWidth loading={isSubmitting}>
              Create
            </Button>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
