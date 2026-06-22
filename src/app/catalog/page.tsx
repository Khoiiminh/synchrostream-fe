import React from 'react';
import { Container, Text } from '@mantine/core';
import NavbarWrapper from '@/components/commons/NavbarWrapper';
import CatalogGridClientLeaf from '@/components/catalog/CatalogGridClientLeaf';

export default function CatalogPage() {
  return (
    <NavbarWrapper>
      <Container size="xl" py="xl" className="w-full">
        <Text size="xl" fw={800} mb="lg" className="tracking-tight text-white">
          Available Movies
        </Text>
        <CatalogGridClientLeaf />
      </Container>
    </NavbarWrapper>
  );
}