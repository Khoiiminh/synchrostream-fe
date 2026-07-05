'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Group, Text, Container, Button, Stack, TextInput, Modal } from '@mantine/core';
import ProfileMenuClientLeaf from './ProfileMenuClientLeaf';
import { useRouter } from 'next/navigation';
import { LogIn, Users } from 'lucide-react';

interface NavbarWrapperProps {
  children: React.ReactNode;
}

export default function NavbarWrapper({ children }: NavbarWrapperProps) {
  const router = useRouter();
  const [targetRoomCode, setTargetRoomCode] = useState('');
  const [targetPassword, setTargetPassword] = useState('');
  const [opened, setOpened] = useState(false);

  const handleJoinRoomSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    const cleanCode = targetRoomCode.trim().toUpperCase();
    const cleanPassword = targetPassword.trim();

    if (!cleanCode) {
      return;
    }

    router.push(`/party/${cleanCode}?pwd=${encodeURIComponent(cleanPassword)}`);

    setTargetRoomCode('');
    setTargetPassword('');
    setOpened(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      <header className="w-full bg-zinc-900/50 backdrop-blur border-b border-zinc-800 sticky top-0 z-50">
        <Container size="xl" h={64}>
          <Group justify="space-between" h="100%">
            <Link href="/catalog" passHref style={{ textDecoration: 'none' }}>
              <Text fw={900} className="text-xl tracking-tighter text-white hover:opacity-90 transition-opacity">
                SYNCHROSTREAM
              </Text>
            </Link>

            <Group gap="md">
              {/* Trigger Button to open the Room Join HUD Panel */}
              <Button
                variant="subtle"
                color="teal"
                size="sm"
                leftSection={<Users size={16} />}
                onClick={() => setOpened(true)}
                className="hover:bg-zinc-800/60 text-teal-400"
              >
                Join Room
              </Button>

              <ProfileMenuClientLeaf />
            </Group>
          </Group>
        </Container>
      </header>

      {/* Pop-up Panel Modal Layer */}
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={
          <Group gap="xs">
            <Users size={18} className="text-teal-400" />
            <Text fw={700} size="sm" className="text-zinc-200 uppercase tracking-wide">
              Join Watch Session
            </Text>
          </Group>
        }
        centered
        radius="md"
        styles={{
          content: { backgroundColor: '#18181b', border: '1px solid rgba(63, 63, 70, 0.4)' },
          header: { backgroundColor: '#18181b', borderBottom: '1px solid rgba(63, 63, 70, 0.2)' },
          close: { color: '#a1a1aa', '&:hover': { backgroundColor: 'rgba(63, 63, 70, 0.4)' } }
        }}
      >
        <form onSubmit={handleJoinRoomSubmit}>
          <Stack gap="md" mt="xs">
            <TextInput
              label="Session Code"
              description="Enter the unique 6-character room token shared by the host."
              placeholder="e.g. 7E29T6"
              required
              autoFocus
              value={targetRoomCode}
              onChange={(e) => setTargetRoomCode(e.currentTarget.value)}
              styles={{
                input: { backgroundColor: '#09090b', borderColor: 'rgba(63, 63, 70, 0.6)', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'monospace' },
                label: { color: '#e4e4e7', fontWeight: 600 },
                description: { color: '#71717a' }
              }}
            />

            {/* NEW: Password Constraint field */}
            <TextInput
              label="Room Password"
              description="Provide the protection key configuration established by the host."
              placeholder="Enter room password..."
              value={targetPassword}
              onChange={(e) => setTargetPassword(e.currentTarget.value)}
              styles={{
                input: { backgroundColor: '#09090b', borderColor: 'rgba(63, 63, 70, 0.6)', color: '#fff' },
                label: { color: '#e4e4e7', fontWeight: 600 },
                description: { color: '#71717a' }
              }}
            />

            <Button
              type="submit"
              color="teal"
              fullWidth
              disabled={!targetRoomCode.trim()}
              leftSection={<LogIn size={14} />}
            >
              Enter Room Pipeline
            </Button>
          </Stack>
        </form>
      </Modal>

      <main className="grow flex flex-col">
        {children}
      </main>
    </div>
  );
}