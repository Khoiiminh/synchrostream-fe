import { createApi } from "@reduxjs/toolkit/query/react";
import { createAuthenticatedBaseQuery } from "./authenticatedBaseQuery";

export interface NestResponse<T> {
    success: boolean;
    message: string;
    data: T;
    timestamp: string;
}

export const adminMediaApi = createApi({
    reducerPath: "adminMediaApi",
    baseQuery: createAuthenticatedBaseQuery("/v1/admin/media"),
    endpoints: (builder) => ({
        initiateUpload: builder.mutation<
            NestResponse<{
                movieId: string;
                uploadId: string;
                objectKey: string;
            }>,
            { title: string; genre: string; description: string }
        >({
            query: (body) => ({
                url: "/initiate", // Evaluates via media-ingestion.dto.ts
                method: "POST",
                body,
            }),
        }),
        uploadPart: builder.mutation<NestResponse<{ etag: string }>, FormData>({
            query: (formData) => ({
                url: "/upload-part",
                method: "PATCH",
                body: formData,
            }),
        }),
        completeUpload: builder.mutation<
            NestResponse<{ message: string; objectKey: string }>,
            {
                movieId: string;
                uploadId: string;
                parts: Array<{ PartNumber: number; ETag: string }>;
            }
        >({
            query: (body) => ({
                url: "/complete",
                method: "POST",
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
