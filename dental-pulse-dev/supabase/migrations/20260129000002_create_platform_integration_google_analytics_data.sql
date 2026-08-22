-- Create table for storing Google Analytics 4 integration data
CREATE TABLE IF NOT EXISTS platform_integration_google_analytics_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID NOT NULL REFERENCES platform_integrations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Domain entered by user
    domain VARCHAR(255) NOT NULL,

    -- GA4 Property information
    property_id VARCHAR(50),           -- e.g., "123456789"
    property_name VARCHAR(255),        -- Display name
    property_code VARCHAR(100),        -- Full path "properties/123456789"

    -- Website/Data Stream info
    website_url VARCHAR(500),
    measurement_id VARCHAR(50),        -- e.g., "G-XXXXXXXX"

    -- Account info
    account_id VARCHAR(50),
    account_name VARCHAR(255),

    -- Additional metadata
    timezone VARCHAR(100),
    currency VARCHAR(10),
    industry_category VARCHAR(100),
    property_type VARCHAR(50),

    -- Raw response data from Google
    raw_account_summaries JSONB,
    raw_property_details JSONB,
    raw_data_streams JSONB,

    -- Status
    status VARCHAR(20) DEFAULT 'active',
    is_selected BOOLEAN DEFAULT true,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ga4_data_org_id ON platform_integration_google_analytics_data(organization_id);
CREATE INDEX IF NOT EXISTS idx_ga4_data_integration_id ON platform_integration_google_analytics_data(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_ga4_data_domain ON platform_integration_google_analytics_data(domain);

-- Unique constraint on organization + domain
CREATE UNIQUE INDEX IF NOT EXISTS idx_ga4_data_org_domain ON platform_integration_google_analytics_data(organization_id, domain);

-- Enable RLS
ALTER TABLE platform_integration_google_analytics_data ENABLE ROW LEVEL SECURITY;

-- RLS Policies using user_in_org function (same as platform_integrations)
DROP POLICY IF EXISTS "Users can view their organization's GA4 data" ON platform_integration_google_analytics_data;
CREATE POLICY "Users can view their organization's GA4 data"
ON platform_integration_google_analytics_data
FOR SELECT
USING (
    public.user_in_org(auth.uid(), organization_id)
);

DROP POLICY IF EXISTS "Users can insert GA4 data for their organization" ON platform_integration_google_analytics_data;
CREATE POLICY "Users can insert GA4 data for their organization"
ON platform_integration_google_analytics_data
FOR INSERT
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

DROP POLICY IF EXISTS "Users can update their organization's GA4 data" ON platform_integration_google_analytics_data;
CREATE POLICY "Users can update their organization's GA4 data"
ON platform_integration_google_analytics_data
FOR UPDATE
USING (
    public.user_in_org(auth.uid(), organization_id)
)
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

DROP POLICY IF EXISTS "Users can delete their organization's GA4 data" ON platform_integration_google_analytics_data;
CREATE POLICY "Users can delete their organization's GA4 data"
ON platform_integration_google_analytics_data
FOR DELETE
USING (
    public.user_in_org(auth.uid(), organization_id)
);
