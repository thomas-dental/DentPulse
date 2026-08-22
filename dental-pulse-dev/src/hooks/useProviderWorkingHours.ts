import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { startOfMonth, endOfMonth, format } from 'date-fns'; // startOfMonth/endOfMonth used for default range
import dayjs from 'dayjs';

export interface MonthlyWorkingHours {
  month: string; // 'Jan-25', 'Feb-25', etc.
  hours: number;
}

export interface ProviderWorkingHoursData {
  providerName: string;
  monthlyHours: MonthlyWorkingHours[];
  totalHours: number;
}

/**
 * Fetches working hours for a provider from completed appointments.
 *
 * Precision strategy (matches overview page):
 * - If practitionerId + locationId → use get_provider_working_hours_by_location RPC,
 *   which returns raw integer duration_minutes. We divide the total once → exact result.
 * - If practitionerId only → query appointment_summary by practitioner_id (consistent with
 *   the overview's all-locations path).
 * - Fallback → query appointment_summary by provider_id UUID (legacy path).
 */
export function useProviderWorkingHours(
  providerId: string | undefined,
  startDate?: Date | null,
  endDate?: Date | null,
  practitionerId?: number | null,
  locationId?: string | null,
) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: [
      'provider-working-hours',
      organizationId,
      providerId,
      startDate ? format(startDate, 'yyyy-MM-dd') : null,
      endDate ? format(endDate, 'yyyy-MM-dd') : null,
      practitionerId ?? null,
      locationId ?? 'all',
    ],
    queryFn: async (): Promise<ProviderWorkingHoursData | null> => {
      if (!organizationId || !providerId) {
        return null;
      }

      const now = new Date();
      const rangeStart = startDate || startOfMonth(now);
      const rangeEnd   = endDate   || endOfMonth(now);

      const fromDate = format(rangeStart, 'yyyy-MM-dd');
      const toDate   = format(rangeEnd,   'yyyy-MM-dd');

      // Fetch provider name
      const { data: providerData, error: providerError } = await supabase
        .from('providers')
        .select('name')
        .eq('id', providerId)
        .single();

      if (providerError) throw providerError;

      // Build month label skeleton for display
      const monthlyHoursMap = new Map<string, number>();
      let cur = new Date(rangeStart);
      while (cur <= rangeEnd) {
        monthlyHoursMap.set(format(cur, 'MMM-yy'), 0);
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }

      let totalHoursExact = 0;

      if (practitionerId && locationId && locationId !== 'all') {
        // Path A: specific location — use the same RPC as the overview page.
        // Returns integer duration_minutes → one division at the end → exact precision.
        const { data: locationRows, error: locationError } = await (supabase as any).rpc(
          'get_provider_working_hours_by_location',
          {
            p_organization_id:  organizationId,
            p_practitioner_ids: [practitionerId],
            p_location_id:      locationId,
            p_from_date:        fromDate,
            p_to_date:          toDate,
          }
        );
        if (locationError) throw locationError;

        let totalMinutes = 0;
        for (const row of locationRows ?? []) {
          const label = dayjs(row.month).format('MMM-YY');
          monthlyHoursMap.set(label, (monthlyHoursMap.get(label) ?? 0) + (Number(row.working_duration_hours) || 0));
          totalMinutes += Number(row.duration_minutes) || 0;
        }
        totalHoursExact = totalMinutes / 60.0;

      } else if (practitionerId) {
        // Path B: all locations — query appointment_summary by practitioner_id (matches overview).
        const { data: summaryRows, error: summaryError } = await (supabase as any)
          .from('appointment_summary')
          .select('month, working_duration_hours')
          .eq('organization_id', organizationId)
          .eq('practitioner_id', practitionerId)
          .gte('month', fromDate)
          .lte('month', toDate);

        if (summaryError) throw summaryError;

        for (const row of summaryRows ?? []) {
          const label = dayjs(row.month).format('MMM-YY');
          monthlyHoursMap.set(label, (monthlyHoursMap.get(label) ?? 0) + (Number(row.working_duration_hours) || 0));
        }
        totalHoursExact = Array.from(monthlyHoursMap.values()).reduce((s, h) => s + h, 0);

      } else {
        // Path C: fallback — query by provider UUID (legacy, no practitioner_id available).
        const { data: summaryRows, error: summaryError } = await (supabase as any)
          .from('appointment_summary')
          .select('month, working_duration_hours')
          .eq('organization_id', organizationId)
          .eq('provider_id', providerId)
          .gte('month', fromDate)
          .lte('month', toDate);

        if (summaryError) throw summaryError;

        for (const row of summaryRows ?? []) {
          const label = dayjs(row.month).format('MMM-YY');
          monthlyHoursMap.set(label, (monthlyHoursMap.get(label) ?? 0) + (Number(row.working_duration_hours) || 0));
        }
        totalHoursExact = Array.from(monthlyHoursMap.values()).reduce((s, h) => s + h, 0);
      }

      const monthlyHours: MonthlyWorkingHours[] = Array.from(monthlyHoursMap.entries()).map(([month, hours]) => ({
        month,
        hours: Math.round(hours * 10) / 10,
      }));

      return {
        providerName: providerData.name || 'Provider',
        monthlyHours,
        totalHours: totalHoursExact,
      };
    },
    enabled: !!organizationId && !!providerId,
  });
}
