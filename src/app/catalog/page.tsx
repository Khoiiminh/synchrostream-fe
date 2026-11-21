import React from "react";
import { Container } from "@mantine/core";
import { NavbarWrapper } from "@/features/app-shell";
import { CatalogGridClientLeaf } from "@/features/catalog";
import { RequireAuthenticatedSession } from "@/features/auth";

export default function CatalogPage() {
    return (
        <RequireAuthenticatedSession>
            <NavbarWrapper>
                <Container size="xl" py="xl" className="w-full">
                    <CatalogGridClientLeaf />
                </Container>
            </NavbarWrapper>
        </RequireAuthenticatedSession>
    );
}
