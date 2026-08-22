import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, CheckSquare, XSquare } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  PERMISSION_REGISTRY,
  ALL_ACTION_TYPES,
  ACTION_TYPE_LABELS,
  type ActionType,
  permissionKey,
  getAllPermissionKeys,
} from '@/lib/permissionRegistry';
import { ModulePermissionRow } from './ModulePermissionRow';
import { roleSyncService, buildPermissionName } from '@/services/roleSyncService';

interface PermissionMatrixProps {
  selectedRoleId: string | null;
  selectedRoleName: string;
}

interface PermissionRow {
  id: string;
  custom_role_id: string;
  module: string;
  card: string | null;
  action_type: string;
  granted: boolean;
}

export function PermissionMatrix({ selectedRoleId, selectedRoleName }: PermissionMatrixProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Fetch all permissions for the selected role
  const { data: rolePermissions = [], isLoading } = useQuery({
    queryKey: ['role_permissions_matrix', selectedRoleId],
    queryFn: async () => {
      if (!selectedRoleId) return [];
      const { data, error } = await supabase
        .from('role_permissions')
        .select('id, custom_role_id, module, card, action_type, granted')
        .eq('custom_role_id', selectedRoleId);
      if (error) throw error;
      return (data || []) as PermissionRow[];
    },
    enabled: !!selectedRoleId,
  });

  // Build a Set of granted permission keys
  const grantedPermissions = new Set<string>();
  rolePermissions.forEach(p => {
    if (p.granted && p.card) {
      grantedPermissions.add(permissionKey(p.module, p.card, p.action_type as ActionType));
    }
  });

  // Upsert mutation
  const upsertMutation = useMutation({
    mutationFn: async (params: { module: string; card: string; action_type: string; granted: boolean }) => {
      if (!selectedRoleId) throw new Error('No role selected');
      const { data, error } = await supabase
        .from('role_permissions')
        .upsert(
          {
            custom_role_id: selectedRoleId,
            module: params.module,
            card: params.card,
            action_type: params.action_type,
            granted: params.granted,
          },
          { onConflict: 'custom_role_id,module,card,action_type' }
        )
        .select();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['role_permissions_matrix', selectedRoleId] });
      queryClient.invalidateQueries({ queryKey: ['role_permissions', selectedRoleId] });
      if (selectedRoleId) {
        roleSyncService.syncPermissions(selectedRoleId, [{
          permission_name: buildPermissionName(params.module, params.card, params.action_type),
          granted: params.granted,
        }]);
      }
    },
    onError: (error) => {
      toast.error('Failed to update permission: ' + (error as Error).message);
    },
  });

  // Batch upsert for module-level toggles
  const batchUpsertMutation = useMutation({
    mutationFn: async (items: Array<{ module: string; card: string; action_type: string; granted: boolean }>) => {
      if (!selectedRoleId) throw new Error('No role selected');
      const rows = items.map(item => ({
        custom_role_id: selectedRoleId,
        module: item.module,
        card: item.card,
        action_type: item.action_type,
        granted: item.granted,
      }));
      const { error } = await supabase
        .from('role_permissions')
        .upsert(rows, { onConflict: 'custom_role_id,module,card,action_type' });
      if (error) throw error;
    },
    onSuccess: (_data, items) => {
      queryClient.invalidateQueries({ queryKey: ['role_permissions_matrix', selectedRoleId] });
      queryClient.invalidateQueries({ queryKey: ['role_permissions', selectedRoleId] });
      if (selectedRoleId && items.length > 0) {
        roleSyncService.syncPermissions(
          selectedRoleId,
          items.map((item) => ({
            permission_name: buildPermissionName(item.module, item.card, item.action_type),
            granted: item.granted,
          })),
        );
      }
    },
    onError: (error) => {
      toast.error('Failed to update permissions: ' + (error as Error).message);
    },
  });

  // Handle single toggle with debounce
  const handleToggle = useCallback((moduleKey: string, cardKey: string, action: ActionType, granted: boolean) => {
    // Optimistic: update the local set immediately
    const key = permissionKey(moduleKey, cardKey, action);
    if (granted) {
      grantedPermissions.add(key);
    } else {
      grantedPermissions.delete(key);
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      upsertMutation.mutate({ module: moduleKey, card: cardKey, action_type: action, granted });
    }, 150);
  }, [selectedRoleId, upsertMutation]);

  // Handle module-level action toggle (toggle all cards in a module for one action)
  const handleToggleModuleAction = useCallback((moduleKey: string, action: ActionType, granted: boolean) => {
    const mod = PERMISSION_REGISTRY.find(m => m.key === moduleKey);
    if (!mod) return;
    const items = mod.cards
      .filter(c => c.actions.includes(action))
      .map(c => ({ module: moduleKey, card: c.key, action_type: action, granted }));
    batchUpsertMutation.mutate(items);
  }, [batchUpsertMutation]);

  // Grant all / revoke all
  const handleBulkAction = useCallback((granted: boolean) => {
    const allKeys = getAllPermissionKeys();
    const items = allKeys.map(k => ({
      module: k.module,
      card: k.card,
      action_type: k.action,
      granted,
    }));
    batchUpsertMutation.mutate(items);
    toast.success(granted ? 'All permissions granted' : 'All permissions revoked');
  }, [batchUpsertMutation]);

  // Filter modules by search
  const filteredModules = PERMISSION_REGISTRY.filter(mod =>
    !search ||
    mod.label.toLowerCase().includes(search.toLowerCase()) ||
    mod.cards.some(c => c.label.toLowerCase().includes(search.toLowerCase()))
  );

  if (!selectedRoleId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Select a role to configure permissions
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold text-lg">Select Permissions for "{selectedRoleName}"</h3>
          <p className="text-xs text-muted-foreground">
            {grantedPermissions.size} of {getAllPermissionKeys().length} permissions granted
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkAction(true)}
            disabled={isLoading}
          >
            <CheckSquare className="w-4 h-4 mr-1" />
            Grant All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkAction(false)}
            disabled={isLoading}
          >
            <XSquare className="w-4 h-4 mr-1" />
            Revoke All
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search modules or cards..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_repeat(8,48px)] items-center gap-1 px-2 py-2 border-b mb-2">
        <span className="text-xs font-medium text-muted-foreground">Module / Card</span>
        {ALL_ACTION_TYPES.map((action) => (
          <span key={action} className="text-xs font-medium text-muted-foreground text-center">
            {ACTION_TYPE_LABELS[action]}
          </span>
        ))}
      </div>

      {/* Module rows */}
      <ScrollArea className="flex-1">
        <div className="pr-4">
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading permissions...</div>
          ) : filteredModules.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No modules match your search</div>
          ) : (
            filteredModules.map((mod) => (
              <ModulePermissionRow
                key={mod.key}
                module={mod}
                grantedPermissions={grantedPermissions}
                onToggle={handleToggle}
                onToggleModuleAction={handleToggleModuleAction}
                onBatchToggle={(items) => batchUpsertMutation.mutate(items)}
                disabled={mod.disabled}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
