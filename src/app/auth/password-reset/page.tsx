'use client'

import { ApiErrorResponse } from "@/components/error/api.error.response";
import { useConfirmPasswordResetMutation } from "@/store/services/authApi";
import { Alert, Button, Container, PasswordInput, Stack, Title, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react";

export default function ResetPasswordPage() {
    const searchParams = useSearchParams();
    const router = useRouter();

    // Extract token parameter safely from: /auth/reset-password?token=XYZ
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
            password: (values) => (values.length >= 8 ? null : 'Password must be at least 8 characters'),
            confirmPassword: (val, values) => (val === values.password ? null : 'Passwords do not match'),
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
            // Unwrapping the mutation triggers the catch block if the backend returns an error code
            await submitReset({
                token: token,
                newPassword: values.password, // Make sure your API's property expectation matches 'password' vs 'newPassword'
            }).unwrap();

            // Trigger success state if unwrap passes safely
            setSuccess(true);

            // Give them a moment to read the message, then send them to login screen
            setTimeout(() => {
                router.push('/');
            }, 3000);
        } catch (error: unknown) {
            const castedError = error as ApiErrorResponse;
            const err = castedError?.data?.message || 'Something went wrong while confirming your new password.';
            setErrorMsg(err);
        } finally {
            setLoading(false);
        }
    };

    return (
    <Container size="xs" className="min-h-screen flex items-center justify-center">
      <Stack className="w-full bg-zinc-950/40 p-8 rounded-2xl border border-zinc-900 shadow-2xl" gap="xl">
        <div>
          <Title order={2} className="text-white text-center tracking-tight">
            Create New Password
          </Title>
          <Text size="sm" className="text-zinc-400 text-center mt-1">
            Please enter your secure alternate authentication credentials below.
          </Text>
        </div>

        {errorMsg && <Alert color="red" title="Submission Error">{errorMsg}</Alert>}
        {success && <Alert color="green" title="Success">Your password has been reset! Redirecting to login...</Alert>}

        {!success && (
          <form onSubmit={form.onSubmit(handleSubmit)}>
            <Stack gap="md">
              <PasswordInput
                label="New Password"
                placeholder="Minimum 8 characters"
                required
                {...form.getInputProps('password')}
              />
              <PasswordInput
                label="Confirm New Password"
                placeholder="Repeat password"
                required
                {...form.getInputProps('confirmPassword')}
              />
              <Button
                type="submit" 
                fullWidth 
                className="bg-[#6366F1] hover:bg-[#4B4DB5] mt-2"
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