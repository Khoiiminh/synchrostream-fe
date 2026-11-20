import { createApi } from "@reduxjs/toolkit/query/react";
import { createAuthenticatedBaseQuery } from "@/shared/api/authenticatedBaseQuery";

export interface RtcTokenResponse {
    livekitUrl: string;
    token: string;
}

export interface CreateRoomArgs {
    /** Omit to let the server generate a unique code (recommended). */
    roomCode?: string;
    passwordPlain: string;
    movieId: string;
    maxParticipants?: number;
    /** Leave (closing it if owned) the room the caller is still in, then create. Send only after the user confirms. */
    leaveCurrent?: boolean;
}

export interface CreateRoomResponse {
    roomId: string;
    roomCode: string;
    maxParticipants?: number;
    /** PROVISIONING when the room is committed but not yet ready; joining retries until ACTIVE. */
    lifecycleStatus?: "PROVISIONING" | "ACTIVE";
}

export const watchPartyApi = createApi({
    reducerPath: "watchPartyApi",

    baseQuery: createAuthenticatedBaseQuery("/v1/watch-party"),

    endpoints: (builder) => ({
        /** -------------------------------------------
         *              IGNORE THIS ONE
         *  -------------------------------------------
         */
        // GET watch-party/rtc-token?roomCode=XXXXXX
        getLiveKitRtcToken: builder.query<
            RtcTokenResponse,
            { roomCode: string }
        >({
            query: (params) => ({
                url: "/rtc-token",
                method: "GET",
                params,
            }),
        }),
        // --------------------------------------------

        createRoom: builder.mutation<CreateRoomResponse, CreateRoomArgs>({
            query: (body) => ({
                url: "/rooms",
                method: "POST",
                body,
            }),
            // The backend TransformationInterceptor wraps results as { success, message, data }.
            transformResponse: (response: { data: CreateRoomResponse }) =>
                response.data,
        }),
    }),
});

export const { useGetLiveKitRtcTokenQuery, useCreateRoomMutation } =
    watchPartyApi;
