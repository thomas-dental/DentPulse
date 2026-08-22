import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useUserRole } from './useUserRole';
import { type ActionType, permissionKey } from '@/lib/permissionRegistry';

interface RolePermissionRow {
  module: string;
  card: string | null;
  action_type: string;
  granted: boolean;
}

interface CustomRoleRow {
  id: string;
  name: string;
}

export function usePermissions() {
  const { user, profile } = useAuth();
  const { currentRole, customRoleId, isOwner, loading: roleLoading } = useUserRole();
  const ownerFlag = isOwner();

  // Fetch custom role name
  const { data: customRole } = useQuery({
    queryKey: ['custom_role', customRoleId],
    queryFn: async () => {
      if (!customRoleId) return null;
      const { data, error } = await supabase
        .from('custom_roles')
        .select('id, name')
        .eq('id', customRoleId)
        .single();
      if (error) return null;
      return data as CustomRoleRow;
    },
    enabled: !!customRoleId && !ownerFlag,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch all granted permissions for the user's custom role
  const { data: permissions = [], isLoading: permissionsLoading } = useQuery({
    queryKey: ['role_permissions', customRoleId],
    queryFn: async () => {
      if (!customRoleId) return [];
      const { data, error } = await supabase
        .from('role_permissions')
        .select('module, card, action_type, granted')
        .eq('custom_role_id', customRoleId)
        .eq('granted', true);
      if (error) return [];
      return (data || []) as RolePermissionRow[];
    },
    enabled: !!customRoleId && !ownerFlag,
    staleTime: 5 * 60 * 1000,
  });

  // Build a Set for O(1) permission lookups
  const permissionSet = useMemo(() => {
    if (ownerFlag) return null; // null = full access
    const set = new Set<string>();
    permissions.forEach(p => {
      if (p.granted && p.card) {
        set.add(permissionKey(p.module, p.card, p.action_type as ActionType));
      }
    });
    return set;
  }, [permissions, ownerFlag]);

  /** Check if user can perform a specific action on a module/card */
  const can = useCallback((module: string, action: ActionType, card?: string): boolean => {
    if (ownerFlag) return true;
    if (!permissionSet) return false;
    if (card) {
      return permissionSet.has(permissionKey(module, card, action));
    }
    // Module-level: check if ANY card in module has this action granted
    return permissions.some(p => p.module === module && p.action_type === action && p.granted);
  }, [permissionSet, permissions, ownerFlag]);

  /** Check if user can access a module at all (has any view permission) */
  const canAccessModule = useCallback((moduleKey: string): boolean => {
    if (ownerFlag) return true;
    return permissions.some(p => p.module === moduleKey && p.action_type === 'view' && p.granted);
  }, [permissions, ownerFlag]);

  // Consider loading until we have role data AND (if non-owner) permissions data.
  // When profile is still being fetched (profile is null but user exists), isOwner()
  // returns false because it needs profile.current_organization_id — stay in loading
  // state to avoid flashing Access Denied before profile resolves.
  const profileStillLoading = !!user?.id && !profile;
  const loading = profileStillLoading
    || roleLoading
    || (!ownerFlag && permissionsLoading)
    || (!ownerFlag && !customRoleId && !roleLoading && !!user?.id && !currentRole);
  const roleName = ownerFlag ? 'Owner' : (customRole?.name || currentRole || 'No Role');

  return {
    can,
    canAccessModule,
    isOwner: ownerFlag,
    loading,
    roleName,
    currentRole,
    customRoleId,
    permissions,
  };
}
