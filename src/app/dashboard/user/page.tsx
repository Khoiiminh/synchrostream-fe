import React from 'react';
import NavbarWrapper from '@/components/commons/NavbarWrapper';
import { BaseWorkspace } from '@/components/dashboard/BaseWorkspace';

export default function UserDashboardPage() {
  return (
    <NavbarWrapper>
      <BaseWorkspace roleScope='User' />
    </NavbarWrapper>
  );
}