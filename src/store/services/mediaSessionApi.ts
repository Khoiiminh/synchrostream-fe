import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

export interface MediaSessionConnectionResponse {
    mediaSessionId: string;
    participantId: string;
    sfuNodeId: string;
    signalingEndpoint: string;
    signalingToken: string;
}

export interface MediaSessionConnectionApiResponse {
    data: MediaSessionConnectionResponse;
    success: boolean;
    timestamp: string;
}

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
    reducerPath: 'mediaSessionApi',

    baseQuery: fetchBaseQuery({
        baseUrl: '/v1',
        prepareHeaders: (headers) => {
            const token =
                typeof window !== 'undefined'
                    ? localStorage.getItem('access_token')
                    : null;

            if (token) {
                headers.set(
                    'authorization',
                    `Bearer ${token}`,
                );
            }

            return headers;
        },
    }),

    endpoints: (builder) => ({
        getMediaSessionConnection: builder.mutation<
            MediaSessionConnectionApiResponse,
            string
        >({
            query: (mediaSessionId) => ({
                url: `/media-sessions/${mediaSessionId}/connect`,
                method: 'POST',
            }),
        }),

        getLiveKitMediaSessionConnection: builder.mutation<
            LiveKitMediaSessionApiResponse,
            string
        >({
            query: (mediaSessionId) => ({
                url: `/livekit/media-sessions/${mediaSessionId}/connect`,
                method: 'POST',
            }),
        }),

        creatLiveKitMediaSession: builder.mutation<
            CreateLiveKitMediaSessionApiResponse,
            string
        >({
            query: (roomId) => ({
                url: '/livekit/media-sessions/create',
                method: 'POST',
                body: {
                    roomId,
                },
            }),
        }),
    }),
});

export const {
    useGetMediaSessionConnectionMutation,
    useGetLiveKitMediaSessionConnectionMutation,
    useCreatLiveKitMediaSessionMutation,
} = mediaSessionApi;