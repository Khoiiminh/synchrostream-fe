'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useGetMeQuery } from '@/store/services/authApi';
import { LoadingPage } from '@/components/commons/LoadingPage';
import { useSetState } from '@mantine/hooks';

interface InterceptorState {
  isMounted: boolean;
  hasToken: boolean;
  isCheckingToken: boolean;
  isRedirecting: boolean;
}

export function SessionInterceptor() {
  const router = useRouter();

  const [state, setState] = useSetState<InterceptorState>({
    isMounted: false,
    hasToken: false,
    isCheckingToken: true,
    isRedirecting: false,
  });

  // Phase 1: Read token safely post-hydration mount
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    
    setState({
      isMounted: true,
      hasToken: !!token,
      isCheckingToken: !token,
    });
  }, [setState]);

  // Keep RTK Query skipped safely until state validation establishes token existence
  const { data: response, error, isFetching } = useGetMeQuery(undefined, {
    skip: !state.hasToken || !state.isMounted,
  });

  // Phase 2: Route Handling & Graceful Redirect Hold
  useEffect(() => {
    if (!state.hasToken || isFetching) return;

    if (response?.success) {

      // Signal that the platform is in the redirect phase
      setState({ isRedirecting: true });

      const userRole = response.data.role?.toUpperCase();
      
      if (userRole === 'ADMIN') {
        router.replace('/dashboard/admin');
      } else {
        router.replace('/catalog');
      }
    } 
    
    if (error) {
      localStorage.removeItem('access_token');
      
      setState({
        hasToken: false,
        isCheckingToken: false,
        isRedirecting: false,
      });
    }
  }, [response, error, isFetching, state.hasToken, router, setState]);

  // Prevent SSR markup generation to uphold hydration requirements
  if (!state.isMounted) {
    return null;
  }

  // Intercept viewing planes using your generic LoadingPage component
  if (state.hasToken && (state.isCheckingToken || isFetching || state.isRedirecting)) {
    return <LoadingPage message="Connecting into your account..." />;
  }

  return null;
}