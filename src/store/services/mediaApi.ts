import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

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
  baseQuery: fetchBaseQuery({
    baseUrl: "/v1/media",
    prepareHeaders: (headers) => {
      const token =
        typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      }
      return headers;
    },
  }),
  endpoints: (builder) => ({
    getMediaCatalog: builder.query<CatalogItem[], void>({
      query: () => "/catalog",
      // Safely unpack NestJS Interceptor wrapping structure
      transformResponse: (response: { success: boolean; data: CatalogItem[] }) => {
        return response.success ? response.data : [];
      },
    }),

    getSoloStream: builder.query<StreamResolution, string>({
      query: (movieId) => `/stream/${movieId}`,
      //Also unpack the solo stream detail response structure
      transformResponse: (response: { success: boolean; data: StreamResolution }) => {
        return response.data;
      },
    }),
  }),
});

export const { useGetMediaCatalogQuery, useGetSoloStreamQuery } = mediaApi;