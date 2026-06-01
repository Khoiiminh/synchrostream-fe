'use client'

import { useLogoutMutation } from "@/store/services/authApi";
import { useRouter } from "next/navigation"
import { useState } from "react";
import { LoadingPage } from "../commons/LoadingPage";
import { Button } from "@mantine/core";

export function DashboardLogoutButton() {
    const [logout, { isLoading }] = useLogoutMutation();
    const [isClearing, setIsClearing] = useState(false);

    const handleLogout = async () => {
        try {
            setIsClearing(true);
            await logout().unwrap();
        } catch (error) {
            console.warn('Backend revocation completed or token was already stale');
        } finally {
            localStorage.removeItem('access_token');

            window.location.href = '/';
        }
    };

    if (isClearing || isLoading) {
        return <LoadingPage message='Severing secure session lines safely...'/>;
    }

    return (
        <Button color="red" variant="light" onClick={handleLogout}>
            Log out
        </Button>
    );
}