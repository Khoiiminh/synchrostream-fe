'use client'

import { AdminControlCenterLeaf } from '@/components/admin/AdminControlCenterLeaf';
import { Text, Center, Stack, Title } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

interface BaseWorkspaceProps {
    roleScope: 'Admin' | 'User' | string;
}

export function AdminBaseWorkspace({ roleScope }: BaseWorkspaceProps) {
    // Branch execution context securely based on verified security profiles
    if (roleScope === 'Admin') {
        return <AdminControlCenterLeaf />;
    }

    // Fallback security boundary block
    return (
        <Center h="50vh">
            <Stack align="center" gap="xs">
                <IconAlertTriangle size={40} className="text-amber-500 animate-pulse" />
                <Title order={4} className="text-white">Access Denied</Title>
                <Text size="sm" className="text-zinc-500">
                    Your account privileges do not clear execution criteria for this terminal cluster node.
                </Text>
            </Stack>
        </Center>
    );
}