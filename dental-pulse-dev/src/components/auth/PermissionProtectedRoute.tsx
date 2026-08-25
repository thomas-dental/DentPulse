import { ReactNode, useMemo, useEffect } from 'react';
import { ProtectedRoute } from './ProtectedRoute';
import { usePermissions } from '@/hooks/usePermissions';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import { Shield } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';

// Module-to-route mapping for finding the first accessible page
const MODULE_ROUTES: { module: string; path: string; label: string }[] = [
  { module: 'dashboard', path: '/', label: 'Dashboard' },
  { module: 'performance', path: '/performance', label: 'Performance' },
  { module: 'locations', path: '/locations', label: 'Locations' },
  { module: 'providers', path: '/providers/dentist', label: 'Providers' },
  { module: 'cash_flow', path: '/cashflow/preparing-statement', label: 'Cash Flow' },
  { module: 'profitability', path: '/profitability', label: 'Profitability' },
  { module: 'budget', path: '/budget', label: 'Budget' },
  { module: 'tax', path: '/tax', label: 'Tax' },
];

interface PermissionProtectedRouteProps {
  children: ReactNode;
  module: string;  // permissionRegistry module key
  card?: string;   // optional card key for tab-level route protection
}

/**
 * Wraps ProtectedRoute with module-level permission check.
 * Owner always has access. Other roles need at least one 'view' permission
 * in the module. When `card` is provided, also checks card-level 'view' permission.
 * Falls back to Access Denied page.
 */
export function PermissionProtectedRoute({ children, module, card }: PermissionProtectedRouteProps) {
  return (
    <ProtectedRoute>
      <ModuleGuard module={module} card={card}>{children}</ModuleGuard>
    </ProtectedRoute>
  );
}

function ModuleGuard({ module, card, children }: { module: string; card?: string; children: ReactNode }) {
  const { can, canAccessModule, isOwner, loading } = usePermissions();
  const { isModuleEnabled, loading: moduleAccessLoading } = useModuleAccess();
  const navigate = useNavigate();
  const location = useLocation();

  const ready = !loading && !moduleAccessLoading;

  // First route that is both enabled org-wide AND accessible to this user.
  const firstAccessibleRoute = useMemo(() => {
    if (!ready) return null;
    for (const route of MODULE_ROUTES) {
      if (!isModuleEnabled(route.module)) continue;
      if (isOwner || canAccessModule(route.module)) return route;
    }
    return null;
  }, [canAccessModule, isModuleEnabled, isOwner, ready]);

  // Org-wide module gate (SuperAdmin) — applies to everyone, even owners.
  const moduleDisabled = ready && !isModuleEnabled(module);
  const lacksPermission = ready && !isOwner && !canAccessModule(module);

  // Auto-redirect silently to a page the user can actually open.
  const shouldRedirect = (moduleDisabled || lacksPermission) && !!firstAccessibleRoute;

  useEffect(() => {
    if (shouldRedirect && firstAccessibleRoute) {
      navigate(firstAccessibleRoute.path, { replace: true });
    }
  }, [shouldRedirect, firstAccessibleRoute, navigate]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // If redirecting, show spinner instead of an Access Denied flash.
  if (shouldRedirect) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Module disabled for this org and nowhere to redirect — block outright.
  if (moduleDisabled) {
    return (
      <AccessDenied
        message="This module has been disabled for your organization. Contact your administrator if you need access."
        firstAccessibleRoute={firstAccessibleRoute}
        navigate={navigate}
      />
    );
  }

  if (isOwner) {
    return <>{children}</>;
  }

  if (canAccessModule(module)) {
    // If a card key is specified, also check card-level view permission
    if (card && !can(module, 'view', card)) {
      // User has module access but not this specific tab/card
      return (
        <AccessDenied
          message="You don't have permission to access this section. Contact your organization owner to update your role permissions."
          firstAccessibleRoute={firstAccessibleRoute}
          navigate={navigate}
        />
      );
    }
    return <>{children}</>;
  }

  // No accessible page found at all — show Access Denied as last resort
  return (
    <AccessDenied
      message="You don't have permission to access this page. Contact your organization owner to update your role permissions."
      firstAccessibleRoute={firstAccessibleRoute}
      navigate={navigate}
    />
  );
}

function AccessDenied({
  message,
  firstAccessibleRoute,
  navigate,
}: {
  message: string;
  firstAccessibleRoute: { path: string; label: string } | null;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const targetPath = firstAccessibleRoute?.path || '/';
  const targetLabel = firstAccessibleRoute?.label || 'Dashboard';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Shield className="w-8 h-8 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Access Denied</h1>
        <p className="text-muted-foreground mb-6">{message}</p>
        <Button onClick={() => navigate(targetPath)} variant="outline">
          Go to {targetLabel}
        </Button>
      </div>
    </div>
  );
}
