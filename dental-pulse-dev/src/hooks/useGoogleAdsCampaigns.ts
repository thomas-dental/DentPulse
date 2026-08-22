/**
 * useGoogleAdsCampaigns Hook
 * Calls RPC functions for date-range-filtered Google Ads campaign data.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';

// ============================================
// TYPES
// ============================================

export interface AdsSummary {
  total_spend: number;
  total_clicks: number;
  total_impressions: number;
  total_conversions: number;
  average_cpc: number;
  cost_per_conversion: number;
}

export interface CampaignTotal {
  campaign_id: string;
  campaign_name: string;
  campaign_status: string;
  campaign_type: string;
  total_spend: number;
  total_clicks: number;
  total_impressions: number;
  total_conversions: number;
  avg_cpc: number;
  avg_ctr: number;
  avg_cost_per_conversion: number;
}

export interface ChartDataPoint {
  report_date: string;
  total_spend: number;
  total_clicks: number;
  total_impressions: number;
  total_conversions: number;
}

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

export interface UseGoogleAdsCampaignsReturn {
  summary: AdsSummary | null;
  campaigns: CampaignTotal[];
  chartData: ChartDataPoint[];
  isLoading: boolean;
  hasData: boolean;
}

// ============================================
// HOOK
// ============================================

export function useGoogleAdsCampaigns(dateRange: DateRange): UseGoogleAdsCampaignsReturn {
  const { organizationId } = useOrganization();

  const enabled = !!organizationId && !!dateRange.from && !!dateRange.to;

  // Summary RPC
  const {
    data: summaryData,
    isLoading: isLoadingSummary,
  } = useQuery({
    queryKey: ['google-ads-summary', organizationId, dateRange.from, dateRange.to],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_ads_summary', {
        p_organization_id: organizationId,
        p_from_date: dateRange.from,
        p_to_date: dateRange.to,
      });
      if (error) throw error;
      // RPC returns a single row as an array
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      return {
        total_spend: Number(row.total_spend) || 0,
        total_clicks: Number(row.total_clicks) || 0,
        total_impressions: Number(row.total_impressions) || 0,
        total_conversions: Number(row.total_conversions) || 0,
        average_cpc: Number(row.average_cpc) || 0,
        cost_per_conversion: Number(row.cost_per_conversion) || 0,
      } as AdsSummary;
    },
    enabled,
    staleTime: 2 * 60 * 1000,
  });

  // Campaign totals RPC
  const {
    data: campaignsData,
    isLoading: isLoadingCampaigns,
  } = useQuery({
    queryKey: ['google-ads-campaign-totals', organizationId, dateRange.from, dateRange.to],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_campaign_totals', {
        p_organization_id: organizationId,
        p_from_date: dateRange.from,
        p_to_date: dateRange.to,
      });
      if (error) throw error;
      return (data || []).map((row: any) => ({
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        campaign_status: row.campaign_status,
        campaign_type: row.campaign_type,
        total_spend: Number(row.total_spend) || 0,
        total_clicks: Number(row.total_clicks) || 0,
        total_impressions: Number(row.total_impressions) || 0,
        total_conversions: Number(row.total_conversions) || 0,
        avg_cpc: Number(row.avg_cpc) || 0,
        avg_ctr: Number(row.avg_ctr) || 0,
        avg_cost_per_conversion: Number(row.avg_cost_per_conversion) || 0,
      })) as CampaignTotal[];
    },
    enabled,
    staleTime: 2 * 60 * 1000,
  });

  // Chart data RPC
  const {
    data: chartRawData,
    isLoading: isLoadingChart,
  } = useQuery({
    queryKey: ['google-ads-chart-data', organizationId, dateRange.from, dateRange.to],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_campaign_chart_data', {
        p_organization_id: organizationId,
        p_from_date: dateRange.from,
        p_to_date: dateRange.to,
      });
      if (error) throw error;
      return (data || []).map((row: any) => ({
        report_date: row.report_date,
        total_spend: Number(row.total_spend) || 0,
        total_clicks: Number(row.total_clicks) || 0,
        total_impressions: Number(row.total_impressions) || 0,
        total_conversions: Number(row.total_conversions) || 0,
      })) as ChartDataPoint[];
    },
    enabled,
    staleTime: 2 * 60 * 1000,
  });

  const summary = summaryData ?? null;
  const campaigns = campaignsData ?? [];
  const chartData = chartRawData ?? [];
  const hasData = summary !== null && summary.total_spend > 0;

  return {
    summary,
    campaigns,
    chartData,
    isLoading: isLoadingSummary || isLoadingCampaigns || isLoadingChart,
    hasData,
  };
}
