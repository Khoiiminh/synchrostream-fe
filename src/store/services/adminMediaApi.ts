import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export interface NestResponse<T> {
    success: boolean;
    message: string;
    data: T;
    timestamp: string;
}

export const adminMediaApi = createApi({
    reducerPath: 'adminMediaApi',
    baseQuery: fetchBaseQuery({
        baseUrl: '/v1/admin/media', // Aligned to admin.controller.ts endpoints
        prepareHeaders: (headers) => {
            const token = localStorage.getItem('access_token');
            if (token) {
                headers.set('authorization', `Bearer ${token}`);
            }
            return headers;
        }
    }),
    endpoints: (builder) => ({
        initiateUpload: builder.mutation<NestResponse<{ movieId: string; uploadId: string; objectKey: string }>, { title: string; genre: string; description: string }>({
            query: (body) => ({
                url: '/initiate', // Evaluates via media-ingestion.dto.ts
                method: 'POST',
                body,
            }),
        }),
        uploadPart: builder.mutation<NestResponse<{ etag: string }>, FormData>({
            query: (formData) => ({
                url: '/upload-part',
                method: 'PATCH',
                body: formData,
            }),
        }),
        completeUpload: builder.mutation<NestResponse<{ message: string; objectKey: string }>, { movieId: string; uploadId: string; parts: Array<{ PartNumber: number; ETag: string }> }>({
            query: (body) => ({
                url: '/complete',
                method: 'POST',
                body,
            }),
        }),
    }),
});

export const {
    useInitiateUploadMutation,
    useUploadPartMutation,
    useCompleteUploadMutation,
} = adminMediaApi;