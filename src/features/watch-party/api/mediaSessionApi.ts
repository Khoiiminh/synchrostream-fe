import { createApi } from "@reduxjs/toolkit/query/react";
import { createAuthenticatedBaseQuery } from "@/shared/api/authenticatedBaseQuery";

export interface LiveKitMediaSessionConnectionResponse {
    mediaSessionId: string;
    participantId: string;
    serverUrl: string;
    participantToken: string;
}

export interface LiveKitMediaSessionApiResponse {
    data: LiveKitMediaSessionConnectionResponse;
    success: boolean;
    timestamp: string;
}

export interface CreateLiveKitMediaSessionResponse {
    id: string;
    roomId: string;
    status: string;
    assignedSfuNodeId: string | null;
    createdAt: string;
    startedAt: string | null;
    endedAt: string | null;
}

export interface CreateLiveKitMediaSessionApiResponse {
    data: CreateLiveKitMediaSessionResponse;
    success: boolean;
    timestamp: string;
}

export const mediaSessionApi = createApi({
    reducerPath: "mediaSessionApi",

    baseQuery: createAuthenticatedBaseQuery("/v1"),

    endpoints: (builder) => ({
        getLiveKitMediaSessionConnection: builder.mutation<
            LiveKitMediaSessionApiResponse,
            string
        >({
            query: (mediaSessionId) => ({
                url: `/livekit/media-sessions/${mediaSessionId}/connect`,
                method: "POST",
            }),
        }),

        creatLiveKitMediaSession: builder.mutation<
            CreateLiveKitMediaSessionApiResponse,
            string
        >({
            query: (roomId) => ({
                url: "/livekit/media-sessions/create",
                method: "POST",
                body: {
                    roomId,
                },
            }),
        }),
    }),
});

export const {
    useGetLiveKitMediaSessionConnectionMutation,
    useCreatLiveKitMediaSessionMutation,
} = mediaSessionApi;
