'use client';

import { useState } from "react";
import { TextInput, PasswordInput, Button, Stack, Tabs, Alert, Anchor, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useLoginUserMutation, useRegisterUserMutation, useRequestPasswordResetMutation } from "@/store/services/authApi";
import { useAppDispatch } from "@/store/hooks";
import { setCredentials } from "@/store/slices/authSlice";
import { ApiErrorResponse } from "../error/api.error.response";
import { useRouter } from "next/navigation";

interface AuthModalFormProps {
    onSuccess: () => void;
}

export function AuthModalForms({ onSuccess }: AuthModalFormProps) {
    const [activeTab, setActiveTab] = useState<string | null>('login');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const dispatch = useAppDispatch();
    const router = useRouter();

    const [isForgotPassword, setIsForgotPassword] = useState<boolean>(false);
    const [loginUser, { isLoading: isLoginLoading }] = useLoginUserMutation();
    const [registerUser, { isLoading: isRegisterLoading }] = useRegisterUserMutation();
    const [requestReset, { isLoading: isResetLoading }] = useRequestPasswordResetMutation();

    // Form State Configuration enforcing Class-Validator Match constraints
    const loginForm = useForm({
        initialValues: { email: '', password: '' },
        validate: {
            email: (value) => (/^\S+@\S+.\S+$/.test(value) ? null : 'Invalid email syntax'),
            password: (value) => (value.length >= 8 ? null : 'Password must be at least 8 characters'),
        },
    });

    const registerForm = useForm({
        initialValues: { username: '', email: '', password: '' },
        validate: {
            username: (value) => (value.trim().length > 0 ? null : 'Username is required'),
            email: (value) => (/^\S+@\S+.\S+$/.test(value) ? null : 'Invalid email syntax'),
            password: (value) => (value.length >= 8 ? null : 'Password must be at least 8 characters'),
        },
    });

    const forgotPasswordForm = useForm({
        initialValues: { email: '' },
        validate: {
            email: (value) => (/^\S+@\S+\.\S+$/.test(value) ? null : 'Invalid email syntax'),
        },
    });

    const handleLoginSubmit = async (values: typeof loginForm.values) => {
        setErrorMessage(null);
        setSuccessMessage(null);
        try {
            const response = await loginUser(values).unwrap();
            if (response.success && response.data.access_token) {
                // 1. Persist the access token so RTK Query's prepareHeaders can extract it
                localStorage.setItem('access_token', response.data.access_token);

                // Safe programmatic parsing of the JWT payload to find the user's role
                const tokenParts = response.data.access_token.split('.');
                let userRole = 'user'; // default fallback route
                
                if (tokenParts.length === 3) {
                    try {
                        const payload = JSON.parse(window.atob(tokenParts[1]));
                        if (payload.role) {
                            userRole = payload.role.toLowerCase(); // Convert 'USER' or 'ADMIN' to lowercase matching routes
                        }
                    } catch (e) {
                        console.error('Failed to parse role payload metadata', e);
                    }
                }

                dispatch(setCredentials({ token: response.data.access_token }));
                onSuccess();

                // Safe Next.js transition wrapper pushing to /dashboard/user or /dashboard/admin
                if (userRole === 'admin') {
                    router.push('/dashboard/admin');
                } else {
                    router.push('/catalog');
                }
            }
        } catch (err: unknown) {

            // Check whether err is the system standard error or not
            if (err instanceof Error) {
                setErrorMessage('Internal server error or backend service is unreachable');
                return;
            }

            // if not, process the API response as normal
            const error = err as ApiErrorResponse;
            
            if (error?.status === 'FETCH_ERROR' || error?.status === 500 || !error?.data?.message) {
                setErrorMessage('Internal server error or backend service is unreachable');
            } else {
                setErrorMessage(error.data.message);
            }
        }
    };

    const handleRegisterSubmit = async (values: typeof registerForm.values) => {
        setErrorMessage(null);
        setSuccessMessage(null);
        try {
            const response = await registerUser(values).unwrap();
            if (response.success) {
                // Auto-switch to login layout tab upon profile creation
                setActiveTab('login');
                loginForm.setFieldValue('email', values.email);
            }
        } catch (err: unknown) {
            if (err instanceof Error) {
                setErrorMessage('Internal server error or backend service is unreachable');
                return;
            }

            const error = err as ApiErrorResponse;
            
            if (error?.status === 'FETCH_ERROR' || error?.status === 500 || !error?.data?.message) {
                setErrorMessage('Internal server error or backend service is unreachable');
            } else {
                setErrorMessage(error.data.message);
            }
        }
    };

    const handleForgotPasswordSubmit = async (values: typeof forgotPasswordForm.values) => {
        setErrorMessage(null);
        setSuccessMessage(null);
        try {
            const response = await requestReset(values).unwrap();

            if (response.success) {
                setSuccessMessage(response.message || 'If an account exists, a recovery link has been dispatched to your email.');
                forgotPasswordForm.reset();
            }
        } catch (error: unknown) {
            if (error instanceof Error) {
                setErrorMessage('Internal server error or backend service is unreachable');
                return;
            }
            const apiError = error as ApiErrorResponse;
            if (apiError?.status === 'FETCH_ERROR' || apiError?.status === 500 || !apiError?.data?.message) {
                setErrorMessage('Internal server error or backend service is unreachable');
            } else {
                setErrorMessage(apiError.data.message);
            }
        }
    };

    return (
        <Stack gap="md">
            {errorMessage && (
                <Alert color="red" title="Authentication Error" variant="filled">
                    {errorMessage}
                </Alert>
            )}

            {successMessage && (
                <Alert color="green" title='Success' variant='filled'>
                    {successMessage}
                </Alert>
            )}

            {isForgotPassword ? (
                <Stack gap="sm">
                    <div>
                        <Text size="sm" color="zinc-400" mb="xs">
                            Enter your email address below and we&apos;ll send you a link to reset your password.
                        </Text>
                    </div>
                    <form onSubmit={forgotPasswordForm.onSubmit(handleForgotPasswordSubmit)}>
                        <Stack gap="sm">
                            <TextInput
                                label="Email Address"
                                placeholder="you@example.com"
                                required
                                {...forgotPasswordForm.getInputProps('email')}
                            />
                            <Button 
                                type="submit" 
                                fullWidth 
                                className="bg-[#6366F1] hover:bg-[#4B4DB5] mt-2"
                                loading={isResetLoading}
                            >
                                Send Reset Link
                            </Button>
                        </Stack>
                    </form>
                    <Anchor 
                        component="button" 
                        type="button" 
                        color="dimmed" 
                        size="xs" 
                        onClick={() => {
                            setIsForgotPassword(false);
                            setErrorMessage(null);
                            setSuccessMessage(null);
                        }}
                        className="text-center mt-2"
                    >
                        Back to Sign In
                    </Anchor>
                </Stack>
            ) : (
                /* Standard Login / Register view[cite: 4] */
                <Tabs value={activeTab} onChange={setActiveTab} color="indigo">
                    <Tabs.List grow className="border-zinc-800 mb-4">
                        <Tabs.Tab value="login">Sign In</Tabs.Tab>
                        <Tabs.Tab value="register">Register</Tabs.Tab>
                    </Tabs.List>

                    <Tabs.Panel value="login">
                        <form onSubmit={loginForm.onSubmit(handleLoginSubmit)}>
                            <Stack gap="sm">
                                <TextInput
                                    label="Email Address"
                                    placeholder="you@example.com"
                                    required
                                    {...loginForm.getInputProps('email')}
                                />
                                <PasswordInput
                                    label="Password"
                                    placeholder="Your secure password"
                                    required
                                    {...loginForm.getInputProps('password')}
                                />
                                
                                {/* Forgot password link placed under the password field */}
                                <div className="flex justify-end">
                                    <Anchor 
                                        component="button" 
                                        type="button" 
                                        color="indigo" 
                                        size="xs" 
                                        onClick={() => {
                                            setIsForgotPassword(true);
                                            setErrorMessage(null);
                                            setSuccessMessage(null);
                                        }}
                                    >
                                        Forgot your password?
                                    </Anchor>
                                </div>

                                <Button 
                                    type="submit" 
                                    fullWidth 
                                    className="bg-[#4B4DB5] hover:bg-[#323379] mt-2"
                                    loading={isLoginLoading}
                                >
                                    Sign in
                                </Button>
                            </Stack>
                        </form>
                    </Tabs.Panel>

                    <Tabs.Panel value="register">
                        <form onSubmit={registerForm.onSubmit(handleRegisterSubmit)}>
                            <Stack gap="sm">
                                <TextInput
                                    label="Username"
                                    placeholder="choose_nickname"
                                    required
                                    {...registerForm.getInputProps('username')}
                                />
                                <TextInput
                                    label="Email Address"
                                    placeholder="you@example.com"
                                    required
                                    {...registerForm.getInputProps('email')}
                                />
                                <PasswordInput
                                    label="Password"
                                    placeholder="At least 8 characters"
                                    required
                                    {...registerForm.getInputProps('password')}
                                />
                                <Button 
                                    type="submit" 
                                    fullWidth 
                                    className="bg-[#6366F1] hover:bg-[#4B4DB5] mt-4"
                                    loading={isRegisterLoading}
                                >
                                    Create Account
                                </Button>
                            </Stack>
                        </form>
                    </Tabs.Panel>
                </Tabs>
            )}
        </Stack>
    );
}