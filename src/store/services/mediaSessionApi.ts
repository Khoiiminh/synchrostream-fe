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
    }),
});

export const {
    useGetMediaSessionConnectionMutation,
} = mediaSessionApi;