'use client';

import { useEffect } from 'react';
import { useGetMeQuery } from '@/store/services/authApi';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  setProfileData,
  clearCredentials,
  setAuthHydrated,
  setCredentials,
} from '@/store/slices/authSlice';

export function SessionInterceptor() {
  const dispatch = useAppDispatch();

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
  useEffect(() => {
    if (!response?.success) return;

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

    dispatch(setAuthHydrated());
  }, [response, dispatch]);

  /*
   * Phase 4:
   * JWT/session is invalid.
   */
  useEffect(() => {
    if (!error) return;

    console.error(
      '[SessionInterceptor] /me failed',
      error,
    );

    localStorage.removeItem('access_token');

    dispatch(clearCredentials());
  }, [error, dispatch]);

  return null;
}