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
        className="bg-[#4B4DB5] hover:bg-[#323379] transition-all text-white font-medium px-5 rounded"
      >
        Sign In
      </Button>

      <Modal 
        opened={opened} 
        onClose={close} 
        title="Access SynchroStream Gateway" 
        centered
        size="md"
        radius="md"
        styles={{
          content: { backgroundColor: '#000000', border: '1px solid #323379', color: '#ffffff' },
          header: { backgroundColor: '#000000', color: '#ffffff', borderBottom: '1px solid #27272a' },
        }}
      >
        <AuthModalForms onSuccess={close} />
      </Modal>
    </>
  );
}