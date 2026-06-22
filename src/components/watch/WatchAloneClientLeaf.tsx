'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSelector, useStore } from 'react-redux';
import { Container, Button, Group, Text, Loader, Center, Paper } from '@mantine/core';
import { useGetSoloStreamQuery } from '@/store/services/mediaApi';
import { SyncEngine } from '@/core/services/SyncEngine';
import { resetPlayback, updatePlaybackSnapshot } from '@/store/slices/playbackSlice';
import { RootState } from '@/store';

export default function WatchAloneClientLeaf({ mediaId }: { mediaId: string }) {
  const router = useRouter();
  const store = useStore();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  
  // Instantiating the stable engine state actor local to this leaf node instance
  const [engine] = useState(() => new SyncEngine(store));

  const { data: streamData, isLoading, error } = useGetSoloStreamQuery(mediaId, {
    skip: !mediaId,
  });

  // Access the slice using the proper action state namespace
  const playbackState = useSelector((state: RootState) => state.playback);
  const isPlaying = playbackState?.isPlaying ?? false;
  const currentTime = playbackState?.currentTime ?? 0;

  useEffect(() => {
    if (videoRef.current && streamData?.streaming?.hlsUrl) {
      // First update the active target media ID in the store mirror
      store.dispatch(
        updatePlaybackSnapshot({
          activeMediaId: mediaId
        })
      );

      // Pass only the strict properties expected by the signature
      engine.attachElement({
        element: videoRef.current,
        streamUrl: streamData.streaming.hlsUrl
      });
    }

    return () => {
      engine.dispose();
      store.dispatch(resetPlayback());
    };
  }, [engine, streamData, mediaId, store]);

  if (isLoading) {
    return (
      <Center style={{ height: '100vh' }}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (error || !streamData) {
    return (
      <Center style={{ height: '100vh' }}>
        <Text color="red">Failed to resolve stream metadata.</Text>
      </Center>
    );
  }

  return (
    <Container size="lg" py="xl">
      <Button onClick={() => router.push('/catalog')} variant="subtle" color="gray" mb="md">
        ← Back to Catalog
      </Button>

      <Paper radius="md" style={{ overflow: 'hidden' }} className="bg-black relative group aspect-video shadow-2xl">
        <video 
          ref={videoRef} 
          className="w-full h-full object-contain" 
          controls={false} 
          playsInline 
        />
        
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-linear-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <Group justify='space-between'>
            <Group>
              {isPlaying ? (
                <Button size="xs" color="gray" onClick={() => engine.pause()}>Pause</Button>
              ) : (
                <Button size="xs" color="blue" onClick={() => engine.play()}>Play</Button>
              )}
              <Text size="xs" className="text-zinc-300">
                {currentTime.toFixed(1)}s
              </Text>
            </Group>
          </Group>
        </div>
      </Paper>

      <Text size="xl" fw={700} mt="md" className="text-white">
        {streamData.title}
      </Text>
    </Container>
  );
}