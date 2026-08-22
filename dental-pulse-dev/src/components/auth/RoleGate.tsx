import { ReactNode } from 'react';
import { useUserRole, AppRole } from '@/hooks/useUserRole';

interface RoleGateProps {
  children: ReactNode;
  allowedRoles: AppRole[];
  fallback?: ReactNode;
  organizationId?: string;
}

export function RoleGate({ children, allowedRoles, fallback = null, organizationId }: RoleGateProps) {
  const { hasAnyRole, loading } = useUserRole();

  if (loading) {
    return null;
  }

  if (!hasAnyRole(allowedRoles, organizationId)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
