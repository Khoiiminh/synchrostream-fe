'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSelector, useStore } from 'react-redux';
import { Container, Button, Group, Text, Loader, Center, Paper, Slider } from '@mantine/core';
import { useGetSoloStreamQuery } from '@/store/services/mediaApi';
import { SyncEngine } from '@/core/services/SyncEngine';
import { resetPlayback, updatePlaybackSnapshot } from '@/store/slices/playbackSlice';
import { RootState } from '@/store';
import NavbarWrapper from '../commons/NavbarWrapper';
import { Play, Pause, Volume2, VolumeX, Minimize, Maximize } from 'lucide-react';

// Helper Utility: Convert seconds directly into HH:MM:SS format strings
const formatTime = (timeInSeconds: number): string => {
  if (isNaN(timeInSeconds) || timeInSeconds < 0) return '00:00:00';
  const hours = Math.floor(timeInSeconds / 3600);
  const minutes = Math.floor((timeInSeconds % 3600) / 60);
  const seconds = Math.floor(timeInSeconds % 60);

  const pad = (num: number) => String(num).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};

export default function WatchAloneClientLeaf({ mediaId }: { mediaId: string }) {
  const router = useRouter();
  const store = useStore();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Ref hooked to the bounding wrapper so custom UI stays visible in full-screen mode
  const playerContainerRef = useRef<HTMLDivElement | null>(null);

  const [volume, setVolume] = useState(1); // Default to max (1.0)
  const [isMuted, setIsMuted] = useState(false);
  const [prevVolume, setPrevVolume] = useState(1);

  const [isFullscreen, setIsFullscreen] = useState(false);

  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Instantiating the stable engine state actor local to this leaf node instance
  const [engine] = useState(() => new SyncEngine(store));

  const { data: streamData, isLoading, error } = useGetSoloStreamQuery(mediaId, {
    skip: !mediaId,
  });

  // Access the slice using the proper action state namespace
  const playbackState = useSelector((state: RootState) => state.playback);
  const isPlaying = playbackState?.isPlaying ?? false;
  const currentTime = playbackState?.currentTime ?? 0;

  // Triggers timer resets whenever mouse moves inside player bounds
  const handleMouseMove = () => {
    setShowControls(true);

    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }

    // Auto-hide after 2.5 seconds of absolute mouse stillness
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 2500);
  }

  // Instantly hides bars when cursor exits bounding frame boundaries
  const handleMouseLeave = () => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (isPlaying) {
      setShowControls(false);
    }
  };

  // Clean up timeouts on component unmount
  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, []);

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

  // Sync state tracking if the user exits fullscreen using native keys (like ESC)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Volume Change Mutator Function
  const handleVolumeChange = (value: number) => {
    setVolume(value);
    if (videoRef.current) {
      videoRef.current.volume = value;
    }
    if (value > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  // Speaker Action Toggle Function
  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      handleVolumeChange(prevVolume > 0 ? prevVolume : 1);
    } else {
      setPrevVolume(volume);
      setIsMuted(true);
      if (videoRef.current) videoRef.current.volume = 0;
    }
  };

  // Fullscreen Handler API integration
  const toggleFullscreen = async () => {
    if (!playerContainerRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await playerContainerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error('Failed to shift display bounds context configuration:', err);
    }
  };

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
    <NavbarWrapper>
      {/* 'xl' aligns nicely with the navbar constraints */}
      <Container size="xl" py="xl" className="w-full flex-1 flex flex-col justify-center">
        <Button onClick={() => router.push('/catalog')} variant="subtle" color="gray" mb="md" className="self-start">
          ← Back to Catalog
        </Button>

        {/* NATIVE CONTAINER WRAPPER: Handles true fullscreen element binding */}
        <div 
          ref={playerContainerRef} 
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className={`w-full flex items-center justify-center bg-black transition-none ${
            showControls ? 'cursor-default' : 'cursor-none'
          }`}
          style={isFullscreen ? {
            width: '100vw',
            height: '100vh',
            maxHeight: '100vh'
          } : { 
            aspectRatio: '16/9',
            maxHeight: 'calc(100vh - 180px)'
          }}
        >
          {/* Inner Card Wrapper */}
          <Paper 
            radius={isFullscreen ? 'none' : 'md'} 
            className="bg-black relative w-full shadow-2xl overflow-hidden"
            style={isFullscreen ? {
              width: '100%',
              height: '100%',
              maxHeight: '100vh'
            } : { 
              aspectRatio: '16/9',
              maxHeight: 'calc(100vh - 180px)'
            }}
          >
            <video 
              ref={videoRef} 
              className="w-full h-full object-contain absolute inset-0" 
              controls={false} 
              playsInline 
            />
            
            {/* Transparent overlay controls menu structure */}
            <div 
              className={`absolute bottom-0 left-0 right-0 w-full p-4 bg-linear-to-t from-black/90 via-black/40 to-transparent transition-opacity duration-300 z-30 ${
                showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
              }`}
            >
              <Group justify="space-between" align="center" className="w-full">
                
                {/* LEFT CONTROLS CONTAINER */}
                <Group gap="md">
                  {isPlaying ? (
                    <button 
                      onClick={() => engine.pause()} 
                      className="text-white hover:text-zinc-300 transition-colors focus:outline-hidden cursor-pointer flex items-center"
                      title="Pause"
                    >
                      <Pause size={20} fill="currentColor" />
                    </button>
                  ) : (
                    <button 
                      onClick={() => engine.play()} 
                      className="text-blue-400 hover:text-blue-300 transition-colors focus:outline-hidden cursor-pointer flex items-center"
                      title="Play"
                    >
                      <Play size={20} fill="currentColor" />
                    </button>
                  )}
                  
                  <Text size="sm" fw={500} className="text-zinc-200 font-mono tracking-wider select-none">
                    {formatTime(currentTime)}
                  </Text>

                  <Group gap="xs" style={{ width: 110 }} className="ml-2">
                    <button 
                      onClick={toggleMute} 
                      className="text-white hover:text-zinc-300 transition-colors focus:outline-hidden cursor-pointer flex items-center"
                      title={isMuted ? "Unmute" : "Mute"}
                    >
                      {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                    </button>
                    
                    <Slider
                      size="xs"
                      color="blue"
                      label={null}
                      min={0}
                      max={1}
                      step={0.05}
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      style={{ flex: 1 }}
                      styles={{ thumb: { transition: 'transform 0.1s ease' } }}
                    />
                  </Group>
                </Group>

                {/* RIGHT CONTROLS CONTAINER */}
                <Group gap="xs">
                  <button
                    onClick={toggleFullscreen}
                    className="text-white hover:text-zinc-300 transition-colors focus:outline-hidden cursor-pointer p-1 z-50 relative flex items-center"
                    title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  >
                    {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                  </button>
                </Group>

              </Group>
            </div>
          </Paper>
        </div>

        <Text size="xl" fw={700} mt="md" className="text-white">
          {streamData.title}
        </Text>
      </Container>
    </NavbarWrapper>
  );
}