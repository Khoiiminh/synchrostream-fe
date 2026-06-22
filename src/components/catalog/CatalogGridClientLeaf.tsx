'use client';

import React from 'react';
import Link from 'next/link';
import { Card, Image, Text, SimpleGrid, Badge, Button, Group, Loader, Center } from '@mantine/core';
import { useGetMediaCatalogQuery } from '../../store/services/mediaApi';

export default function CatalogGridClientLeaf() {
  const { data: catalog, isLoading, error } = useGetMediaCatalogQuery();

  if (isLoading) {
    return (
      <Center style={{ height: '40vh' }}>
        <Loader size="xl" variant="dots" color="blue" />
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

  return (
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
            <Button variant="outline" color="teal" radius="md" style={{ flex: 1 }}>
              Party Stream
            </Button>
          </Group>
        </Card>
      ))}
    </SimpleGrid>
  );
}