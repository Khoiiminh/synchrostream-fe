import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export interface RtcTokenResponse {
  livekitUrl: string;
  token: string;
}

export interface CreateRoomArgs {
  roomCode: string;
  passwordPlain: string;
  movieId: string;
  maxParticipants?: number;
}

export interface CreateRoomResponse {
  roomId: string;
  roomCode: string;
  maxParticipants?: number;
}

export const watchPartyApi = createApi({
  reducerPath: 'watchPartyApi',
  baseQuery: fetchBaseQuery({
    baseUrl: '/v1/watch-party',
    prepareHeaders: (headers) => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
      if (token) {
        headers.set('authorization', `Bearer ${token}`);
      }
      return headers;
    }
  }),
  endpoints: (builder) => ({
    // GET watch-party/rtc-token?roomCode=XXXXXX
    getLiveKitRtcToken: builder.query<RtcTokenResponse, { roomCode: string }>({
      query: (params) => ({
        url: '/rtc-token',
        method: 'GET',
        params,
      }),
    }),

    createRoom: builder.mutation<CreateRoomResponse, CreateRoomArgs>({
      query: (body) => ({
        url: '/rooms',
        method: 'POST',
        body,
      })
    })
  }),
});

export const { useGetLiveKitRtcTokenQuery, useCreateRoomMutation } = watchPartyApi;