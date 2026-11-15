import {
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
  fetchBaseQuery,
} from '@reduxjs/toolkit/query';
import { clearCredentials } from '@/store/slices/authSlice';

export function createAuthenticatedBaseQuery(
  baseUrl: string,
): BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> {
  const baseQuery = fetchBaseQuery({
    baseUrl,
    prepareHeaders: (headers) => {
      const token = typeof window === 'undefined'
        ? null
        : localStorage.getItem('access_token');

      if (token) {
        headers.set('authorization', `Bearer ${token}`);
      }

      return headers;
    },
  });

  return async (args, api, extraOptions) => {
    const result = await baseQuery(args, api, extraOptions);
    const status = result.error?.status;

    if (status === 401 || status === 403) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('access_token');
      }
      api.dispatch(clearCredentials());
    }

    return result;
  };
}
