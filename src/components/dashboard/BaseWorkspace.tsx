'use client';

import { useEffect } from 'react';
import { Button, Container, Title, Text, Stack, Center, Loader } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { clearCredentials, setProfileData } from '@/store/slices/authSlice';
import { useGetMeQuery } from '@/store/services/authApi';

interface BaseWorkspaceProps {
  roleScope: 'User' | 'Admin';
}

export function BaseWorkspace({ roleScope }: BaseWorkspaceProps) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const cachedUsername = useAppSelector((state) => state.auth.username);

  const { data: response, isLoading, isError } = useGetMeQuery(undefined, {
    refetchOnMountOrArgChange: true,
  });

  useEffect(() => {
    if (response?.success && response.data?.username) {
      dispatch(setProfileData({ username: response.data.username }));
    }
  }, [response, dispatch]);

  const handleLogout = () => {
    dispatch(clearCredentials());
    localStorage.removeItem('access_token');
    router.push('/'); // Safe programmatic route change
  };

  if (isLoading) {
    return (
      <Center className="h-64">
        <Loader color="indigo" size="lg" type="dots" />
      </Center>
    );
  }

  if (isError || (!isLoading && !response?.success && !cachedUsername)) {
    return (
      <Center className="h-64">
        <Stack gap="sm" align="center">
          <Text className="text-red-400 font-medium">Session unauthorized or expired.</Text>
          <Button onClick={() => router.push('/')} className="bg-[#4B4DB5]">
            Return Home
          </Button>
        </Stack>
      </Center>
    );
  }

  const activeUsername = cachedUsername || response?.data?.username || 'Guest';

  return (
    <Container size="md" className="py-12">
      <Stack gap="xl" className="bg-zinc-950/40 p-8 rounded-2xl border border-zinc-900 shadow-2xl">
        <div>
          <Text className="text-xs uppercase tracking-widest text-[#6366F1] font-bold mb-1">
            {roleScope} Interface Panel
          </Text>
          <Title order={1} className="text-3xl sm:text-5xl font-black text-white tracking-tight">
            Welcome, <span className="text-[#6366F1]">{activeUsername}</span>
          </Title>
          <Text className="text-zinc-400 mt-2">
            You have successfully logged in to your secure workspace profile.
          </Text>
        </div>

        <div className="h-px bg-zinc-900" />

        <div className="flex justify-end">
          <Button 
            onClick={handleLogout} 
            className="bg-transparent hover:bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800 transition-colors"
          >
            Logout
          </Button>
        </div>
      </Stack>
    </Container>
  );
}