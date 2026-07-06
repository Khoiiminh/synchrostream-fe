'use client';

import { useDisclosure } from '@mantine/hooks';
import { Modal, Button, Group, Text, Loader } from '@mantine/core';
import { AuthModalForms } from '@/components/auth/AuthModalForms';
import { useRouter } from 'next/navigation';
import { useLazyGetMeQuery } from '@/store/services/authApi';

export function LandingHeroActions() {
  const [opened, { open, close }] = useDisclosure(false);
const router = useRouter();

  // 1. Use a LAZY query. This gives you a trigger function 'triggerGetMe'
  // and doesn't run automatically. This is much better for "Click to check" logic.
  const [triggerGetMe, { isFetching }] = useLazyGetMeQuery();

  const handleGetStartedClick = async () => {
    const localToken = localStorage.getItem('access_token');
    
    if (!localToken) {
      open();
      return;
    }

    // 2. Trigger the check manually.
    try {
      const result = await triggerGetMe().unwrap();
      
      if (result?.success && result?.data?.role) {
        const userRole = result.data.role.toLowerCase();
        router.push(`/dashboard/${userRole}`);
      }
    } catch (err) {
      // 3. Handle failure (Invalid/Expired token)
      localStorage.removeItem('access_token');
      open();
    }
  };

return (
    <>
      <div className="pt-4 text-center">
        <Group justify="center">
          <Button 
            size="xl" 
            onClick={handleGetStartedClick}
            disabled={isFetching}
            className="bg-[#6366F1] hover:bg-[#4B4DB5] text-white font-bold px-10 py-4 text-xl rounded shadow-lg shadow-[#6366F1]/20 transition-transform active:scale-95 disabled:opacity-70"
          >
            {isFetching ? (
              <Group gap="xs">
                <Loader size="sm" color="white" />
                <span>Verifying Session...</span>
              </Group>
            ) : (
              'Get Started'
            )}
          </Button>
        </Group>
        <Text size="xs" className="text-zinc-500 mt-3">
          Ready to start or join a theater session? Create an account now.
        </Text>
      </div>

      {/* Centralized Authentication Overlay Modal Boundary Layer */}
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