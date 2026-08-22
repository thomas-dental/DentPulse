import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Display name of the practice's membership plan provider.
 *
 * The REAL signal is what the org actually uploads (client 2026-08-20:
 * "make sure the practice plan and denplan text show correctly based on
 * uploads"): a Practice Plan statement PDF marker on the latest uploaded
 * row → "Practice Plan", a Denplan-style sheet row → "Denplan". The
 * useMembershipProviderLabel hook resolves that live; the sync
 * membershipProviderLabel() (for non-hook callers) falls back to the
 * per-org override map below, then the Denplan default. Keep known
 * Practice Plan orgs in the map so the sync callers agree with the hook.
 */
const PROVIDER_OVERRIDES: Record<string, string> = {
  // The Old Surgery Dental Practice at Queens Street
  '739fb423-9aa5-46ae-8b6e-71f147d72530': 'Practice Plan',
  // St Catherine's Dental Practice (Appoline group) — uploads PP statements
  'a5892c50-2ac1-4190-9fee-d79bb48878c5': 'Practice Plan',
};

export const DEFAULT_MEMBERSHIP_PROVIDER = 'Denplan';

export function membershipProviderLabel(organizationId?: string | null): string {
  return PROVIDER_OVERRIDES[organizationId ?? ''] ?? DEFAULT_MEMBERSHIP_PROVIDER;
}

/**
 * Provider label for the signed-in user's current organization, derived
 * from the org's latest membership upload when one exists. Shares the
 * query key (and therefore the cache) with useMembershipUploadData's own
 * upload-presence check — the queryFn must stay identical to it.
 */
export function useMembershipProviderLabel(): string {
  const { user, profile } = useAuth();
  const organizationId = profile?.current_organization_id ?? null;

  const { data } = useQuery<{ hasAny: boolean; source: 'practice-plan' | 'sheet' | null }>({
    queryKey: ['membership_upload_has_any_v2', organizationId],
    enabled: !!user?.id && !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: rows, error } = await (supabase as any)
        .from('membership_upload_members')
        .select('explanatory_text')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('upload_year', { ascending: false })
        .order('upload_month', { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = ((rows ?? []) as Array<{ explanatory_text: string | null }>)[0];
      if (!row) return { hasAny: false, source: null };
      return {
        hasAny: true,
        source: row.explanatory_text === 'Practice Plan statement' ? ('practice-plan' as const) : ('sheet' as const),
      };
    },
  });

  if (data?.hasAny && data.source) {
    return data.source === 'practice-plan' ? 'Practice Plan' : DEFAULT_MEMBERSHIP_PROVIDER;
  }
  return membershipProviderLabel(organizationId);
}
