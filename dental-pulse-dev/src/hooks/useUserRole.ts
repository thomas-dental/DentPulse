import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type AppRole = 'owner' | 'admin' | 'member';

export interface UserRole {
  organization_id: string;
  role: AppRole;
  custom_role_id: string | null;
}

export function useUserRole() {
  const { user, profile } = useAuth();

  const { data: roles = [], isLoading: loading } = useQuery({
    queryKey: ['user_roles', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from('user_roles')
        .select('organization_id, role, custom_role_id')
        .eq('user_id', user.id);

      if (error) throw error;
      return (data || []) as UserRole[];
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const currentOrgRole = useMemo(() => {
    if (!profile?.current_organization_id) {
      return roles.length > 0 ? roles[0] : null;
    }
    return roles.find(r => r.organization_id === profile.current_organization_id) || null;
  }, [roles, profile?.current_organization_id]);

  const currentRole = currentOrgRole?.role as AppRole || null;
  const customRoleId = currentOrgRole?.custom_role_id || null;

  const hasRole = (role: AppRole, organizationId?: string): boolean => {
    const orgId = organizationId || profile?.current_organization_id;
    if (!orgId) return false;
    return roles.some(r => r.organization_id === orgId && r.role === role);
  };

  const hasAnyRole = (allowedRoles: AppRole[], organizationId?: string): boolean => {
    const orgId = organizationId || profile?.current_organization_id;
    if (!orgId) return false;
    return roles.some(r => r.organization_id === orgId && allowedRoles.includes(r.role as AppRole));
  };

  const isOwner = (organizationId?: string): boolean => hasRole('owner', organizationId);
  const isAdmin = (organizationId?: string): boolean => hasRole('admin', organizationId);
  const isMember = (organizationId?: string): boolean => hasRole('member', organizationId);
  const isOwnerOrAdmin = (organizationId?: string): boolean => hasAnyRole(['owner', 'admin'], organizationId);

  return {
    roles,
    currentRole,
    customRoleId,
    loading,
    hasRole,
    hasAnyRole,
    isOwner,
    isAdmin,
    isMember,
    isOwnerOrAdmin,
  };
}
