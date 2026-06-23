'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSelector, useStore } from 'react-redux';
import { Container, Button, Group, Text, Loader, Center, Paper, Slider, Menu } from '@mantine/core';
import { useGetSoloStreamQuery, mediaApi } from '@/store/services/mediaApi';
import { SyncEngine } from '@/core/services/SyncEngine';
import { resetPlayback, updatePlaybackSnapshot } from '@/store/slices/playbackSlice';
import { RootState } from '@/store';
import NavbarWrapper from '../commons/NavbarWrapper';
import { Play, Pause, Volume2, VolumeX, Minimize, Maximize, Settings } from 'lucide-react';
import Image from 'next/image';

interface QualityLevel {
  index: number;
  height: number;
  bitrate: number;
  name: string;
}

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

  const [duration, setDuration] = useState(0);

  // Bitrate ladder state integration
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState<string>('Auto');
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  
  // Instantiating the stable engine state actor local to this leaf node instance
  const [engine] = useState(() => new SyncEngine(store));

  const cachedCatalogMovie = useSelector((state: RootState) => {
    const catalogResult = mediaApi.endpoints.getMediaCatalog.select()(state);

    return catalogResult.data?.find((movie) => movie.movieId === mediaId);
  })

  const { data: streamData, isLoading, error } = useGetSoloStreamQuery(mediaId, {
    skip: !mediaId,
  });

  // Access the slice using the proper action state namespace
  const playbackState = useSelector((state: RootState) => state.playback);
  const isPlaying = playbackState?.isPlaying ?? false;
  const currentTime = playbackState?.currentTime ?? 0;

  // Determine the best available poster URL (instantly from cached catalog, fallback to current stream payload)
  const activePosterUrl = 
    cachedCatalogMovie?.metadata?.posterUrl || 
    streamData?.metadata?.posterUrl || 
    '/spring_poster_pillar_medium.jpg';

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
    const videoElement = videoRef.current;

    if (videoElement && streamData?.streaming?.hlsUrl) {
      store.dispatch(
        updatePlaybackSnapshot({
          activeMediaId: mediaId
        })
      );

      engine.attachElement({
        element: videoElement,
        streamUrl: streamData.streaming.hlsUrl
      });

      const handleDurationChange = () => {
        setDuration(videoElement.duration || 0);
      };

      // Query HLS manifest levels once initialized inside your SyncEngine actor
      const syncQualityTracks = () => {
        let levels;
        if (typeof engine.getQualityLevels === 'function') {
          levels = engine.getQualityLevels();
          setQualityLevels(levels || []);
        }
        if (typeof engine.getCurrentQualityIndex === 'function') {
          const currentIdx = engine.getCurrentQualityIndex();
          if (currentIdx === -1) {
            setCurrentQuality('Auto');
          } else if (levels && levels[currentIdx]) {
            setCurrentQuality(`${levels[currentIdx].height}p`);
          }
        }
      };

      videoElement.addEventListener('durationchange', handleDurationChange);
      // Fallback query interval or direct layout sync check once element triggers updates
      videoElement.addEventListener('loadedmetadata', syncQualityTracks);

      return () => {
        videoElement.removeEventListener('durationchange', handleDurationChange);
        videoElement.removeEventListener('loadedmetadata', syncQualityTracks);
        engine.dispose();
        store.dispatch(resetPlayback());
      };
    }
  }, [engine, streamData, mediaId, store]);

  // Sync state tracking if the user exits fullscreen using native keys (like ESC)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Seek/Scrubber Bar handler using SyncEngine actor
  const handleSeekChange = (value: number) => {
    engine.seek(value);
  };

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

  // Explicit dynamic track switching mutation
  const handleQualityChange = (levelIndex: number | 'auto') => {
    if (typeof engine.setQualityLevel === 'function') {
      if (levelIndex === 'auto') {
        engine.setQualityLevel(-1); // Standard HLS value for absolute Adaptive Bitrate engine mode
        setCurrentQuality('Auto');
      } else {
        engine.setQualityLevel(levelIndex);
        const selectedLevel = qualityLevels.find(l => l.index === levelIndex);
        if (selectedLevel) {
          setCurrentQuality(`${selectedLevel.height}p`);
        }
      }
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

  if (isLoading && !cachedCatalogMovie) {
    return (
      <Center style={{ height: '100vh' }}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (error && !cachedCatalogMovie) {
    return (
      <Center style={{ height: '100vh' }}>
        <Text color="red">Failed to resolve stream metadata.</Text>
      </Center>
    );
  }

  return (
    <NavbarWrapper>
      {/* 'xl' aligns nicely with the navbar constraints */}
      <div className="w-full min-h-[calc(100vh-60px)] flex-1 flex flex-col justify-center relative overflow-hidden">
        
        {activePosterUrl && (
          <div className="absolute inset-0 w-full h-full pointer-events-none select-none z-0 overflow-hidden">
            <Image 
              src={activePosterUrl} 
              alt="Ambient theatre backdrop" 
              fill
              sizes="100vw"
              priority
              className="object-cover blur-2xl scale-110 opacity-40 select-none pointer-events-none"
            />
            {/* Dark vignette blending out smoothly directly to screen borders */}
            <div className="absolute inset-0 bg-radial from-transparent via-zinc-950/40 to-zinc-950" />
          </div>
        )}

        <div className="w-full max-w-(--size-xl) mx-auto px-4 md:px-6 py-6 flex flex-col justify-center relative z-10">
          
          <Button 
            onClick={() => router.push('/catalog')} 
            variant="subtle" 
            color="gray" 
            mb="md" 
            className="self-start relative z-10"
          >
            &larr; Back to Catalog
          </Button>

        {/* NATIVE CONTAINER WRAPPER */}
        <div 
            ref={playerContainerRef} 
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className={`w-full flex items-center justify-center bg-black transition-none relative overflow-hidden rounded-md border border-zinc-800/50 ${
              showControls ? 'cursor-default' : 'cursor-none'
            }`}
            style={isFullscreen ? {
              width: '100vw',
              height: '100vh',
              maxHeight: '100vh',
              maxWidth: '100vw'
            } : { 
              aspectRatio: '16/9',
              maxHeight: 'calc(100vh - 220px)'
            }}
          >        
          {/* Inner Card Wrapper */}
          <Paper 
            radius="none" 
            className="bg-transparent relative w-full h-full overflow-hidden z-10 flex items-center justify-center"
            style={{ width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%' }}
          >
            <video 
              ref={videoRef} 
              className="w-full h-full object-contain block bg-black" 
              controls={false} 
              playsInline 
            />
            
            {/* Transparent overlay controls menu structure */}
            <div 
              className={`absolute bottom-0 left-0 right-0 w-full p-4 bg-linear-to-t from-black/95 via-black/60 to-transparent transition-opacity duration-300 z-30 ${
                showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
              }`}
            >
              {/* SEEK / SCRUBBER BAR CONTAINER */}
              <div className="w-full px-1 mb-2">
                <Slider
                  size="sm"
                  color="blue"
                  label={(value) => formatTime(value)}
                  min={0}
                  max={duration || 100}
                  value={currentTime}
                  onChange={handleSeekChange}
                  styles={{
                    root: { display: 'flex', alignItems: 'center' },
                    track: { cursor: 'pointer', height: 4 },
                    thumb: { transition: 'transform 0.1s ease', cursor: 'pointer' }
                  }}
                />
              </div>
              
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
                  
                  {/* Premium Split Playback Timestamp Matrix */}
                  <Group gap="xs" className="select-none">
                    <Text size="sm" fw={500} className="text-zinc-200 font-mono tracking-wider">
                      {formatTime(currentTime)}
                    </Text>
                    <Text size="sm" fw={500} className="text-zinc-500 font-mono">/</Text>
                    <Text size="sm" fw={500} className="text-zinc-400 font-mono tracking-wider">
                      {formatTime(duration)}
                    </Text>
                  </Group>

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
                <Group gap="sm">
                  {/* DYNAMIC BITRATE LADDER QUALITY OVERLAY MENU */}
                  <div className="relative">
                    <button 
                      onClick={() => setQualityMenuOpen(!qualityMenuOpen)}
                      className="text-white hover:text-zinc-300 transition-colors focus:outline-hidden cursor-pointer flex items-center gap-1 text-xs font-semibold px-2 py-1 bg-zinc-800/60 rounded-sm border border-zinc-700/40 select-none"
                      title="Stream Quality"
                    >
                      <Settings size={14} />
                      <span>{currentQuality}</span>
                    </button>

                    {qualityMenuOpen && (
                      <>
                        {/* Dim overlay click target backdrop to catch close clicks cleanly */}
                        <div 
                          className="fixed inset-0 z-40 cursor-default" 
                          onClick={() => setQualityMenuOpen(false)} 
                        />
                        
                        <div className="absolute bottom-full right-0 mb-2 w-32 bg-zinc-900 border border-zinc-700 rounded-sm shadow-md p-1 flex flex-col z-50 animate-fade-in">
                          <div className="text-zinc-500 text-[10px] font-bold tracking-wider px-2 py-1 select-none">
                            RESOLUTIONS
                          </div>
                          
                          <button
                            onClick={() => {
                              handleQualityChange('auto');
                              setQualityMenuOpen(false);
                            }}
                            className={`w-full text-left text-xs px-2 py-1.5 rounded-xs transition-colors hover:bg-zinc-800 cursor-pointer ${
                              currentQuality === 'Auto' ? 'text-blue-400 font-bold' : 'text-zinc-300'
                            }`}
                          >
                            Auto (ABR)
                          </button>
                          
                          {qualityLevels.map((level) => {
                            const levelName = `${level.height}p`;
                            return (
                              <button
                                key={level.index}
                                onClick={() => {
                                  handleQualityChange(level.index);
                                  setQualityMenuOpen(false);
                                }}
                                className={`w-full text-left text-xs px-2 py-1.5 rounded-xs transition-colors hover:bg-zinc-800 cursor-pointer ${
                                  currentQuality === levelName ? 'text-blue-400 font-bold' : 'text-zinc-300'
                                }`}
                              >
                                {levelName}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                  
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

          <div className="w-full pl-16 md:pl-22">
            <Text size="xl" fw={700} mt="md" className="text-white">
              {streamData?.title}
            </Text>
          </div>
        </div>
      </div>
    </NavbarWrapper>
  );
}