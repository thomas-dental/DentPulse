import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole, AppRole } from '@/hooks/useUserRole';
import { useOrganization } from '@/hooks/useOrganization';
import { useLocations } from '@/hooks/useLocations';
import { supabase } from '@/integrations/supabase/client';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Users, UserPlus, Shield, ArrowLeft, Mail, Trash2, Edit2, Clock, XCircle, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';

interface CustomRoleOption {
  id: string;
  name: string;
}

interface TeamMember {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: AppRole;
  custom_role_id: string | null;
  custom_role_name: string | null;
  is_active: boolean;
  created_at: string;
}

export default function TeamManagement() {
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const { isOwner } = useUserRole();
  const { organization } = useOrganization();
  const { allAvailableLocations } = useLocations();
  const { can } = usePermissions();

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);

  // Edit form state (loaded when edit dialog opens)
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRoleType, setEditRoleType] = useState('');
  const [editLocationIds, setEditLocationIds] = useState<string[]>([]);
  
  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('');
  const [isInviting, setIsInviting] = useState(false);

  // Invite form extras
  const [inviteName, setInviteName] = useState('');
  const [inviteRoleType, setInviteRoleType] = useState('Practitioner');
  const [inviteLocationIds, setInviteLocationIds] = useState<string[]>([]);

  // Practice role types for team_members.role_type
  const practiceRoleTypes = [
    'Dentist', 'Hygienist', 'Therapist', 'Nurse',
    'Receptionist', 'Practice Manager', 'Treatment Coordinator', 'Other',
  ];

  // Pending invitations from team_members
  const [pendingInvites, setPendingInvites] = useState<Array<{
    id: string; name: string; email: string; role_type: string; created_at: string; invite_expires_at: string | null;
  }>>([]);

  // Fetch custom roles for the organization
  const { data: customRoles = [] } = useQuery({
    queryKey: ['custom_roles', profile?.current_organization_id],
    queryFn: async () => {
      if (!profile?.current_organization_id) return [];
      const { data, error } = await supabase
        .from('custom_roles')
        .select('id, name')
        .eq('organization_id', profile.current_organization_id)
        .order('name');
      if (error) return [];
      return (data || []) as CustomRoleOption[];
    },
    enabled: !!profile?.current_organization_id,
  });

  useEffect(() => {
    if (profile?.current_organization_id) {
      fetchTeamMembers();
      fetchPendingInvites();
    }
  }, [profile?.current_organization_id]);

  const fetchPendingInvites = async () => {
    if (!profile?.current_organization_id) return;
    const { data } = await (supabase as any)
      .from('team_members')
      .select('id, name, email, role_type, user_id, created_at, invite_expires_at')
      .eq('organization_id', profile.current_organization_id)
      .eq('invite_status', 'pending')
      .order('created_at', { ascending: false });

    const pending = data || [];

    // Auto-mark invites as accepted if the user already has a user_role (they logged in directly)
    const toAccept = pending.filter((inv: any) => inv.user_id);
    if (toAccept.length > 0) {
      for (const inv of toAccept) {
        // Check if this user actually has a role in the org
        const { data: roleCheck } = await (supabase as any)
          .from('user_roles')
          .select('id')
          .eq('user_id', inv.user_id)
          .eq('organization_id', profile.current_organization_id)
          .maybeSingle();
        if (roleCheck) {
          await (supabase as any)
            .from('team_members')
            .update({ invite_status: 'accepted', accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', inv.id);
        }
      }
      // Re-fetch after auto-accepting
      const { data: refreshed } = await (supabase as any)
        .from('team_members')
        .select('id, name, email, role_type, created_at, invite_expires_at')
        .eq('organization_id', profile.current_organization_id)
        .eq('invite_status', 'pending')
        .order('created_at', { ascending: false });
      setPendingInvites(refreshed || []);
    } else {
      setPendingInvites(pending);
    }
  };

  const fetchTeamMembers = async () => {
    if (!profile?.current_organization_id) return;
    
    setLoading(true);
    
    // Get user roles for the organization
    const { data: roles, error: rolesError } = await supabase
      .from('user_roles')
      .select('id, user_id, role, custom_role_id, is_active, created_at')
      .eq('organization_id', profile.current_organization_id);
    
    if (rolesError) {
      toast.error('Error loading team', {
        description: rolesError.message,
      });
      setLoading(false);
      return;
    }
    
    // Get profiles for each user. profiles has no cross-user SELECT policy, so a
    // direct select only returns the viewer's own row — use the org-guarded
    // SECURITY DEFINER RPC, falling back to the direct select if the RPC isn't
    // deployed yet (migration 20260729000001).
    const userIds = roles?.map(r => r.user_id) || [];
    let profiles: Array<{ user_id: string; email: string | null; full_name: string | null; avatar_url: string | null }> = [];
    const { data: rpcProfiles, error: rpcError } = await (supabase as any)
      .rpc('get_org_team_profiles', { _organization_id: profile.current_organization_id });
    if (!rpcError && Array.isArray(rpcProfiles)) {
      profiles = rpcProfiles;
    } else {
      const { data: ownProfiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, email, full_name, avatar_url')
        .in('user_id', userIds);
      if (profilesError) {
        toast.error('Error loading profiles', {
          description: profilesError.message,
        });
        setLoading(false);
        return;
      }
      profiles = ownProfiles || [];
    }
    
    // Fetch custom role names
    const roleIds = (roles || []).map(r => r.custom_role_id).filter(Boolean);
    let customRoleMap: Record<string, string> = {};
    if (roleIds.length > 0) {
      const { data: crData } = await supabase
        .from('custom_roles')
        .select('id, name')
        .in('id', roleIds);
      (crData || []).forEach((cr: { id: string; name: string }) => {
        customRoleMap[cr.id] = cr.name;
      });
    }

    // Fetch team_members to get names for invited users
    const { data: tmRows } = await (supabase as any)
      .from('team_members')
      .select('user_id, name, email')
      .eq('organization_id', profile.current_organization_id)
      .in('invite_status', ['accepted', 'active']);

    const tmByUserId = new Map<string, { name: string; email: string }>();
    for (const tm of (tmRows || [])) {
      if (tm.user_id) tmByUserId.set(tm.user_id, { name: tm.name, email: tm.email });
    }

    // Combine roles with profiles, using team_members name as fallback
    const members: TeamMember[] = (roles || []).map(role => {
      const userProfile = profiles?.find(p => p.user_id === role.user_id);
      const tmInfo = tmByUserId.get(role.user_id);
      return {
        id: role.id,
        user_id: role.user_id,
        email: userProfile?.email || tmInfo?.email || null,
        full_name: userProfile?.full_name || tmInfo?.name || null,
        avatar_url: userProfile?.avatar_url || null,
        role: role.role as AppRole,
        custom_role_id: role.custom_role_id || null,
        custom_role_name: role.custom_role_id ? (customRoleMap[role.custom_role_id] || null) : null,
        is_active: role.is_active !== false,
        created_at: role.created_at,
      };
    });
    
    setTeamMembers(members);
    setLoading(false);
  };

  const handleInvite = async () => {

    if (!inviteEmail || !inviteName || !inviteRole || !inviteRoleType || !profile?.current_organization_id) return;

    setIsInviting(true);

    try {
      const isOwnerRole = inviteRole === 'owner';
      const appRole = isOwnerRole ? 'owner' : 'member';
      const customRoleId = isOwnerRole ? null : inviteRole; // inviteRole is the custom_role UUID

      const res = await supabase.functions.invoke('invite-team-member', {
        body: {
          email: inviteEmail,
          name: inviteName,
          role_type: inviteRoleType,
          app_role: appRole,
          custom_role_id: customRoleId,
          location_ids: inviteLocationIds,
          organization_id: profile.current_organization_id,
          organization_name: organization?.name || 'Your Organization',
          inviter_name: profile.full_name || profile.email || 'Team Owner',
          app_url: window.location.origin,
        },
      });

      // Edge Function always returns 200 with { success, error?, message? }
      if (res.error) {
        // Network error or function crashed
        toast.error('Invite Failed', { description: res.error.message || 'Could not reach server.' });
      } else if (!res.data?.success) {
        toast.error('Invite Failed', { description: res.data?.error || 'Unknown error' });
      } else {
        toast.success('Invite Sent', {
          description: res.data?.message || `Invitation sent to ${inviteEmail}.`,
        });
        await fetchPendingInvites();

        // Register invited user in Central Auth via backend (fire-and-forget)
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
        const customRoleName = customRoleId
          ? customRoles.find((r: { id: string; name: string }) => r.id === customRoleId)?.name || null
          : null;
        fetch(`${backendUrl}/api/register-broadcast/invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: inviteEmail,
            full_name: inviteName,
            user_id: res.data?.auth_user_id || null,
            organization_name: organization?.name || null,
            organization_id: profile?.current_organization_id || null,
            app_role: appRole,
            role_type: inviteRoleType,
            custom_role_name: customRoleName,
            password: res.data?.generated_password || null,
          }),
        }).catch(() => {}); // fire-and-forget
      }
    } catch (err: any) {
      toast.error('Invite Failed', { description: err.message || 'Something went wrong' });
    }

    setIsInviting(false);
    setInviteDialogOpen(false);
    setInviteEmail('');
    setInviteName('');
    setInviteRole('');
    setInviteRoleType('');
    setInviteLocationIds([]);
  };

  const handleCancelInvite = async (inviteId: string) => {
    const { error } = await (supabase as any)
      .from('team_members')
      .update({ invite_status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', inviteId);

    if (error) {
      toast.error('Failed to cancel invitation');
    } else {
      toast.success('Invitation cancelled');
      await fetchPendingInvites();
    }
  };

  const handleResendInvite = async (invite: { id: string; name: string; email: string; role_type: string }) => {
    // Cancel old invite, then send a fresh one with same details
    await (supabase as any)
      .from('team_members')
      .update({ invite_status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', invite.id);

    try {
      const res = await supabase.functions.invoke('invite-team-member', {
        body: {
          email: invite.email,
          name: invite.name,
          role_type: invite.role_type,
          app_role: 'member',
          location_id: null,
          organization_id: profile?.current_organization_id,
          organization_name: organization?.name || 'Your Organization',
          inviter_name: profile?.full_name || profile?.email || 'Team Owner',
          app_url: window.location.origin,
        },
      });

      if (res.data?.success) {
        toast.success('Invite resent', { description: `New invitation sent to ${invite.email}` });
      } else {
        toast.error('Resend failed', { description: res.data?.error || 'Unknown error' });
      }
    } catch (err: any) {
      toast.error('Resend failed', { description: err.message });
    }

    await fetchPendingInvites();

  };

  const handleUpdateRole = async () => {
    if (!selectedMember || !profile?.current_organization_id) return;

    const orgId = profile.current_organization_id;

    // 1. Update user_roles (permission level)
    const isSettingOwner = selectedMember.role === 'owner' && !selectedMember.custom_role_id;
    const updateData = isSettingOwner
      ? { role: 'owner' as AppRole, custom_role_id: null }
      : { role: selectedMember.role, custom_role_id: selectedMember.custom_role_id };


    const { error } = await supabase
      .from('user_roles')
      .update({ role: selectedMember.role })
      .eq('id', selectedMember.id);
    
    if (error) {

      toast.error('Error updating role', { description: error.message });
      return;
    }

    // 2. Update team_members (name, role_type)
    const memberEmail = (selectedMember.email || '').toLowerCase();
    if (memberEmail) {
      await (supabase as any)
        .from('team_members')
        .update({ name: editName, role_type: editRoleType || undefined, updated_at: new Date().toISOString() })
        .eq('organization_id', orgId)
        .eq('email', memberEmail)
        .in('invite_status', ['accepted', 'active']);
    }

    // 3. Update profile name
    if (selectedMember.user_id && editName) {
      await (supabase as any)
        .from('profiles')
        .update({ full_name: editName })
        .eq('user_id', selectedMember.user_id);
    }

    // 4. Sync provider locations — remove old, add new
    const nonProviderRoles = ['other', 'receptionist', 'practice manager'];
    if (memberEmail && editRoleType && !nonProviderRoles.includes(editRoleType.toLowerCase())) {
      // Get existing provider IDs for this user+org
      const { data: existingProviders } = await (supabase as any)
        .from('providers')
        .select('id, location_id')
        .eq('organization_id', orgId)
        .eq('email', memberEmail);

      const existingLocIds = (existingProviders || []).map((p: any) => p.location_id).filter(Boolean);
      const newLocIds = editLocationIds.length > 0 ? editLocationIds : [null];

      // Delete providers at locations no longer selected
      for (const prov of (existingProviders || [])) {
        if (prov.location_id && !editLocationIds.includes(prov.location_id)) {
          await (supabase as any).from('providers').delete().eq('id', prov.id);
        }
      }

      // Add providers at newly selected locations
      for (const locId of newLocIds) {
        if (locId && !existingLocIds.includes(locId)) {
          await (supabase as any).from('providers').insert({
            organization_id: orgId,
            name: editName,
            email: memberEmail,
            provider_role: editRoleType,
            location_id: locId,
            is_active: true,
            user_id: selectedMember.user_id,
          });
        }
      }

      // Update provider_role on remaining providers
      await (supabase as any)
        .from('providers')
        .update({ provider_role: editRoleType, name: editName })
        .eq('organization_id', orgId)
        .eq('email', memberEmail);
    }

    toast.success('Member updated');
    await fetchTeamMembers();

    setEditDialogOpen(false);
    setSelectedMember(null);
  };

  const handleRemoveMember = async (member: TeamMember) => {
    if (!profile?.current_organization_id) return;
    
    const { error } = await supabase
      .from('user_roles')
      .delete()
      .eq('id', member.id);
    
    if (error) {
      toast.error('Error removing member', {
        description: error.message,
      });
    } else {
      toast.success('Member removed', {
        description: `${member.full_name || member.email} has been removed from the team.`,
      });
      await fetchTeamMembers();
    }
  };

  const handleToggleActive = async (member: TeamMember) => {
    const newStatus = !member.is_active;
    const { error } = await supabase
      .from('user_roles')
      .update({ is_active: newStatus })
      .eq('id', member.id);

    if (error) {
      toast.error('Error updating member status', { description: error.message });
    } else {
      toast.success(newStatus ? 'Member enabled' : 'Member disabled', {
        description: `${member.full_name || member.email} has been ${newStatus ? 'enabled' : 'disabled'} for this organization.`,
      });
      await fetchTeamMembers();
    }
  };

  const getRoleBadgeVariant = (member: TeamMember) => {
    if (member.role === 'owner') return 'default' as const;
    if (member.custom_role_name) return 'secondary' as const;
    return 'outline' as const;
  };

  const getRoleDisplayName = (member: TeamMember) => {
    if (member.role === 'owner') return 'Owner';
    if (member.custom_role_name) return member.custom_role_name;
    return member.role.charAt(0).toUpperCase() + member.role.slice(1);
  };

  const getInitials = (name: string | null, email: string | null) => {
    if (name) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    return email?.slice(0, 2).toUpperCase() || '??';
  };

  // Check if user is owner
  if (!isOwner()) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
          <Shield className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-2xl font-bold text-foreground mb-2">Access Denied</h2>
          <p className="text-muted-foreground mb-4">
            Only organization owners can access team management.
          </p>
          <Button onClick={() => navigate('/')} variant="outline">
            Return to Dashboard
          </Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <Helmet>
        <title>Team Members</title>
        <meta name="description" content="Manage team member accounts, roles, permissions, and access control for your organization." />
      </Helmet>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Users className="w-6 h-6" />
              Team Management
            </h1>
            <p className="text-muted-foreground">Manage team members and their roles</p>
          </div>
          {can('team_management', 'add', 'page_access') && (
          <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <UserPlus className="w-4 h-4" />
                Invite Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Team Member</DialogTitle>
                <DialogDescription>
                  Send an invitation to join your organization.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="John Smith"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="colleague@example.com"
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Locations</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-between font-normal h-auto min-h-10 py-2">
                        <span className="truncate text-left">
                          {inviteLocationIds.length === 0
                            ? 'Select locations...'
                            : inviteLocationIds.length === 1
                              ? (allAvailableLocations.find(l => l.id === inviteLocationIds[0]) as any)?.location_name || '1 selected'
                              : `${inviteLocationIds.length} locations selected`}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search locations..." />
                        <CommandList>
                          <CommandEmpty>No locations found.</CommandEmpty>
                          <CommandGroup>
                            {allAvailableLocations.map((loc) => {
                              const locId = loc.id;
                              const locName = (loc as any).location_name || loc.id;
                              const selected = inviteLocationIds.includes(locId);
                              return (
                                <CommandItem
                                  key={locId}
                                  value={locName}
                                  onSelect={() => {
                                    setInviteLocationIds(prev =>
                                      selected ? prev.filter(id => id !== locId) : [...prev, locId]
                                    );
                                  }}
                                >
                                  <Check className={`mr-2 h-4 w-4 ${selected ? 'opacity-100' : 'opacity-0'}`} />
                                  {locName}
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Practice Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select practice role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">Owner</SelectItem>
                      {customRoles.map((cr) => (
                        <SelectItem key={cr.id} value={cr.id}>{cr.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {inviteRole === 'owner' && 'Full access including team management and billing.'}
                    {inviteRole && inviteRole !== 'owner' && 'Permissions are configured in Roles & Permissions.'}
                    {!inviteRole && 'Controls what the member can access in DentPulse.'}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleInvite} disabled={!inviteEmail || !inviteName || !inviteRole || !inviteRoleType || isInviting}>
                  {isInviting ? 'Sending...' : 'Send Invite'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          )}
        </div>

        {/* Team Members Table */}
        <Card>
          <CardHeader>
            <CardTitle>Team Members</CardTitle>
            <CardDescription>
              {teamMembers.length} member{teamMembers.length !== 1 ? 's' : ''} in your organization
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : teamMembers.length === 0 ? (
              <div className="text-center py-8">
                <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No team members yet.</p>
                <p className="text-sm text-muted-foreground">Invite your first team member to get started.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamMembers.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-10 h-10">
                            <AvatarImage src={member.avatar_url || undefined} />
                            <AvatarFallback className="bg-primary/10 text-primary">
                              {getInitials(member.full_name, member.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-foreground">
                              {member.full_name || 'Unnamed User'}
                            </p>
                            <p className="text-sm text-muted-foreground">{member.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getRoleBadgeVariant(member)} className="gap-1">
                          <Shield className="w-3 h-3" />
                          {getRoleDisplayName(member)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {member.role === 'owner' ? (
                          <Badge variant="default" className="bg-green-100 text-green-700 hover:bg-green-100">Active</Badge>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={member.is_active}
                                  onCheckedChange={() => handleToggleActive(member)}
                                  disabled={!can('team_management', 'update', 'page_access')}
                                />
                                <span className={`text-xs font-medium ${member.is_active ? 'text-green-600' : 'text-red-500'}`}>
                                  {member.is_active ? 'Active' : 'Disabled'}
                                </span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{member.is_active ? 'Disable this member' : 'Enable this member'} for this organization</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(member.created_at).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {can('team_management', 'update', 'page_access') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={async () => {
                                setSelectedMember(member);
                                setEditName(member.full_name || '');
                                setEditEmail(member.email || '');
                                // Load team_members data for practice role
                                const { data: tmRow } = await (supabase as any)
                                  .from('team_members')
                                  .select('role_type')
                                  .eq('organization_id', profile?.current_organization_id)
                                  .eq('email', (member.email || '').toLowerCase())
                                  .in('invite_status', ['accepted', 'active'])
                                  .maybeSingle();
                                setEditRoleType(tmRow?.role_type || '');
                                // Load provider locations
                                const { data: provRows } = await (supabase as any)
                                  .from('providers')
                                  .select('location_id')
                                  .eq('organization_id', profile?.current_organization_id)
                                  .eq('email', (member.email || '').toLowerCase())
                                  .eq('is_active', true);
                                setEditLocationIds((provRows || []).map((p: any) => p.location_id).filter(Boolean));
                                setEditDialogOpen(true);
                              }}
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                          )}
                          {member.role !== 'owner' && can('team_management', 'delete', 'page_access') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleRemoveMember(member)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>


        {/* Pending Invitations */}
        {pendingInvites.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-500" />
                Pending Invitations
              </CardTitle>
              <CardDescription>
                {pendingInvites.length} pending invitation{pendingInvites.length !== 1 ? 's' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingInvites.map(invite => (
                    <TableRow key={invite.id}>
                      <TableCell className="font-medium">{invite.name}</TableCell>
                      <TableCell className="text-muted-foreground">{invite.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{invite.role_type}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(invite.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {invite.invite_expires_at ? new Date(invite.invite_expires_at).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        {can('team_management', 'update', 'page_access') && (
                          <Button variant="ghost" size="sm" onClick={() => handleResendInvite(invite)} title="Resend">
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                        )}
                        {can('team_management', 'delete', 'page_access') && (
                          <Button variant="ghost" size="sm" onClick={() => handleCancelInvite(invite.id)} title="Cancel" className="text-red-500 hover:text-red-600">
                            <XCircle className="w-4 h-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Role Permissions Link */}
        <Card>
          <CardHeader>
            <CardTitle>Role Permissions</CardTitle>
            <CardDescription>Configure custom roles and fine-grained permissions for your team</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="gap-2" onClick={() => navigate('/roles-permissions')}>
              <Shield className="w-4 h-4" />
              Manage Roles & Permissions
            </Button>
          </CardContent>
        </Card>

        {/* Edit Role Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Team Member</DialogTitle>
              <DialogDescription>
                Update details for {selectedMember?.full_name || selectedMember?.email}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">

                <Label>Full Name</Label>
                <Input value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={editEmail} disabled className="bg-gray-50" />
              </div>
              <div className="space-y-2">
                <Label>Practice Role</Label>
                <Select value={editRoleType} onValueChange={setEditRoleType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select practice role" />
                  </SelectTrigger>
                  <SelectContent>
                    {practiceRoleTypes.map((rt) => (
                      <SelectItem key={rt} value={rt}>{rt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Locations</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between font-normal h-auto min-h-10 py-2">
                      <span className="truncate text-left">
                        {editLocationIds.length === 0
                          ? 'Select locations...'
                          : editLocationIds.length === 1
                            ? (allAvailableLocations.find(l => l.id === editLocationIds[0]) as any)?.location_name || '1 selected'
                            : `${editLocationIds.length} locations selected`}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search locations..." />
                      <CommandList>
                        <CommandEmpty>No locations found.</CommandEmpty>
                        <CommandGroup>
                          {allAvailableLocations.map((loc) => {
                            const locId = loc.id;
                            const locName = (loc as any).location_name || loc.id;
                            const selected = editLocationIds.includes(locId);
                            return (
                              <CommandItem
                                key={locId}
                                value={locName}
                                onSelect={() => {
                                  setEditLocationIds(prev =>
                                    selected ? prev.filter(id => id !== locId) : [...prev, locId]
                                  );
                                }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${selected ? 'opacity-100' : 'opacity-0'}`} />
                                {locName}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>Permission Level</Label>
                <Select
                  value={
                    selectedMember?.role === 'owner'
                      ? 'owner'
                      : selectedMember?.custom_role_id
                        || customRoles.find(cr => cr.name.toLowerCase() === (selectedMember?.role || ''))?.id
                        || customRoles[0]?.id
                        || ''
                  }
                  onValueChange={(v) => {
                    if (v === 'owner') {
                      setSelectedMember(prev => prev ? { ...prev, role: 'owner' as AppRole, custom_role_id: null, custom_role_name: 'Owner' } : null);
                    } else {
                      const cr = customRoles.find(r => r.id === v);
                      setSelectedMember(prev => prev ? { ...prev, role: prev.role === 'owner' ? 'member' as AppRole : prev.role, custom_role_id: v, custom_role_name: cr?.name || null } : null);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select permission level" />

                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    {customRoles.map((cr) => (
                      <SelectItem key={cr.id} value={cr.id}>{cr.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleUpdateRole}>
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
