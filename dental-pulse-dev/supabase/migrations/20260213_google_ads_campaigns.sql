-- ============================================
-- Google Ads Campaign Daily Snapshots
-- ============================================
-- Stores one row per organization + campaign + day
-- for historical date-range filtering and RPC aggregation.

CREATE TABLE IF NOT EXISTS google_ads_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  campaign_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  campaign_type TEXT NOT NULL DEFAULT 'UNKNOWN',
  report_date DATE NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  conversions NUMERIC(12,4) NOT NULL DEFAULT 0,
  cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  average_cpc NUMERIC(12,4) NOT NULL DEFAULT 0,
  ctr NUMERIC(8,6) NOT NULL DEFAULT 0,
  cost_per_conversion NUMERIC(12,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, campaign_id, report_date)
);

-- Index for efficient date-range queries scoped by org
CREATE INDEX IF NOT EXISTS idx_gac_org_date
  ON google_ads_campaigns (organization_id, report_date);

-- Index for campaign lookups
CREATE INDEX IF NOT EXISTS idx_gac_org_campaign
  ON google_ads_campaigns (organization_id, campaign_id);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE google_ads_campaigns ENABLE ROW LEVEL SECURITY;

-- SELECT
DROP POLICY IF EXISTS "Users can view google ads campaigns in their org" ON google_ads_campaigns;
CREATE POLICY "Users can view google ads campaigns in their org"
  ON google_ads_campaigns FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));

-- INSERT
DROP POLICY IF EXISTS "Users can insert google ads campaigns in their org" ON google_ads_campaigns;
CREATE POLICY "Users can insert google ads campaigns in their org"
  ON google_ads_campaigns FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

-- UPDATE
DROP POLICY IF EXISTS "Users can update google ads campaigns in their org" ON google_ads_campaigns;
CREATE POLICY "Users can update google ads campaigns in their org"
  ON google_ads_campaigns FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

-- DELETE
DROP POLICY IF EXISTS "Users can delete google ads campaigns in their org" ON google_ads_campaigns;
CREATE POLICY "Users can delete google ads campaigns in their org"
  ON google_ads_campaigns FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

-- ============================================
-- RPC: get_ads_summary
-- Returns KPI totals for a date range
-- ============================================
CREATE OR REPLACE FUNCTION get_ads_summary(
  p_organization_id UUID,
  p_from_date DATE,
  p_to_date DATE
)
RETURNS TABLE (
  total_spend NUMERIC,
  total_clicks BIGINT,
  total_impressions BIGINT,
  total_conversions NUMERIC,
  average_cpc NUMERIC,
  cost_per_conversion NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    COALESCE(SUM(cost), 0) AS total_spend,
    COALESCE(SUM(clicks), 0)::BIGINT AS total_clicks,
    COALESCE(SUM(impressions), 0)::BIGINT AS total_impressions,
    COALESCE(SUM(conversions), 0) AS total_conversions,
    CASE WHEN SUM(clicks) > 0
      THEN ROUND(SUM(cost) / SUM(clicks), 4)
      ELSE 0
    END AS average_cpc,
    CASE WHEN SUM(conversions) > 0
      THEN ROUND(SUM(cost) / SUM(conversions), 4)
      ELSE 0
    END AS cost_per_conversion
  FROM google_ads_campaigns
  WHERE organization_id = p_organization_id
    AND report_date BETWEEN p_from_date AND p_to_date;
$$;

-- ============================================
-- RPC: get_campaign_totals
-- Returns per-campaign aggregates for a date range
-- ============================================
CREATE OR REPLACE FUNCTION get_campaign_totals(
  p_organization_id UUID,
  p_from_date DATE,
  p_to_date DATE
)
RETURNS TABLE (
  campaign_id TEXT,
  campaign_name TEXT,
  campaign_status TEXT,
  campaign_type TEXT,
  total_spend NUMERIC,
  total_clicks BIGINT,
  total_impressions BIGINT,
  total_conversions NUMERIC,
  avg_cpc NUMERIC,
  avg_ctr NUMERIC,
  avg_cost_per_conversion NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    g.campaign_id,
    (array_agg(g.campaign_name ORDER BY g.report_date DESC))[1] AS campaign_name,
    (array_agg(g.campaign_status ORDER BY g.report_date DESC))[1] AS campaign_status,
    (array_agg(g.campaign_type ORDER BY g.report_date DESC))[1] AS campaign_type,
    COALESCE(SUM(g.cost), 0) AS total_spend,
    COALESCE(SUM(g.clicks), 0)::BIGINT AS total_clicks,
    COALESCE(SUM(g.impressions), 0)::BIGINT AS total_impressions,
    COALESCE(SUM(g.conversions), 0) AS total_conversions,
    CASE WHEN SUM(g.clicks) > 0
      THEN ROUND(SUM(g.cost) / SUM(g.clicks), 4)
      ELSE 0
    END AS avg_cpc,
    CASE WHEN SUM(g.impressions) > 0
      THEN ROUND(SUM(g.clicks)::NUMERIC / SUM(g.impressions), 6)
      ELSE 0
    END AS avg_ctr,
    CASE WHEN SUM(g.conversions) > 0
      THEN ROUND(SUM(g.cost) / SUM(g.conversions), 4)
      ELSE 0
    END AS avg_cost_per_conversion
  FROM google_ads_campaigns g
  WHERE g.organization_id = p_organization_id
    AND g.report_date BETWEEN p_from_date AND p_to_date
  GROUP BY g.campaign_id
  ORDER BY SUM(g.cost) DESC;
$$;

-- ============================================
-- RPC: get_campaign_chart_data
-- Returns daily totals for charts
-- ============================================
CREATE OR REPLACE FUNCTION get_campaign_chart_data(
  p_organization_id UUID,
  p_from_date DATE,
  p_to_date DATE
)
RETURNS TABLE (
  report_date DATE,
  total_spend NUMERIC,
  total_clicks BIGINT,
  total_impressions BIGINT,
  total_conversions NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    g.report_date,
    COALESCE(SUM(g.cost), 0) AS total_spend,
    COALESCE(SUM(g.clicks), 0)::BIGINT AS total_clicks,
    COALESCE(SUM(g.impressions), 0)::BIGINT AS total_impressions,
    COALESCE(SUM(g.conversions), 0) AS total_conversions
  FROM google_ads_campaigns g
  WHERE g.organization_id = p_organization_id
    AND g.report_date BETWEEN p_from_date AND p_to_date
  GROUP BY g.report_date
  ORDER BY g.report_date ASC;
$$;
