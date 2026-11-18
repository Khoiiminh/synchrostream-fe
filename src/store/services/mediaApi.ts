import { createApi } from "@reduxjs/toolkit/query/react";
import { createAuthenticatedBaseQuery } from "./authenticatedBaseQuery";

export interface MovieMetadata {
    genre?: string;
    posterUrl?: string;
    description?: string;
}

export interface CatalogItem {
    movieId: string;
    title: string;
    status: "AVAILABLE";
    isCmafReady: boolean;
    metadata: MovieMetadata;
    createdAt: number;
}

export interface StreamResolution {
    movieId: string;
    title: string;
    isCmafReady: boolean;
    metadata: MovieMetadata;
    streaming: {
        hlsUrl: string;
        dashUrl: string | null;
    };
}

export const mediaApi = createApi({
    reducerPath: "mediaApi",
    baseQuery: createAuthenticatedBaseQuery("/v1/media"),
    endpoints: (builder) => ({
        getMediaCatalog: builder.query<CatalogItem[], void>({
            query: () => "/catalog",
            // Safely unpack NestJS Interceptor wrapping structure
            transformResponse: (response: {
                success: boolean;
                data: CatalogItem[];
            }) => {
                return response.success ? response.data : [];
            },
        }),

        getSoloStream: builder.query<StreamResolution, string>({
            query: (movieId) => `/stream/${movieId}`,
            //Also unpack the solo stream detail response structure
            transformResponse: (response: {
                success: boolean;
                data: StreamResolution;
            }) => {
                return response.data;
            },
        }),
    }),
});

export const { useGetMediaCatalogQuery, useGetSoloStreamQuery } = mediaApi;
