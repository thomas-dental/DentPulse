import { useState, useEffect, useRef, createContext, useContext, ReactNode, createElement } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export interface Profile {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  current_organization_id: string | null;
  is_platform_admin?: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ data: any; error: any }>;
  signIn: (email: string, password: string) => Promise<{ data: any; error: any }>;
  signOut: () => Promise<{ error: any }>;
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: any }>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchingProfileRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    let initialSessionFetched = false;

    const fetchProfile = async (userId: string) => {
      // Prevent duplicate calls for the same user
      if (fetchingProfileRef.current.has(userId)) {
        return;
      }

      fetchingProfileRef.current.add(userId);

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();

        if (!error && data && mounted) {
          // If profile has no current_organization_id, check user_roles for an active org
          // This handles invited users who have a role but no org set on profile yet
          if (!data.current_organization_id) {
            const { data: roleData } = await supabase
              .from('user_roles')
              .select('organization_id, is_active')
              .eq('user_id', userId)
              .eq('is_active', true)
              .limit(1)
              .maybeSingle();

            if (roleData?.organization_id) {
              // Auto-set the organization on their profile
              await supabase
                .from('profiles')
                .update({ current_organization_id: roleData.organization_id })
                .eq('user_id', userId);
              data.current_organization_id = roleData.organization_id;
            } else {
              // Check if user has roles but all disabled
              const { data: anyRoles } = await supabase
                .from('user_roles')
                .select('id')
                .eq('user_id', userId)
                .limit(1);

              if (anyRoles && anyRoles.length > 0) {
                // All orgs disabled — sign out
                await supabase.auth.signOut();
                setUser(null);
                setSession(null);
                setProfile(null);
                return;
              }
            }
          } else {
            // Check if the user is active in their current organization
            const { data: roleCheck } = await supabase
              .from('user_roles')
              .select('is_active')
              .eq('user_id', userId)
              .eq('organization_id', data.current_organization_id)
              .maybeSingle();

            if (roleCheck && roleCheck.is_active === false) {
              // User is disabled in this org — try to find another active org
              const { data: altRole } = await supabase
                .from('user_roles')
                .select('organization_id')
                .eq('user_id', userId)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle();

              if (altRole?.organization_id) {
                // Switch to an active org
                await supabase
                  .from('profiles')
                  .update({ current_organization_id: altRole.organization_id })
                  .eq('user_id', userId);
                data.current_organization_id = altRole.organization_id;
              } else {
                // No active orgs — sign the user out
                await supabase.auth.signOut();
                setUser(null);
                setSession(null);
                setProfile(null);
                return;
              }
            }
          }
          setProfile(data);
        }
      } finally {
        fetchingProfileRef.current.delete(userId);
      }
    };

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;

        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          // Always fetch profile on SIGNED_IN (new login), or on initial load
          // Use setTimeout to avoid async-in-lock deadlock (Supabase warning)
          if (event === 'SIGNED_IN' || !initialSessionFetched) {
            setTimeout(() => {
              if (mounted) fetchProfile(session.user.id);
            }, 0);
          }
        } else {
          setProfile(null);
          // Ensure loading is cleared on sign-out
          if (event === 'SIGNED_OUT') {
            setLoading(false);
          }
        }
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;

      initialSessionFetched = true;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const checkDuplicate = async (email: string): Promise<{ exists: boolean; message?: string } | null> => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
    try {
      const res = await fetch(`${backendUrl}/api/check-duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await res.json();
      return body?.data || null;
    } catch {
      // If check fails, allow signup to proceed
      return null;
    }
  };

  const signUp = async (email: string, password: string, fullName?: string) => {
    // Pre-check: duplication across Supabase + Central Auth
    const dupCheck = await checkDuplicate(email);
    if (dupCheck?.exists) {
      return {
        data: { user: null, session: null },
        error: { message: dupCheck.message || 'An account with this email already exists.' },
      };
    }

    // Redirect to onboarding page after email confirmation
    // ProtectedRoute will handle redirecting users who already have an organization
    const redirectUrl = `${window.location.origin}/onboarding`;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });

    // Register in Central Auth with password (non-blocking)
    if (!error && data?.user) {
      registerUserInCentralAuth(email, fullName || null, data.user.id, password);
    }

    return { data, error };
  };

  const registerUserInCentralAuth = async (email: string, fullName: string | null, userId?: string, password?: string) => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

    // Build headers — include session token if available (not available at signup time)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (currentSession?.access_token) {
      headers['Authorization'] = `Bearer ${currentSession.access_token}`;
    }

    try {
      await fetch(`${backendUrl}/api/register-broadcast`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email,
          full_name: fullName,
          user_id: userId || null, // Supabase user ID — backend verifies via admin API
          password: password || null, // Plain password — backend hashes before sending to Central Auth
        }),
      });
      console.log('[central-auth] User registration broadcast sent');
    } catch (err) {
      console.warn('[central-auth] User registration broadcast failed:', err);
    }
  };

  const signIn = async (email: string, password: string) => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

    // Step 1: Check user status — is this a provisioned user with password not yet set?
    let needsCentralAuth = false;
    let userCentralAuthId: string | null = null;
    try {
      const checkRes = await fetch(`${backendUrl}/api/auth/check-user?email=${encodeURIComponent(email)}`);
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        const { exists, source_platform, password_set, central_auth_id } = checkData.data || {};
        userCentralAuthId = central_auth_id || null;
        // Provisioned user: belongs to another platform AND password not set in Supabase
        if (exists && source_platform && !password_set) {
          needsCentralAuth = true;
        }
      }
    } catch {
      // If check fails, proceed with normal Supabase login
    }

    // Step 2: If provisioned user with unset password → verify via Central Auth first
    if (needsCentralAuth) {
      const baseUrl = import.meta.env.VITE_CENTRAL_AUTH_BASE_URL;
      if (baseUrl) {
        try {
          const loginPayload: Record<string, string> = { email, password, platform: 'dentalpulse' };
          if (userCentralAuthId) loginPayload.universal_id = userCentralAuthId;
          const caRes = await fetch(`${baseUrl}/auth/platform-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loginPayload),
          });

          if (caRes.ok) {
            const caBody = await caRes.json();
            const token = caBody?.data?.access_token;

            // Central Auth verified — set password in Supabase + update flag
            if (token) {
              await fetch(`${backendUrl}/api/set-password`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ email, password }),
              });
              console.log('[central-auth] Password set in Supabase for provisioned user');
            }
          } else {
            // Central Auth rejected — wrong password
            return {
              data: null,
              error: { message: 'Invalid login credentials' },
            };
          }
        } catch (err) {
          console.warn('[central-auth] Verification failed:', err);
          return {
            data: null,
            error: { message: 'Unable to verify credentials. Please try again.' },
          };
        }
      }
    }

    // Step 3: Supabase login (works for both normal users and provisioned users after password set)
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (!error && data?.user) {
      // Check if user has at least one active org membership
      const { data: activeRoles } = await supabase
        .from('user_roles')
        .select('id')
        .eq('user_id', data.user.id)
        .eq('is_active', true)
        .limit(1);

      // Only block if user HAS roles but ALL are disabled
      // (users with zero roles are new / going through onboarding)
      if (activeRoles && activeRoles.length === 0) {
        const { data: anyRoles } = await supabase
          .from('user_roles')
          .select('id')
          .eq('user_id', data.user.id)
          .limit(1);

        if (anyRoles && anyRoles.length > 0) {
          // User exists in orgs but is disabled in all of them
          await supabase.auth.signOut();
          return {
            data: null,
            error: { message: 'Your account has been disabled. Please contact your organization administrator.' },
          };
        }
      }

      // Auto-login to Central Auth (non-blocking)
      loginToCentralAuth(email, password);
    }

    return { data, error };
  };

  const signOut = async () => {
    // Always clear local state first so UI reacts immediately
    setUser(null);
    setSession(null);
    setProfile(null);

    // Then tell Supabase to sign out (clear server session + localStorage token)
    const { error } = await supabase.auth.signOut();

    // Even if signOut fails, clear localStorage auth tokens to prevent stale session
    if (error) {
      console.error('signOut error, forcing local cleanup:', error);
      // Remove Supabase auth keys from localStorage
      const keysToRemove = Object.keys(localStorage).filter(
        (k) => k.startsWith('sb-') && k.endsWith('-auth-token')
      );
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    }

    // Clear session storage filters (global + page-local)
    try {
      sessionStorage.removeItem('dentpulse_filters');
      sessionStorage.removeItem('dentpulse_cashflow_statement_dates');
    } catch { /* ignore */ }

    return { error };
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) return { error: new Error('Not authenticated') };

    // Prevent duplicate update calls
    if (fetchingProfileRef.current.has(user.id)) {
      return { error: null };
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('user_id', user.id);

    if (!error && profile) {
      // Update profile state directly without fetching again
      setProfile({
        ...profile,
        ...updates,
      });

      // Sync profile changes to Central Auth (non-blocking)
      syncProfileToCentralAuth(profile.email, updates);
    }

    return { error };
  };

  const loginToCentralAuth = async (email: string, password: string) => {
    const baseUrl = import.meta.env.VITE_CENTRAL_AUTH_BASE_URL;
    if (!baseUrl) return;
    const platformLoginUrl = `${baseUrl}/auth/platform-login`;

    try {
      const res = await fetch(platformLoginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, platform: 'dentalpulse' }),
      });

      if (res.ok) {
        const data = await res.json();
        const token = data?.data?.access_token;
        if (token) {
          localStorage.setItem('central_auth_token', token);
          console.log('[central-auth] Platform login successful');
        }
      }
    } catch (err) {
      console.warn('[central-auth] Platform login error:', err);
    }
  };

  const broadcastPasswordChange = async (email: string, newPassword: string) => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

    const { data: { session: currentSession } } = await supabase.auth.getSession();
    const centralAuthToken = localStorage.getItem('central_auth_token');

    // Build headers — session may not exist at signup time
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (currentSession?.access_token) {
      headers['Authorization'] = `Bearer ${currentSession.access_token}`;
    }
    if (centralAuthToken) {
      headers['X-Central-Auth-Token'] = centralAuthToken;
    }

    try {
      await fetch(`${backendUrl}/api/password-broadcast`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, new_password: newPassword }),
      });
      console.log('[password-sync] Password broadcast sent');
    } catch (err) {
      console.warn('[password-sync] Password broadcast failed:', err);
    }
  };

  const syncProfileToCentralAuth = async (email: string | null, updates: Partial<Profile>) => {
    if (!email) return;

    const baseUrl = import.meta.env.VITE_CENTRAL_AUTH_BASE_URL;
    if (!baseUrl) return;
    const centralAuthSyncUrl = `${baseUrl}/profile-sync`;

    const token = localStorage.getItem('central_auth_token');
    if (!token) return;

    const changes: Record<string, string | null> = {};
    if (updates.full_name !== undefined) changes.full_name = updates.full_name;
    if (updates.avatar_url !== undefined) changes.avatar_url = updates.avatar_url;

    if (Object.keys(changes).length === 0) return;

    try {
      const payload: Record<string, unknown> = {
        source_platform: 'dentalpulse',
        email,
        changes,
      };
      if (profile?.central_auth_id) {
        payload.universal_id = profile.central_auth_id;
      }
      await fetch(centralAuthSyncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn('[profile-sync] Failed to sync to Central Auth:', err);
    }
  };

  const value: AuthContextType = {
    user,
    session,
    profile,
    loading,
    signUp,
    signIn,
    signOut,
    updateProfile,
    isAuthenticated: !!session,
  };

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
