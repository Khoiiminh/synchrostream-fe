'use client';

import { ApiErrorResponse } from "@/components/error/api.error.response";
import { useConfirmPasswordResetMutation } from "@/store/services/authApi";
import { Alert, Button, Container, PasswordInput, Stack, Title, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react";

export default function ResetPasswordClient() {
    const searchParams = useSearchParams();
    const router = useRouter();

    const token = searchParams.get('token');

    const [submitReset] = useConfirmPasswordResetMutation();

    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const form = useForm({
        initialValues: {
            password: '',
            confirmPassword: '',
        },
        validate: {
            password: (value) =>
                value.length >= 8 ? null : 'Password must be at least 8 characters',

            confirmPassword: (val, values) =>
                val === values.password ? null : 'Passwords do not match',
        }
    });

    const handleSubmit = async (values: typeof form.values) => {
        if (!token) {
            setErrorMsg('The password reset token is missing from your email link.');
            return;
        }

        setLoading(true);
        setErrorMsg(null);

        try {
            await submitReset({
                token,
                newPassword: values.password,
            }).unwrap();

            setSuccess(true);

            setTimeout(() => {
                router.push('/');
            }, 3000);

        } catch (error: unknown) {
            const castedError = error as ApiErrorResponse;
            const err =
                castedError?.data?.message ||
                'Something went wrong while confirming your new password.';
            setErrorMsg(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Container size="xs" className="min-h-screen flex items-center justify-center">
            <Stack className="w-full bg-zinc-950/40 p-8 rounded-2xl border border-zinc-900 shadow-2xl" gap="xl">

                <div>
                    <Title order={2} className="text-white text-center">
                        Create New Password
                    </Title>
                    <Text size="sm" className="text-zinc-400 text-center mt-1">
                        Please enter your secure credentials below.
                    </Text>
                </div>

                {errorMsg && <Alert color="red" title="Submission Error">{errorMsg}</Alert>}
                {success && <Alert color="green" title="Success">
                    Your password has been reset! Redirecting...
                </Alert>}

                {!success && (
                    <form onSubmit={form.onSubmit(handleSubmit)}>
                        <Stack gap="md">

                            <PasswordInput
                                label="New Password"
                                required
                                {...form.getInputProps('password')}
                            />

                            <PasswordInput
                                label="Confirm Password"
                                required
                                {...form.getInputProps('confirmPassword')}
                            />

                            <Button
                                type="submit"
                                fullWidth
                                loading={loading}
                            >
                                Save Changes
                            </Button>

                        </Stack>
                    </form>
                )}
            </Stack>
        </Container>
    );
}