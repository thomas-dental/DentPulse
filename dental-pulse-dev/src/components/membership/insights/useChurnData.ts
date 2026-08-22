import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useFilters } from "@/contexts/FilterContext";
import { useLocations } from "@/hooks/useLocations";
import { ukDayStartInstant, ukDayEndInstant } from "@/utils/dateRangeUtils";

export interface ChurnLocationRow {
  locationId: string | null;
  joined: number;
  left: number;
  activeMembers: number;
  churnPct: number | null;
}

export interface ChurnData {
  isLoading: boolean;
  /** Real join/leave transitions only exist from whenever the tracking
   *  trigger was deployed — this is that earliest observed date, so the UI
   *  can say "since DD Mon YYYY" instead of implying a full year of history. */
  trackingSince: string | null;
  joined: number;
  left: number;
  activeMembers: number;
  churnPct: number | null;
  byLocation: Map<string, ChurnLocationRow>;
}

/** Real member join/leave counts from patient_plan_membership_events — a
 *  trigger-captured log of observed Dentally payment-plan transitions
 *  (migration 20260807000001). Only 'joined'/'left' rows are real observed
 *  transitions; 'baseline' rows (first-ever sight of an existing member) are
 *  excluded, per that migration's own documented caveat. Tracking only
 *  started recently, so counts here are genuine but will be thin until more
 *  history accumulates — never dress this up as a mature annual churn rate. */
export function useChurnData(): ChurnData {
  const { organizationId } = useOrganization();
  const { dateRange, selectedLocationId } = useFilters();
  const { allAvailableLocations } = useLocations();

  const eventsQ = useQuery({
    queryKey: [
      "insights_churn_events",
      organizationId,
      dateRange.startDate.toISOString(),
      dateRange.endDate.toISOString(),
    ],
    enabled: !!organizationId,
    queryFn: async (): Promise<Array<{ change_type: string; location_id: string | null; changed_at: string }>> => {
      const { data, error } = await (supabase as any)
        .from("patient_plan_membership_events")
        .select("change_type, location_id, changed_at")
        .eq("organization_id", organizationId)
        .in("change_type", ["joined", "left"])
        .gte("changed_at", ukDayStartInstant(dateRange.startDate))
        .lte("changed_at", ukDayEndInstant(dateRange.endDate));
      if (error) throw error;
      return data ?? [];
    },
  });

  const earliestQ = useQuery({
    queryKey: ["insights_churn_tracking_since", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await (supabase as any)
        .from("patient_plan_membership_events")
        .select("changed_at")
        .eq("organization_id", organizationId)
        .in("change_type", ["joined", "left"])
        .order("changed_at", { ascending: true })
        .limit(1);
      if (error) throw error;
      return data?.[0]?.changed_at ?? null;
    },
    staleTime: 60 * 60 * 1000,
  });

  const activeMembersQ = useQuery({
    queryKey: ["insights_churn_active_members", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<Array<{ location_id: string | null }>> => {
      const { data, error } = await (supabase as any)
        .from("patients")
        .select("location_id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .not("pt_payment_plan_id", "is", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const isLoading = eventsQ.isLoading || earliestQ.isLoading || activeMembersQ.isLoading;

  return useMemo<ChurnData>(() => {
    const events = eventsQ.data ?? [];
    const activePatients = activeMembersQ.data ?? [];

    const joined = events.filter((e) => e.change_type === "joined").length;
    const left = events.filter((e) => e.change_type === "left").length;
    const activeMembers = selectedLocationId
      ? activePatients.filter((p) => p.location_id === selectedLocationId).length
      : activePatients.length;
    const churnPct = activeMembers + left > 0 ? Math.round((left / (activeMembers + left)) * 1000) / 10 : null;

    const byLocation = new Map<string, ChurnLocationRow>();
    for (const loc of allAvailableLocations) {
      const locJoined = events.filter((e) => e.location_id === loc.id && e.change_type === "joined").length;
      const locLeft = events.filter((e) => e.location_id === loc.id && e.change_type === "left").length;
      const locActive = activePatients.filter((p) => p.location_id === loc.id).length;
      byLocation.set(loc.id, {
        locationId: loc.id,
        joined: locJoined,
        left: locLeft,
        activeMembers: locActive,
        churnPct: locActive + locLeft > 0 ? Math.round((locLeft / (locActive + locLeft)) * 1000) / 10 : null,
      });
    }

    return {
      isLoading,
      trackingSince: earliestQ.data ?? null,
      joined,
      left,
      activeMembers,
      churnPct,
      byLocation,
    };
  }, [eventsQ.data, earliestQ.data, activeMembersQ.data, allAvailableLocations, selectedLocationId, isLoading]);
}
