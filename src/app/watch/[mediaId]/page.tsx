import React from "react";
import { WatchClientLeaf } from "@/features/watch";
import { RequireAuthenticatedSession } from "@/features/auth";

interface WatchPageProps {
    params: Promise<{
        mediaId: string;
    }>;
}

// Strictly a Server Component. It handles the URL parameter matching natively.
export default async function WatchAlonePage({ params }: WatchPageProps) {
    const resolvedParams = await params;

    return (
        <RequireAuthenticatedSession>
            <WatchClientLeaf
                mediaId={resolvedParams.mediaId}
                isPartyMode={false}
            />
        </RequireAuthenticatedSession>
    );
}
