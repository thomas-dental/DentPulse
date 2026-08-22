import { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface PlatformAdminRouteProps {
  children: ReactNode;
}

// Gate for platform-wide (not org-scoped) admin surfaces, e.g. setting an
// organization's subscription plan. Separate from PermissionProtectedRoute,
// which gates org-scoped modules via RBAC/module-access/plan — this instead
// checks profiles.is_platform_admin, a flag with no per-org meaning.
export function PlatformAdminRoute({ children }: PlatformAdminRouteProps) {
  const { profile, loading, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const isPlatformAdmin = !!profile?.is_platform_admin;

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated || !isPlatformAdmin) {
      navigate('/', { replace: true });
    }
  }, [loading, isAuthenticated, isPlatformAdmin, navigate]);

  if (loading || !isAuthenticated || !isPlatformAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
