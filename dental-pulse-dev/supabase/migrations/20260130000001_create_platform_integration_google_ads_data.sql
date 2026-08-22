-- Create table for storing Google Ads integration data
CREATE TABLE IF NOT EXISTS platform_integration_google_ads_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID NOT NULL REFERENCES platform_integrations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Google Ads API credentials
    developer_token VARCHAR(255),
    customer_id VARCHAR(50),              -- e.g., "8739091705"
    login_customer_id VARCHAR(50),        -- MCC account ID, e.g., "9859949182"

    -- Account information
    account_name VARCHAR(255),
    currency VARCHAR(10),
    timezone VARCHAR(100),

    -- Cached metrics (last 30 days)
    total_spend DECIMAL(12, 2) DEFAULT 0,
    total_conversions INTEGER DEFAULT 0,
    total_clicks INTEGER DEFAULT 0,
    total_impressions INTEGER DEFAULT 0,
    average_cpc DECIMAL(10, 4) DEFAULT 0,
    cost_per_conversion DECIMAL(10, 2) DEFAULT 0,

    -- Last sync timestamp
    last_sync_at TIMESTAMPTZ,

    -- Raw API response data
    raw_account_info JSONB,
    raw_campaigns JSONB,
    raw_metrics JSONB,

    -- Status
    status VARCHAR(20) DEFAULT 'active',
    is_selected BOOLEAN DEFAULT true,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_google_ads_data_org_id ON platform_integration_google_ads_data(organization_id);
CREATE INDEX IF NOT EXISTS idx_google_ads_data_integration_id ON platform_integration_google_ads_data(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_google_ads_data_customer_id ON platform_integration_google_ads_data(customer_id);

-- Unique constraint on organization + customer_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_google_ads_data_org_customer ON platform_integration_google_ads_data(organization_id, customer_id);

-- Enable RLS
ALTER TABLE platform_integration_google_ads_data ENABLE ROW LEVEL SECURITY;

-- RLS Policies using user_in_org function (same as platform_integrations)
DROP POLICY IF EXISTS "Users can view their organization's Google Ads data" ON platform_integration_google_ads_data;
CREATE POLICY "Users can view their organization's Google Ads data"
ON platform_integration_google_ads_data
FOR SELECT
USING (
    public.user_in_org(auth.uid(), organization_id)
);

DROP POLICY IF EXISTS "Users can insert Google Ads data for their organization" ON platform_integration_google_ads_data;
CREATE POLICY "Users can insert Google Ads data for their organization"
ON platform_integration_google_ads_data
FOR INSERT
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

DROP POLICY IF EXISTS "Users can update their organization's Google Ads data" ON platform_integration_google_ads_data;
CREATE POLICY "Users can update their organization's Google Ads data"
ON platform_integration_google_ads_data
FOR UPDATE
USING (
    public.user_in_org(auth.uid(), organization_id)
)
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

DROP POLICY IF EXISTS "Users can delete their organization's Google Ads data" ON platform_integration_google_ads_data;
CREATE POLICY "Users can delete their organization's Google Ads data"
ON platform_integration_google_ads_data
FOR DELETE
USING (
    public.user_in_org(auth.uid(), organization_id)
);
