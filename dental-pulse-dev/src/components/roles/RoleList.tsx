import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, Shield, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { roleSyncService } from '@/services/roleSyncService';

interface CustomRole {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  is_system: boolean;
  created_at: string;
  user_count?: number;
}

interface RoleListProps {
  selectedRoleId: string | null;
  onSelectRole: (roleId: string, roleName: string) => void;
}

export function RoleList({ selectedRoleId, onSelectRole }: RoleListProps) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.current_organization_id;

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');

  // Fetch custom roles with user count
  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['custom_roles', orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data: rolesData, error } = await supabase
        .from('custom_roles')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: true });
      if (error) throw error;

      // Get user counts per role
      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('custom_role_id')
        .eq('organization_id', orgId)
        .not('custom_role_id', 'is', null);

      const countMap: Record<string, number> = {};
      (userRoles || []).forEach((ur: { custom_role_id: string | null }) => {
        if (ur.custom_role_id) {
          countMap[ur.custom_role_id] = (countMap[ur.custom_role_id] || 0) + 1;
        }
      });

      return (rolesData || []).map((r: CustomRole) => ({
        ...r,
        user_count: countMap[r.id] || 0,
      }));
    },
    enabled: !!orgId,
  });

  // Create role
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('No organization');
      const { data, error } = await supabase
        .from('custom_roles')
        .insert({
          organization_id: orgId,
          name: formName.trim(),
          description: formDescription.trim() || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['custom_roles', orgId] });
      if (orgId) {
        roleSyncService.upsertRole({
          tenant_platform_id: orgId,
          source_role_id: data.id,
          name: data.name,
          description: data.description,
          color: data.color,
          is_system: !!data.is_system,
        });
      }
      toast.success(`Role "${formName}" created`);
      setCreateOpen(false);
      setFormName('');
      setFormDescription('');
      onSelectRole(data.id, data.name);
    },
    onError: (error) => {
      toast.error('Failed to create role: ' + (error as Error).message);
    },
  });

  // Update role
  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingRole) throw new Error('No role selected');
      const { error } = await supabase
        .from('custom_roles')
        .update({
          name: formName.trim(),
          description: formDescription.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingRole.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom_roles', orgId] });
      if (orgId && editingRole) {
        roleSyncService.upsertRole({
          tenant_platform_id: orgId,
          source_role_id: editingRole.id,
          name: formName.trim(),
          description: formDescription.trim() || null,
          color: editingRole.color,
          is_system: editingRole.is_system,
        });
      }
      toast.success(`Role updated`);
      setEditOpen(false);
      setEditingRole(null);
    },
    onError: (error) => {
      toast.error('Failed to update role: ' + (error as Error).message);
    },
  });

  // Delete role
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!editingRole) throw new Error('No role selected');
      const { error } = await supabase
        .from('custom_roles')
        .delete()
        .eq('id', editingRole.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom_roles', orgId] });
      if (editingRole) {
        roleSyncService.deleteRole(editingRole.id);
      }
      toast.success(`Role deleted`);
      setDeleteOpen(false);
      if (selectedRoleId === editingRole?.id) {
        onSelectRole('', '');
      }
      setEditingRole(null);
    },
    onError: (error) => {
      toast.error('Failed to delete role: ' + (error as Error).message);
    },
  });

  const openEdit = (role: CustomRole) => {
    setEditingRole(role);
    setFormName(role.name);
    setFormDescription(role.description || '');
    setEditOpen(true);
  };

  const openDelete = (role: CustomRole) => {
    setEditingRole(role);
    setDeleteOpen(true);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-lg">Roles</h3>
        <Button
          size="sm"
          onClick={() => {
            setFormName('');
            setFormDescription('');
            setCreateOpen(true);
          }}
        >
          <Plus className="w-4 h-4 mr-1" />
          Create Role
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">Loading roles...</div>
        ) : roles.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            No custom roles yet. Create one to get started.
          </div>
        ) : (
          <div className="space-y-1 pr-2">
            {roles.map((role) => (
              <div
                key={role.id}
                className={cn(
                  'flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors',
                  selectedRoleId === role.id
                    ? 'bg-primary/10 border border-primary/30'
                    : 'hover:bg-muted/50 border border-transparent'
                )}
                onClick={() => onSelectRole(role.id, role.name)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Shield className="w-4 h-4 text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{role.name}</div>
                    {role.description && (
                      <div className="text-xs text-muted-foreground truncate">{role.description}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Badge variant="secondary" className="text-xs">
                    <Users className="w-3 h-3 mr-1" />
                    {role.user_count}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => { e.stopPropagation(); openEdit(role); }}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); openDelete(role); }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Role</DialogTitle>
            <DialogDescription>
              Create a custom role with a name and optional description. You can configure permissions after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="role-name">Role Name</Label>
              <Input
                id="role-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Practice Manager"
              />
            </div>
            <div>
              <Label htmlFor="role-desc">Description (optional)</Label>
              <Input
                id="role-desc"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="e.g. Can manage day-to-day operations"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!formName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Role</DialogTitle>
            <DialogDescription>Update the role name and description.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="edit-name">Role Name</Label>
              <Input
                id="edit-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit-desc">Description</Label>
              <Input
                id="edit-desc"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={!formName.trim() || updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Role</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{editingRole?.name}"?
              {editingRole?.user_count ? (
                <span className="block mt-2 text-destructive font-medium">
                  Warning: {editingRole.user_count} user(s) are assigned this role. They will lose their permissions.
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
