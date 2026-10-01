'use client';

import { useDisclosure } from '@mantine/hooks';
import { Modal, Button } from '@mantine/core';
import { AuthModalForms } from '@/components/auth/AuthModalForms';

export function HeaderSignInButton() {
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <>
      <Button
        onClick={open}
        radius="xl"
        className="border border-white/15 bg-white/6 px-5 font-medium text-white backdrop-blur-md transition-colors hover:bg-white/12"
      >
        Sign in
      </Button>

      <Modal
        opened={opened}
        onClose={close}
        title="Sign in to SynchroStream"
        centered
        size="md"
        radius="lg"
        overlayProps={{ backgroundOpacity: 0.7, blur: 6 }}
        styles={{
          content: {
            backgroundColor: '#0B0B14',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 0 0 1px rgba(99,102,241,0.15), 0 20px 60px -20px rgba(99,102,241,0.35)',
            color: '#ffffff',
          },
          header: {
            backgroundColor: '#0B0B14',
            color: '#ffffff',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          },
          title: { fontWeight: 600 },
        }}
      >
        <AuthModalForms onSuccess={close} />
      </Modal>
    </>
  );
}