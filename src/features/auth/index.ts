"use client";

/*
 * Public API of the auth slice. Light: the store and the root layout load it
 * on every page, so it holds the API, the session gate and the session
 * interceptor only. The sign-in forms and the password-reset page are in
 * ./routes.
 *
 * "use client": the root layout (a server component) imports
 * SessionInterceptor from here, and this file also re-exports the RTK Query
 * API, whose module calls React context APIs. As a client boundary, server
 * code receives references instead of evaluating it.
 */
export {
    authApi,
    useGetMeQuery,
    useLazyGetMeQuery,
    useLogoutMutation,
} from "./api/authApi";
export { RequireAuthenticatedSession } from "./ui/RequireAuthenticatedSession";
export { SessionInterceptor } from "./ui/SessionInterceptor";
