'use client';

import { useState } from "react";
import { TextInput, PasswordInput, Button, Stack, Tabs, Alert } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useLoginUserMutation, useRegisterUserMutation } from "@/store/services/authApi";
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
    const dispatch = useAppDispatch();
    const router = useRouter();

    const [loginUser, { isLoading: isLoginLoading }] = useLoginUserMutation();
    const [registerUser, { isLoading: isRegisterLoading }] = useRegisterUserMutation();

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

    const handleLoginSubmit = async (values: typeof loginForm.values) => {
        setErrorMessage(null);
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
                router.push(`/dashboard/${userRole}`);
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

    return (
        <Stack gap="md">
        {errorMessage && (
            <Alert color="red" title="Authentication Error" variant="filled">
            {errorMessage}
            </Alert>
        )}

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
                <Button 
                    type="submit" 
                    fullWidth 
                    className="bg-[#4B4DB5] hover:bg-[#323379] mt-4"
                    loading={isLoginLoading}
                >
                    Sign In
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
        </Stack>
    );
}