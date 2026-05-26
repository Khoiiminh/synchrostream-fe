import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export interface NestResponse<T> {
    success: boolean;
    message: string;
    data: T;
    timestamp: string;
}

export interface RegisterResponseData {
    userId: string;
}

export interface LoginResponseData {
    access_token: string;
}

export interface RegisterRequest {
    username: string;
    email: string;
    password: string;
}

export interface LoginRequest {
    email: string;
    password: string;
}

export const authApi = createApi({
    reducerPath: 'authApi',
    baseQuery: fetchBaseQuery({
        baseUrl: 'v1/auth',
    }),
    endpoints: (builder) => ({
        registerUser: builder.mutation<NestResponse<RegisterResponseData>, RegisterRequest>({
            query: (credentials) => ({
                url: '/register',
                method: 'POST',
                body: credentials,
            }),
        }),
        loginUser: builder.mutation<NestResponse<LoginResponseData>, LoginRequest>({
            query: (credentials) => ({
                url: '/login',
                method: 'POST',
                body: credentials,
            }),
        }),
    }),
});

export const { useRegisterUserMutation, useLoginUserMutation } = authApi;