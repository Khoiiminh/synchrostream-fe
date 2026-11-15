import React from 'react';
import { Container, Text } from '@mantine/core';
import NavbarWrapper from '@/components/commons/NavbarWrapper';
import CatalogGridClientLeaf from '@/components/catalog/CatalogGridClientLeaf';
import { RequireAuthenticatedSession } from '@/components/auth/RequireAuthenticatedSession';

export default function CatalogPage() {
  return (
    <RequireAuthenticatedSession>
      <NavbarWrapper>
        <Container size="xl" py="xl" className="w-full">
          <Text size="xl" fw={800} mb="lg" className="tracking-tight text-white">
            Available Movies
          </Text>
          <CatalogGridClientLeaf />
        </Container>
      </NavbarWrapper>
    </RequireAuthenticatedSession>
  );
}
