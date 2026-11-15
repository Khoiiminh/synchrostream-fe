'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useGetMeQuery } from '@/store/services/authApi';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  setProfileData,
  clearCredentials,
  setAuthHydrated,
  setAuthUnavailable,
  setCredentials,
} from '@/store/slices/authSlice';

function isUnauthorizedError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return false;
  }

  const { status } = error as { status?: unknown };
  return status === 401 || status === 403;
}

export function SessionInterceptor() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isAuthHydrated = useAppSelector((state) => state.auth.isAuthHydrated);

  const token = useAppSelector((state) => state.auth.token);

  /*
   * Phase 1:
   * Restore the browser session into Redux.
   * Hydration means:
   *  "We finished checking localStorage."
   *
   * It does NOT mean that /me succeeded.
   */
  useEffect(() => {
    const storedToken = localStorage.getItem('access_token');

    console.log('[SessionInterceptor] browser session check', {
      hasToken: !!storedToken,
    });

    if (storedToken) {
      dispatch(
        setCredentials({
          token: storedToken,
        }),
      );
    }

    // Browser authentication state has now been restored.
    // This allows RTK Query to run /me if a token exists.
    dispatch(setAuthHydrated());
  }, [dispatch]);

  /*
   * Phase 2:
   * Redux now tells us whether there is a token.
   *
   * The query is skipped until the browser session has been
   * restored.
   */
  const { data: response, error } = useGetMeQuery(undefined, {
    skip: !isAuthHydrated || !token,
  });

  /*
   * Phase 3:
   * Server confirmed the JWT.
   */
  const currentUserId = useAppSelector((state) => state.auth.userId); // Add this selector at the top of your component

  useEffect(() => {
    if (!response?.success) return;

    // Guard: Only dispatch if the profile data is different from what's already in Redux
    if (currentUserId === response.data.id) return;

    console.log(
      '[SessionInterceptor] /me success',
      response.data,
    );

    dispatch(
      setProfileData({
        userId: response.data.id,
        username: response.data.username,
      }),
    );

  }, [response, dispatch, currentUserId]);

  /*
   * Phase 4:
   * Only an explicit authorization response invalidates the local session.
   * A startup network failure (for example, the backend or proxy still
   * starting) must not discard a valid token.
   */
  useEffect(() => {
    if (!error) return;

    if (!isUnauthorizedError(error)) {
      console.warn(
        '[SessionInterceptor] /me is temporarily unavailable; retaining the local session.',
        error,
      );
      dispatch(setAuthUnavailable());
      return;
    }

    console.info('[SessionInterceptor] /me rejected the saved session. Clearing it.');
    localStorage.removeItem('access_token');

    dispatch(clearCredentials());

    if (pathname !== '/') {
      const query = searchParams.toString();
      const destination = `${pathname}${query ? `?${query}` : ''}`;
      router.replace(
        `/?next=${encodeURIComponent(destination)}&reason=session-expired`,
      );
    }
  }, [error, dispatch, pathname, router, searchParams]);

  return null;
}
