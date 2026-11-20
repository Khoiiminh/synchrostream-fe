"use client";

import { Alert, Button, Center, Stack, Text } from "@mantine/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useAppSelector } from "@/store/hooks";
import { LoadingPage } from "@/shared/ui/LoadingPage";

/**
 * useSearchParams() needs a Suspense boundary so pages using this guard can be
 * prerendered; the fallback is the same "verifying" state shown before auth resolves.
 */
export function RequireAuthenticatedSession({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <Suspense fallback={<VerifyingSession />}>
            <RequireAuthenticatedSessionInner>
                {children}
            </RequireAuthenticatedSessionInner>
        </Suspense>
    );
}

function RequireAuthenticatedSessionInner({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const authStatus = useAppSelector((state) => state.auth.status);

    const destination = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;

    useEffect(() => {
        if (authStatus !== "UNAUTHENTICATED") return;

        router.replace(
            `/?next=${encodeURIComponent(destination)}&reason=sign-in-required`,
        );
    }, [authStatus, destination, router]);

    if (authStatus === "AUTHENTICATED") {
        return <>{children}</>;
    }

    if (authStatus === "UNAVAILABLE") {
        return (
            <Center className="min-h-64 px-4">
                <Stack maw={480} align="center" gap="md">
                    <Alert color="yellow" title="Unable to verify your session">
                        SynchroStream could not reach the authentication
                        service. Your saved session was kept; retry when the
                        service is available.
                    </Alert>
                    <Button onClick={() => window.location.reload()}>
                        Retry
                    </Button>
                </Stack>
            </Center>
        );
    }

    return <VerifyingSession />;
}

function VerifyingSession() {
    return (
        <Center className="min-h-64">
            <Stack align="center" gap="xs">
                <LoadingPage />
                <Text size="sm" c="dimmed">
                    Verifying your session…
                </Text>
            </Stack>
        </Center>
    );
}
