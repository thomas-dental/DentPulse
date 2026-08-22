import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useUserRole } from '@/hooks/useUserRole';
import { membershipProviderLabel } from '@/lib/membershipProviderLabel';
import { toLocalYMD, ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';

/**
 * Exceptions & Action Center.
 *
 * Turns the dashboard's live figures plus a few connection/appointment checks
 * into ONE ranked to-do list, split three ways:
 *   · missing        — data or integrations needed before the numbers can be trusted
 *   · urgent         — money at risk right now
 *   · recommendation — the ranked opportunities (same list as "Next Moves")
 *
 * Every item carries a PRIORITY (critical/moderate/low), the SITE it belongs to
 * and the ROLE that owns it, so the card can group by site and badge each row —
 * and the Monday digest is built from exactly those rows.
 */

export type ActionSeverity = 'critical' | 'moderate' | 'low';
export type ActionAudience = 'owner' | 'manager' | 'both';
export type ActionCategory = 'missing' | 'urgent' | 'recommendation';

/** Shown when an item applies to the whole group rather than one site. */
export const ALL_SITES = 'All sites';

export interface ActionItem {
  id: string;
  category: ActionCategory;
  severity: ActionSeverity;
  title: string;
  detail: string;
  audience: ActionAudience;
  /** Site this action belongs to, or ALL_SITES for group-wide. */
  location: string;
  /** Headline figure shown on the right of the row (already formatted). */
  value?: string;
  to?: string;
  cta?: string;
}

/** Structural input — kept loose so this hook doesn't couple to the dashboard's VM type. */
export interface ActionCenterInput {
  vm: {
    sites: Array<{ locationId: string; name: string; revenue: number }>;
    nhsRows: Array<{ name: string; deliveredPct: number; status: string; exposure: number }>;
    monthsCover: number | null;
    cash: number | null;
    nhsExposure: number;
    margin: number | null;
    profit: number;
    moves: Array<{ title: string; impact: string; why: string; owner: string }>;
    isCostsLoading: boolean;
  };
  /** Per-site margin/utilisation exceptions already computed by the dashboard. */
  siteExceptions: Array<{
    site: { locationId: string; name: string };
    sev: 'r' | 'a';
    reasons: string[];
    annual: number;
  }>;
}

const SEV_RANK: Record<ActionSeverity, number> = { critical: 0, moderate: 1, low: 2 };
const fmtK = (v: number) => `£${Math.round(Math.abs(v) / 1000).toLocaleString('en-GB')}k`;
const daysSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
};
const STALE_DAYS = 7;

