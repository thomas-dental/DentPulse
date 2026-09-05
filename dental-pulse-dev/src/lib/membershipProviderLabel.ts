import { useAuth } from '@/hooks/useAuth';

/**
 * Display name of the practice's membership plan provider.
 *
 * Most client practices are on Denplan, so that is the default everywhere the
 * UI names the provider (forecast rows, settings, membership upload). Some
 * practices use a different provider — The Old Surgery is on Practice Plan —
 * and reading "Denplan" against their own membership figures is wrong for
 * them. The organizations table has no per-org settings column, so the
 * override lives here; add a row per organization as needed.
 */
const PROVIDER_OVERRIDES: Record<string, string> = {
  // The Old Surgery Dental Practice at Queens Street
  '739fb423-9aa5-46ae-8b6e-71f147d72530': 'Practice Plan',
};

export const DEFAULT_MEMBERSHIP_PROVIDER = 'Denplan';

export function membershipProviderLabel(organizationId?: string | null): string {
  return PROVIDER_OVERRIDES[organizationId ?? ''] ?? DEFAULT_MEMBERSHIP_PROVIDER;
}

/** Provider label for the signed-in user's current organization. */
export function useMembershipProviderLabel(): string {
  const { profile } = useAuth();
  return membershipProviderLabel(profile?.current_organization_id);
}
