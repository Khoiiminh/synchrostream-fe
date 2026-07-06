'use client'

import { authApi, useLogoutMutation } from "@/store/services/authApi";
import { useState } from "react";
import { LoadingPage } from "../commons/LoadingPage";
import { Button } from "@mantine/core";
import { createPortal } from "react-dom";
import { useAppDispatch } from "@/store/hooks";
import { clearCredentials } from "@/store/slices/authSlice";

export function DashboardLogoutButton() {
    const [logout, { isLoading }] = useLogoutMutation();
    const [isClearing, setIsClearing] = useState(false);
    const dispatch = useAppDispatch();

    const handleLogout = async () => {
            try {
                setIsClearing(true);
                await logout().unwrap();
            } catch (error) {
                console.warn('Backend revocation completed or token was already stale');
            } finally {
                // Purge all RTK cache states across  the auth module
                dispatch(authApi.util.resetApiState());
    
                // Clear the slice state 
                dispatch(clearCredentials());
    
                localStorage.removeItem('access_token');
                window.location.href = '/';
            }
        };

    if (isClearing || isLoading) {
        if (typeof window !== 'undefined') {
            return createPortal(
                <LoadingPage message="Severing secure session lines safely..." />,
                document.body
            );
        }
        return null;
    }

    return (
        <Button color="red" variant="light" onClick={handleLogout}>
            Log out
        </Button>
    );
}