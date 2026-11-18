import React from "react";
import { Container } from "@mantine/core";
import NavbarWrapper from "@/components/commons/NavbarWrapper";
import CatalogGridClientLeaf from "@/components/catalog/CatalogGridClientLeaf";
import { RequireAuthenticatedSession } from "@/components/auth/RequireAuthenticatedSession";

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
