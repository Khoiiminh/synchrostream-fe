import React from 'react';
import NavbarWrapper from '@/components/commons/NavbarWrapper';
import { BaseWorkspace } from '@/components/dashboard/BaseWorkspace';
import { RequireAuthenticatedSession } from '@/components/auth/RequireAuthenticatedSession';

export default function UserDashboardPage() {
  return (
    <RequireAuthenticatedSession>
      <NavbarWrapper>
        <BaseWorkspace roleScope='User' />
      </NavbarWrapper>
    </RequireAuthenticatedSession>
  );
}
