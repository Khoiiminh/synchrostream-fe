import React from 'react';
import WatchClientLeaf from '@/components/watch/WatchClientLeaf';

interface WatchPageProps {
  params: Promise<{
    mediaId: string;
  }>;
}

// Strictly a Server Component. It handles the URL parameter matching natively.
export default async function WatchAlonePage({ params }: WatchPageProps) {
  const resolvedParams = await params;

  return (
    <WatchClientLeaf mediaId={resolvedParams.mediaId} isPartyMode={false}/>
  );
}