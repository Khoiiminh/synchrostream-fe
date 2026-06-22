import React from 'react';
import Link from 'next/link';
import { Group, Text, Container } from '@mantine/core';
import ProfileMenuClientLeaf from './ProfileMenuClientLeaf';

interface NavbarWrapperProps {
  children: React.ReactNode;
}

export default function NavbarWrapper({ children }: NavbarWrapperProps) {
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

            <ProfileMenuClientLeaf />
          </Group>
        </Container>
      </header>

      <main className="grow flex flex-col">
        {children}
      </main>
    </div>
  );
}