export function useActionCenter({ vm, siteExceptions }: ActionCenterInput) {
  const { organizationId } = useOrganization();
  const { selectedLocationId, dateRange } = useFilters();
  const { currentRole, isOwner } = useUserRole();

  const startYMD = toLocalYMD(dateRange?.startDate) ?? null;
  const endYMD = toLocalYMD(dateRange?.endDate) ?? null;

  /* One round-trip for every connection / follow-up check the centre needs. */
  const { data: checks, isLoading: checksLoading } = useQuery({
    queryKey: ['action-center-checks', organizationId, selectedLocationId ?? 'all', startYMD, endYMD],
    enabled: !!organizationId && !!startYMD && !!endYMD,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // London day-boundary instants — a naive 'YYYY-MM-DDT00:00:00' string is
      // cast as UTC by the DB, one hour late during BST. Parse the YMD at local
      // noon so the calendar date survives any browser timezone.
      const startISO = ukDayStartInstant(new Date(`${startYMD}T12:00:00`));
      const endISO = ukDayEndInstant(new Date(`${endYMD}T12:00:00`));

      // Cancelled / did-not-attend rows WITH their location, so follow-ups can be
      // broken out per site instead of one group-wide number.
      let apptQ = (supabase as any)
        .from('appointments')
        .select('location_id, apmt_state')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .in('apmt_state', ['Cancelled', 'Did Not Attend', 'DNA'])
        .gte('apmt_start_time', startISO)
        .lte('apmt_start_time', endISO)
        .range(0, 9999);
      if (selectedLocationId) apptQ = apptQ.eq('location_id', selectedLocationId);

      const [pms, acct, members, appts] = await Promise.all([
        (supabase as any)
          .from('integrations')
          .select('integration_name, is_connected, sync_at')
          .eq('organization_id', organizationId)
          .is('deleted_at', null),
        (supabase as any)
          .from('platform_integrations')
          .select('platform_name, is_connected, last_synced_at')
          .eq('organization_id', organizationId),
        (supabase as any)
          .from('membership_upload_members')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .is('deleted_at', null),
        apptQ,
      ]);

      const pmsRows = (pms.data ?? []) as Array<{ integration_name: string; is_connected: boolean; sync_at: string | null }>;
      const dentally = pmsRows.filter((r) => r.integration_name === 'Dentally');
      const acctRows = (acct.data ?? []) as Array<{ platform_name: string; is_connected: boolean; last_synced_at: string | null }>;
      const connectedAcct = acctRows.filter((r) => r.is_connected);

      // Fold appointments into per-location cancelled / no-show tallies.
      const byLoc = new Map<string, { cancelled: number; noShow: number }>();
      for (const a of (appts.data ?? []) as Array<{ location_id: string | null; apmt_state: string | null }>) {
        const key = a.location_id ?? '__none__';
        const cur = byLoc.get(key) ?? { cancelled: 0, noShow: 0 };
        const st = (a.apmt_state || '').toLowerCase();
        if (st === 'cancelled') cur.cancelled++;
        else cur.noShow++;
        byLoc.set(key, cur);
      }

      return {
        dentallyConnected: dentally.some((r) => r.is_connected),
        dentallyHasCreds: dentally.length > 0,
        dentallyLastSync: dentally.map((r) => r.sync_at).filter(Boolean).sort().reverse()[0] ?? null,
        accountingConnected: connectedAcct.length > 0,
        accountingPlatforms: connectedAcct.map((r) => r.platform_name),
        accountingLastSync: connectedAcct.map((r) => r.last_synced_at).filter(Boolean).sort().reverse()[0] ?? null,
        membershipCount: members.count ?? 0,
        followUpsByLocation: Array.from(byLoc.entries()).map(([locationId, v]) => ({ locationId, ...v })),
      };
    },
  });

  const items = useMemo<ActionItem[]>(() => {
    const out: ActionItem[] = [];
    const nameOf = new Map(vm.sites.map((s) => [s.locationId, s.name]));

    /* ── 1. MISSING DATA — trust the numbers before acting on them ── */
    if (checks) {
      if (!checks.dentallyConnected) {
        out.push({
          id: 'missing-dentally', category: 'missing', severity: 'critical', audience: 'owner', location: ALL_SITES,
          title: 'Dentally is not connected',
          detail: checks.dentallyHasCreds
            ? 'Credentials are saved but the connection is not active — appointments, treatments and NHS figures will be incomplete until it reconnects.'
            : 'No clinical data is syncing. Appointments, treatments, chair utilisation and NHS delivery will all read as empty.',
          to: '/settings', cta: 'Connect Dentally',
        });
      } else {
        const d = daysSince(checks.dentallyLastSync);
        if (d != null && d > 1) {
          out.push({
            id: 'missing-dentally-stale', category: 'missing',
            severity: d > STALE_DAYS ? 'moderate' : 'low', audience: 'manager', location: ALL_SITES,
            title: `Clinical data is ${d} days old`,
            detail: 'Dentally has not synced recently, so today’s figures may lag reality. Re-run the sync if this persists.',
            value: `${d}d`, to: '/settings', cta: 'Check sync',
          });
        }
      }

      if (!checks.accountingConnected) {
        out.push({
          id: 'missing-accounting', category: 'missing', severity: 'moderate', audience: 'owner', location: ALL_SITES,
          title: 'No accounting platform connected',
          detail: 'Profit, costs and cash are estimates until Xero, QuickBooks or iplicit is connected and reconciled.',
          to: '/settings', cta: 'Connect accounting',
        });
      } else {
        const d = daysSince(checks.accountingLastSync);
        if (d != null && d > STALE_DAYS) {
          out.push({
            id: 'missing-accounting-stale', category: 'missing', severity: 'moderate', audience: 'owner', location: ALL_SITES,
            title: `${checks.accountingPlatforms.join(' / ')} not reconciled for ${d} days`,
            detail: 'Costs and cash on this page are only as current as the last reconciliation. Reconcile to bring profit and cash cover up to date.',
            value: `${d}d`, to: '/settings', cta: 'Reconcile',
          });
        }
      }

      if (checks.membershipCount === 0) {
        const provider = membershipProviderLabel(organizationId);
        out.push({
          id: 'missing-membership', category: 'missing', severity: 'low', audience: 'manager', location: ALL_SITES,
          title: `No membership (${provider}) data uploaded`,
          detail: `Membership income is missing from revenue and the plan mix until the latest ${provider} statement is uploaded.`,
          to: '/membership-performance', cta: 'Upload members',
        });
      }
    }

    /* ── 2. URGENT ACTIONS — money at risk this week ── */
    if (vm.monthsCover != null && vm.monthsCover < 1.5) {
      out.push({
        id: 'urgent-cash', category: 'urgent',
        severity: vm.monthsCover < 1 ? 'critical' : 'moderate', audience: 'owner', location: ALL_SITES,
        title: 'Cash cover below 1.5 months',
        detail: `The bank balance covers ${vm.monthsCover.toFixed(1)} months of running costs at the current burn rate.`,
        value: `${vm.monthsCover.toFixed(1)} mo`, to: '/cashflow', cta: 'Open cash flow',
      });
    }

    // One row per NHS contract running behind, so the site is explicit.
    for (const r of vm.nhsRows.filter((n) => n.exposure > 0)) {
      out.push({
        id: `urgent-nhs-${r.name}`, category: 'urgent',
        severity: r.exposure > 50_000 ? 'critical' : 'moderate', audience: 'owner', location: r.name,
        title: 'NHS fees at risk — contract behind',
        detail: `Only ${r.deliveredPct}% of expected NHS fees awarded so far. Rebook missed capacity and chase outstanding claims before the recovery window closes.`,
        value: fmtK(r.exposure), to: '/nhs-performance', cta: 'Open NHS',
      });
    }

    for (const ex of siteExceptions) {
      out.push({
        id: `urgent-site-${ex.site.locationId}`, category: 'urgent',
        severity: ex.sev === 'r' ? 'critical' : 'moderate', audience: 'both', location: ex.site.name,
        title: 'Site is off plan',
        detail: ex.reasons.join(' · '),
        value: ex.annual > 0 ? `${fmtK(ex.annual)}/yr` : undefined,
      });
    }

    // Follow-ups, broken out per site.
    for (const f of checks?.followUpsByLocation ?? []) {
      const total = f.cancelled + f.noShow;
      if (total <= 0) continue;
      out.push({
        id: `urgent-followups-${f.locationId}`, category: 'urgent',
        severity: total >= 25 ? 'moderate' : 'low', audience: 'manager',
        location: nameOf.get(f.locationId) ?? ALL_SITES,
        title: `${total} appointment${total === 1 ? '' : 's'} to follow up`,
        detail: `${f.cancelled} cancelled and ${f.noShow} did-not-attend this period. Rebooking them is the fastest way to refill paid-for chair time.`,
        value: `${total}`, to: '/chairs', cta: 'Rebook',
      });
    }

    /* ── 3. RECOMMENDATIONS — the ranked opportunities ── */
    vm.moves.forEach((m, i) => {
      const site = vm.sites.find((s) => m.title.includes(s.name));
      out.push({
        id: `rec-${i}`, category: 'recommendation', severity: 'low',
        audience: /manager|front of house|practice/i.test(m.owner) ? 'manager' : 'owner',
        location: site?.name ?? ALL_SITES,
        title: m.title, detail: m.why, value: m.impact,
      });
    });

    // Worst first, then keep each site's rows together.
    return out.sort((a, b) =>
      SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.location.localeCompare(b.location));
  }, [checks, vm.monthsCover, vm.nhsRows, vm.moves, vm.sites, siteExceptions]);

  const byCategory = useMemo(
    () => ({
      missing: items.filter((i) => i.category === 'missing'),
      urgent: items.filter((i) => i.category === 'urgent'),
      recommendation: items.filter((i) => i.category === 'recommendation'),
    }),
    [items],
  );

  const counts = useMemo(
    () => ({
      critical: items.filter((i) => i.severity === 'critical').length,
      moderate: items.filter((i) => i.severity === 'moderate').length,
      low: items.filter((i) => i.severity === 'low').length,
      total: items.length,
    }),
    [items],
  );

  const viewerAudience: Exclude<ActionAudience, 'both'> = isOwner() ? 'owner' : 'manager';

  return { items, byCategory, counts, viewerAudience, currentRole, isLoading: checksLoading, checks };
}

/** Group rows by site, group-wide rows last. */
export function groupByLocation(items: ActionItem[]): Array<[string, ActionItem[]]> {
  const map = new Map<string, ActionItem[]>();
  for (const i of items) {
    const arr = map.get(i.location) ?? [];
    arr.push(i);
    map.set(i.location, arr);
  }
  return Array.from(map.entries()).sort(([a], [b]) =>
    a === ALL_SITES ? 1 : b === ALL_SITES ? -1 : a.localeCompare(b));
}

/** Filter helper — an item is shown when it targets the chosen audience or both. */
export function forAudience(items: ActionItem[], audience: ActionAudience | 'all'): ActionItem[] {
  if (audience === 'all') return items;
  return items.filter((i) => i.audience === audience || i.audience === 'both');
}
