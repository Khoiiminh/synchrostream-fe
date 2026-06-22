'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, Avatar, Text, UnstyledButton, Group } from '@mantine/core';
import { authApi, useGetMeQuery, useLogoutMutation } from '@/store/services/authApi';
import { LoadingPage } from './LoadingPage';
import { createPortal } from 'react-dom';
import { useAppDispatch } from '@/store/hooks';
import { clearCredentials } from '@/store/slices/authSlice';

export default function ProfileMenuClientLeaf() {
    const router = useRouter();
    const [logout, { isLoading: isLoggingOut }] = useLogoutMutation();
    const [isClearing, setIsClearing] = useState(false);
    const dispatch = useAppDispatch();
    
    const { data: profileResponse, isLoading: isProfileLoading } = useGetMeQuery();

    const user = profileResponse?.success ? profileResponse.data : null;

    const handleLogout = async () => {
        try {
            setIsClearing(true);
            await logout().unwrap();
        } catch (error) {
            console.warn('Backend revocation completed or token was already stale');
        } finally {
            // Purge all RTK cache states across  the auth module
            dispatch(authApi.util.resetApiState());

            // Clear the slice state 
            dispatch(clearCredentials());

            localStorage.removeItem('access_token');
            window.location.href = '/';
        }
    };

    if (isClearing || isLoggingOut) {
        if (typeof window !== 'undefined') {
            return createPortal(
                <LoadingPage message="Severing secure session lines safely..." />,
                document.body
            );
        }
        return null;
    }

  return (
    <Menu shadow="md" width={220} position="bottom-end" transitionProps={{ transition: 'pop-top-right' }}>
      <Menu.Target>
        <UnstyledButton className="p-1 rounded-full hover:bg-zinc-800 transition-colors">
          <Group gap="xs">
            <Avatar radius="xl" color="blue">
              {/* Dynamic substring initials calculation fallback */}
              {user?.username ? user.username.substring(0, 2).toUpperCase() : 'US'}
            </Avatar>
          </Group>
        </UnstyledButton>
      </Menu.Target>

      <Menu.Dropdown className="bg-zinc-900 border-zinc-800 text-zinc-200">
        <Menu.Label className="text-zinc-500">
          Account Session {user?.role ? `(${user.role})` : ''}
        </Menu.Label>
        
        <div className="px-3 py-1 mb-2">
          {isProfileLoading ? (
            <Text size="xs" color="dimmed">Loading profile metadata...</Text>
          ) : (
            <>
              <Text size="sm" fw={600} className="text-zinc-100 truncate">
                {user?.username || 'Screening Member'}
              </Text>
              <Text size="xs" color="dimmed" className="truncate">
                {user?.email || 'user@synchrostream.platform'}
              </Text>
            </>
          )}
        </div>

        <Menu.Divider className="border-zinc-800" />

        <Menu.Item onClick={() => router.push('/dashboard/user')} className="hover:bg-zinc-800 text-zinc-200">
          User Dashboard
        </Menu.Item>
        
        <Menu.Item onClick={() => router.push('/catalog')} className="hover:bg-zinc-800 text-zinc-200">
          Film Catalog
        </Menu.Item>

        <Menu.Divider className="border-zinc-800" />

        <Menu.Item color="red" onClick={handleLogout} className="hover:bg-red-950/30">
          Sign Out Profile
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}