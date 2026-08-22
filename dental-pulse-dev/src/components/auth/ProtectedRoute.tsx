import { ReactNode, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, loading, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate('/auth', { replace: true });
      return;
    }

    // Redirect to onboarding if user has no organization and not already on onboarding page
    if (!loading && isAuthenticated && profile !== null) {
      const needsOnboarding = !profile.current_organization_id;
      const isOnOnboardingPage = location.pathname === '/onboarding';

      if (needsOnboarding && !isOnOnboardingPage) {
        navigate('/onboarding', { replace: true });
      }
    }
  }, [isAuthenticated, loading, navigate, profile, location.pathname]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Show spinner while ProtectedRoute's useEffect redirects to /auth
    // prevents a blank white flash between logout and the /auth page loading
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
