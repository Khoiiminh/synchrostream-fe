import React from 'react';
import WatchAloneClientLeaf from '@/components/watch/WatchAloneClientLeaf';

interface WatchPageProps {
  params: Promise<{
    mediaId: string;
  }>;
}

// Strictly a Server Component. It handles the URL parameter matching natively.
export default async function WatchAlonePage({ params }: WatchPageProps) {
  const resolvedParams = await params;

  return (
    <WatchAloneClientLeaf mediaId={resolvedParams.mediaId} />
  );
}