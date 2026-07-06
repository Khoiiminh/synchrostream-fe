'use client';

import Link from 'next/link';
import { Card, Image, Text, SimpleGrid, Badge, Button, Group, Center, Modal, Stack, TextInput } from '@mantine/core';
import { useGetMediaCatalogQuery } from '../../store/services/mediaApi';
import { useRouter } from 'next/navigation';
import { LoadingPage } from '../commons/LoadingPage';
import { useState } from 'react';
import { Video } from 'lucide-react';
import { useCreateRoomMutation } from '@/store/services/watchPartyApi';

function generatePartyCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export default function CatalogGridClientLeaf() {
  const { data: catalog, isLoading, error } = useGetMediaCatalogQuery();
  const router = useRouter();
  const [createRoom] = useCreateRoomMutation();

  const [modalOpened, setModalOpened] = useState(false);
  const [selectedMovieId, setSelectedMovieId] = useState<string | null>(null);
  const [roomPassword, setRoomPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    setModalOpened(true);
  };

  const handleCreateRoom = async (e: React.SubmitEvent) => {
    e.preventDefault();
    if (!selectedMovieId) return;

    setIsSubmitting(true);
    const generatedCode = generatePartyCode();
    const cleanPassword = roomPassword.trim();

    try {
      await createRoom({
        roomCode: generatedCode,
        passwordPlain: cleanPassword,
        movieId: selectedMovieId,
        maxParticipants: 5,
      }).unwrap();

      setModalOpened(false);
      router.push(`/party/${generatedCode}?mediaId=${selectedMovieId}&pwd=${encodeURIComponent(cleanPassword)}`);
    } catch (err: unknown) {
      // Accessing the RTK query error response body payload
      const queryError = err as { data?: { message?: string } };
      if (queryError.data?.message) {
        console.error("NestJS Validation Failure Rules broken:", queryError.data.message);
      } else {
        console.error("RTK Query Mutation failed:", err);
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
                Party Stream
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
            <TextInput
              label="Room Access Key / Password"
              placeholder="Leave completely blank for public open entry..."
              value={roomPassword}
              onChange={(e) => setRoomPassword(e.currentTarget.value)}
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