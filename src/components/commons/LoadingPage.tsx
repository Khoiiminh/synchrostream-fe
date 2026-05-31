'use client';

import { Title, Stack, Group, Loader } from '@mantine/core';
import { ReactNode } from 'react';

interface LoadingPageProps {
  /** The primary bold headline text. Defaults to 'SynchroStream' */
  title?: string;
  /** The descriptive sub-text or element shown next to the spinner. Defaults to 'Loading secure data...' */
  message?: string | ReactNode;
  /** * If true, covers the entire viewport fixed on top of everything.
   * If false, behaves as a standard block that fits inside parent layouts.
   * Defaults to true.
   */
  fullscreen?: boolean;
}

export function LoadingPage({ 
  title = 'SynchroStream', 
  message = 'Loading secure data...', 
  fullscreen = true 
}: LoadingPageProps) {
  
  const containerClasses = fullscreen
    ? 'fixed inset-0 z-50 bg-[#000000] flex flex-col items-center justify-center text-center px-4'
    : 'w-full min-h-[250px] bg-transparent flex flex-col items-center justify-center text-center p-6';

  return (
    <div className={containerClasses}>
      <Stack align="center" gap="md">
        {title && (
          <Title order={2} className="text-[#6366F1] font-black tracking-widest text-2xl sm:text-3xl uppercase animate-pulse">
            {title}
          </Title>
        )}
        <Group gap="xs" className="text-zinc-400 text-sm justify-center">
          <Loader size="sm" color="indigo" variant="dots" />
          {typeof message === 'string' ? <span>{message}</span> : message}
        </Group>
      </Stack>
    </div>
  );
}