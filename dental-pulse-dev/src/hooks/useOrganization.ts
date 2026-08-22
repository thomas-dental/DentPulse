import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface Organization {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  logo_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  plan_tier: string;
}

export function useOrganization(organizationId?: string) {
  const { profile, loading: profileLoading, user } = useAuth();
  const [currentOrgId, setCurrentOrgId] = useState<string | undefined>(organizationId);
  const [isOrgIdLoading, setIsOrgIdLoading] = useState(true);

  useEffect(() => {
    const getOrganizationId = async () => {
      if (organizationId) {
        setCurrentOrgId(organizationId);
        setIsOrgIdLoading(false);
        return;
      }

      if (profileLoading) {
        // Still loading profile
        return;
      }

      // First try from profile
      if (profile?.current_organization_id) {
        setCurrentOrgId(profile.current_organization_id);
        setIsOrgIdLoading(false);
        return;
      }

      // Fallback: get from user_roles if user exists
      if (user?.id) {
        try {
          const { data } = await supabase
            .from('user_roles')
            .select('organization_id')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle();

          if (data?.organization_id) {
            setCurrentOrgId(data.organization_id);
          } else {
            setCurrentOrgId(undefined);
          }
        } catch (error) {
          console.error('Error fetching organization ID:', error);
          setCurrentOrgId(undefined);
        }
      } else {
        setCurrentOrgId(undefined);
      }

      setIsOrgIdLoading(false);
    };

    getOrganizationId();
  }, [organizationId, profile?.current_organization_id, profileLoading, user?.id]);

  const {
    data: organization,
    isLoading: queryLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['organization', currentOrgId],
    queryFn: async () => {
      if (!currentOrgId) return null;

      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', currentOrgId)
        .single();

      if (error) throw error;
      return data as Organization;
    },
    enabled: !!currentOrgId,
  });

  // Combine loading states:
  // - If profile is loading or we're still fetching org ID, we're loading
  // - If we have orgId, check if query is loading
  const isLoading = profileLoading || isOrgIdLoading || (!!currentOrgId && queryLoading);

  return {
    organization,
    isLoading,
    error,
    refetch,
    organizationId: currentOrgId,
  };
}
