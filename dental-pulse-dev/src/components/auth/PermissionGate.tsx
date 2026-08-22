import { ReactNode } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import type { ActionType } from '@/lib/permissionRegistry';

interface PermissionGateProps {
  children: ReactNode;
  module: string;
  card?: string;
  action?: ActionType;
  fallback?: ReactNode;
}

/**
 * Conditionally renders children based on dynamic RBAC permissions.
 * Owner always sees everything. Other roles need the specific permission granted.
 */
export function PermissionGate({
  children,
  module,
  card,
  action = 'view',
  fallback = null,
}: PermissionGateProps) {
  const { can, loading } = usePermissions();

  if (loading) return null;

  if (!can(module, action, card)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
