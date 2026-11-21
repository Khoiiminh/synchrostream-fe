import React from "react";
import { NavbarWrapper } from "@/features/app-shell";
import { BaseWorkspace } from "@/features/dashboard";
import { RequireAuthenticatedSession } from "@/features/auth";

export default function UserDashboardPage() {
    return (
        <RequireAuthenticatedSession>
            <NavbarWrapper>
                <BaseWorkspace roleScope="User" />
            </NavbarWrapper>
        </RequireAuthenticatedSession>
    );
}
