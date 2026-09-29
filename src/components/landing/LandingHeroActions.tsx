'use client';

import { useDisclosure } from '@mantine/hooks';
import { Modal, Button, Group, Text, Loader } from '@mantine/core';
import { AuthModalForms } from '@/components/auth/AuthModalForms';
import { useRouter } from 'next/navigation';
import { useLazyGetMeQuery } from '@/store/services/authApi';

export function LandingHeroActions() {
  const [opened, { open, close }] = useDisclosure(false);
  const router = useRouter();

  // Lazy query: only checked when the user actually clicks, not on mount.
  const [triggerGetMe, { isFetching }] = useLazyGetMeQuery();

  const handleGetStartedClick = async () => {
    const localToken = localStorage.getItem('access_token');

    if (!localToken) {
      open();
      return;
    }

    try {
      const result = await triggerGetMe().unwrap();

      if (result?.success && result?.data?.role) {
        const userRole = result.data.role.toLowerCase();
        router.push(`/dashboard/${userRole}`);
      }
    } catch (err) {
      // Token is invalid or expired — clear it and let the user sign in again.
      localStorage.removeItem('access_token');
      open();
    }
  };

  return (
    <>
      <div className="flex flex-col items-center pt-2">
        <Button
          size="xl"
          radius="xl"
          onClick={handleGetStartedClick}
          disabled={isFetching}
          className="border-0 bg-linear-to-r from-[#6366F1] to-[#8B5CF6] px-10 py-4 text-lg font-semibold text-white shadow-[0_0_40px_-8px_rgba(99,102,241,0.6)] transition-all duration-200 hover:brightness-110 active:scale-[0.97] disabled:opacity-70"
        >
          {isFetching ? (
            <Group gap="xs">
              <Loader size="sm" color="white" />
              <span>Checking your session…</span>
            </Group>
          ) : (
            'Get started'
          )}
        </Button>
        <Text size="sm" className="mt-4 text-[#87879A]">
          Start or join a watch session — free to sign up.
        </Text>
      </div>

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