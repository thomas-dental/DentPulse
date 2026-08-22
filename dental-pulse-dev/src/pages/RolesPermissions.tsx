import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ShieldCheck, UserPlus } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import { RoleList } from '@/components/roles/RoleList';
import { PermissionMatrix } from '@/components/roles/PermissionMatrix';

export default function RolesPermissions() {
  const navigate = useNavigate();
  const { isOwner, loading } = useUserRole();
  const { isModuleEnabled, loading: moduleLoading } = useModuleAccess();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [selectedRoleName, setSelectedRoleName] = useState('');

  const handleSelectRole = (roleId: string, roleName: string) => {
    setSelectedRoleId(roleId || null);
    setSelectedRoleName(roleName);
  };

  // Org-wide module gate (SuperAdmin) — blocks direct-URL access when disabled,
  // even for owners.
  if (!loading && !moduleLoading && !isModuleEnabled('roles_permissions')) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center">
            <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground mb-4">This module has been disabled for your organization. Contact your administrator if you need access.</p>
            <Button onClick={() => navigate('/')}>Go to Dashboard</Button>
          </div>
        </div>
      </MainLayout>
    );
  }

  // Owner-only guard
  if (!loading && !isOwner()) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center">
            <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground mb-4">Only the organization owner can manage roles and permissions.</p>
            <Button onClick={() => navigate('/')}>Go to Dashboard</Button>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <Helmet>
        <title>Roles & Permissions | DentPulse Enterprise</title>
      </Helmet>

      <div className="flex flex-col h-[calc(100vh-4rem)]">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldCheck className="w-6 h-6" />
              Roles & Permissions
            </h1>
            <p className="text-sm text-muted-foreground">
              Create custom roles and configure granular access to every module and card
            </p>
          </div>
          <Button onClick={() => navigate('/team')} className="gap-2">
            <UserPlus className="w-4 h-4" />
            Invite Member
          </Button>
        </div>

        {/* Two-panel layout */}
        <div className="flex gap-4 flex-1 min-h-0">
          {/* Left: Role List */}
          <Card className="w-[300px] flex-shrink-0">
            <CardContent className="p-4 h-full">
              <RoleList
                selectedRoleId={selectedRoleId}
                onSelectRole={handleSelectRole}
              />
            </CardContent>
          </Card>

          {/* Right: Permission Matrix */}
          <Card className="flex-1 min-w-0">
            <CardContent className="p-4 h-full flex flex-col">
              <PermissionMatrix
                selectedRoleId={selectedRoleId}
                selectedRoleName={selectedRoleName}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
