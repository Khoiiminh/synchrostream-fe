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

export interface UserProfileResponseData {
  id: string;
  username: string;
  email: string;
  role: string;
}

// initializes the API configuration
export const authApi = createApi({

    // The unique name for where this data lives in the Redux Store
    // Where to store the cached data and request status (loading, error, etc.) within the global state tree
    reducerPath: 'authApi',

    // The root URL configuration. 
    // All endpoints start with '/v1/auth' - Instead of typing `http://api.com/v1/auth` for 
    // every single request, we define the base here
    baseQuery: fetchBaseQuery({
        baseUrl: '/v1/auth',
        prepareHeaders: (headers) => {
            // 1. Retrieve the token from wherever you saved it on login
            // (Usually localStorage, sessionStorage, or your global Redux auth state)
            const token = localStorage.getItem('access_token'); 

            // 2. If the token exists, cleanly inject it as a Bearer authorization token
            if (token) {
                headers.set('authorization', `Bearer ${token}`);
            }

            return headers;
        }
    }),

    // function defines the actual HTTP operations
    // `builder` is an object, used to construct queries (for GET) or mutations (for POST/PUT/DELETE)
    endpoints: (builder) => ({

        // MUTATION is used when data is being changed on the server
        // <Result, Argument> 
        registerUser: builder.mutation<NestResponse<RegisterResponseData>, RegisterRequest>({

            // The specific instructions for this request 
            // It takes the `credentials` (username, email, password) and 
            // maps them to a POST request to `v1/auth/register`
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

        getMe: builder.query<NestResponse<UserProfileResponseData>, void>({
            query: () => ({
                url: '/me',
                method: 'GET'
            }),
        }),

        logout: builder.mutation<{ message: string }, void>({
            query: () => ({
                url: 'logout',
                method: 'POST',
            }),
        }),

        requestPasswordReset: builder.mutation<{ success: boolean, message: string }, { email: string }>({
            query: (body) => ({
                url: '/password-reset/request',
                method: 'POST',
                body,
            }),
        }),

        confirmPasswordReset: builder.mutation<{ success: boolean, message: string }, { token: string, newPassword: string}> ({
            query: (body) => ({
                url: '/password-reset/confirm',
                method: 'POST',
                body
            }),
        }),
    }),
});

// This is auto-generated React hooks.
// RTK Query automatically creates hooks based on the names of your endpoints (e.g., loginUser becomes useLoginUserMutation)
// It returns a tuple: [triggerFunction, { data, error, isLoading }]

// const [login, { isLoading }] = useLoginUserMutation();

// Calling the function:
// const response = await login({ email: '...', password: '...' }).unwrap();
export const { 
    useRegisterUserMutation, 
    useLoginUserMutation, 
    useGetMeQuery, 
    useLazyGetMeQuery, 
    useLogoutMutation,
    useRequestPasswordResetMutation,
    useConfirmPasswordResetMutation, 
} = authApi;