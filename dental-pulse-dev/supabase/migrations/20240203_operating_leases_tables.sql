-- ============================================
-- OPERATING LEASES - NEW TABLES
-- ============================================

-- 1. LEASE MASTER TABLE
-- Stores lease contract details that don't exist in Xero
-- (contract terms, expiry dates, renewal options)
-- ============================================
CREATE TABLE IF NOT EXISTS public.lease_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Lease Identification
  lease_reference VARCHAR(50),
  lease_name VARCHAR(255) NOT NULL,
  lease_description TEXT,

  -- Classification
  lease_category VARCHAR(50) NOT NULL CHECK (
    lease_category IN ('building', 'equipment', 'vehicle', 'it_software', 'other')
  ),
  lease_sub_category VARCHAR(100),

  -- Location Mapping
  location_id UUID REFERENCES public.practice_locations(id),
  location_name VARCHAR(255),

  -- Xero Account Mapping (to link with Xero expense data)
  xero_account_code VARCHAR(20),
  xero_account_codes TEXT[], -- Array if multiple accounts
  xero_contact_id VARCHAR(100), -- Landlord/Lessor ContactID in Xero
  xero_contact_name VARCHAR(255),

  -- Financial Terms
  monthly_rent NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_frequency VARCHAR(20) DEFAULT 'monthly' CHECK (
    payment_frequency IN ('weekly', 'monthly', 'quarterly', 'annual')
  ),
  currency VARCHAR(3) DEFAULT 'GBP',

  -- Contract Dates
  lease_start_date DATE NOT NULL,
  lease_end_date DATE NOT NULL,
  next_review_date DATE,
  notice_period_months INTEGER DEFAULT 3,

  -- Renewal Terms
  has_renewal_option BOOLEAN DEFAULT false,
  renewal_terms TEXT,
  auto_renew BOOLEAN DEFAULT false,

  -- Status
  status VARCHAR(20) DEFAULT 'active' CHECK (
    status IN ('active', 'expiring_soon', 'expired', 'terminated', 'draft')
  ),

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  user_id UUID REFERENCES auth.users(id)
);

-- Indexes for lease_master
CREATE INDEX IF NOT EXISTS idx_lease_master_org ON public.lease_master(organization_id);
CREATE INDEX IF NOT EXISTS idx_lease_master_location ON public.lease_master(location_id);
CREATE INDEX IF NOT EXISTS idx_lease_master_category ON public.lease_master(lease_category);
CREATE INDEX IF NOT EXISTS idx_lease_master_end_date ON public.lease_master(lease_end_date);
CREATE INDEX IF NOT EXISTS idx_lease_master_status ON public.lease_master(status);
CREATE INDEX IF NOT EXISTS idx_lease_master_xero_account ON public.lease_master(xero_account_code);
CREATE INDEX IF NOT EXISTS idx_lease_master_xero_contact ON public.lease_master(xero_contact_id);

-- Updated_at trigger for lease_master
CREATE OR REPLACE FUNCTION update_lease_master_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lease_master_updated_at ON public.lease_master;
CREATE TRIGGER lease_master_updated_at
  BEFORE UPDATE ON public.lease_master
  FOR EACH ROW
  EXECUTE FUNCTION update_lease_master_updated_at();


-- 2. LEASE CATEGORY MAPPING TABLE
-- Maps Xero account codes to lease categories
-- ============================================
CREATE TABLE IF NOT EXISTS public.lease_category_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Xero Account Mapping
  xero_account_code VARCHAR(20) NOT NULL,
  xero_account_name VARCHAR(255),

  -- Category Assignment
  lease_category VARCHAR(50) NOT NULL CHECK (
    lease_category IN ('building', 'equipment', 'vehicle', 'it_software', 'other')
  ),
  lease_sub_category VARCHAR(100),

  -- Keywords for auto-matching
  match_keywords TEXT[],

  -- Priority (lower = higher priority when multiple matches)
  priority INTEGER DEFAULT 100,

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique per org + account code (NULL org = global default)
  UNIQUE(organization_id, xero_account_code)
);

-- Indexes for lease_category_mapping
CREATE INDEX IF NOT EXISTS idx_lease_category_mapping_org ON public.lease_category_mapping(organization_id);
CREATE INDEX IF NOT EXISTS idx_lease_category_mapping_account ON public.lease_category_mapping(xero_account_code);
CREATE INDEX IF NOT EXISTS idx_lease_category_mapping_category ON public.lease_category_mapping(lease_category);

-- Updated_at trigger for lease_category_mapping
DROP TRIGGER IF EXISTS lease_category_mapping_updated_at ON public.lease_category_mapping;
CREATE TRIGGER lease_category_mapping_updated_at
  BEFORE UPDATE ON public.lease_category_mapping
  FOR EACH ROW
  EXECUTE FUNCTION update_lease_master_updated_at();


-- 3. INDUSTRY BENCHMARKS TABLE
-- Stores benchmark data for comparison
-- ============================================
CREATE TABLE IF NOT EXISTS public.industry_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope
  industry VARCHAR(100) NOT NULL DEFAULT 'dental_practice',
  practice_size VARCHAR(50) DEFAULT 'all', -- 'small', 'medium', 'large', 'all'
  region VARCHAR(100) DEFAULT 'uk', -- 'uk', 'us', 'eu', 'all'

  -- Benchmark Type
  metric_name VARCHAR(100) NOT NULL,
  metric_category VARCHAR(50) NOT NULL, -- 'operating_leases', 'staff_costs', 'lab_fees'

  -- Values (stored as decimals, e.g., 0.08 = 8%)
  benchmark_value NUMERIC(10,4) NOT NULL,
  benchmark_low NUMERIC(10,4), -- Lower quartile
  benchmark_high NUMERIC(10,4), -- Upper quartile

  -- Validity
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  source VARCHAR(255), -- 'NASDAL 2024', 'Internal Analysis', etc.

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique per metric + scope
  UNIQUE(industry, practice_size, region, metric_name, effective_from)
);

-- Indexes for industry_benchmarks
CREATE INDEX IF NOT EXISTS idx_industry_benchmarks_category ON public.industry_benchmarks(metric_category);
CREATE INDEX IF NOT EXISTS idx_industry_benchmarks_metric ON public.industry_benchmarks(metric_name);
CREATE INDEX IF NOT EXISTS idx_industry_benchmarks_active ON public.industry_benchmarks(is_active);


-- ============================================
-- SEED DATA - DEFAULT CATEGORY MAPPINGS
-- ============================================

-- Global default mappings (organization_id = NULL means applies to all)
-- These are common Xero account patterns for dental practices
INSERT INTO public.lease_category_mapping (organization_id, xero_account_code, xero_account_name, lease_category, match_keywords, priority)
VALUES
  -- Building/Property related
  (NULL, '460', 'Rent', 'building', ARRAY['rent', 'lease', 'occupancy'], 10),
  (NULL, '461', 'Rates', 'building', ARRAY['rates', 'council tax', 'business rates'], 10),
  (NULL, '462', 'Service Charges', 'building', ARRAY['service charge', 'maintenance'], 10),
  (NULL, '463', 'Property Insurance', 'building', ARRAY['property insurance', 'building insurance'], 10),

  -- Equipment related
  (NULL, '470', 'Equipment Hire', 'equipment', ARRAY['equipment hire', 'equipment lease', 'dental equipment'], 10),
  (NULL, '471', 'Equipment Lease', 'equipment', ARRAY['equipment lease', 'finance lease'], 10),

  -- Vehicle related
  (NULL, '480', 'Motor Expenses', 'vehicle', ARRAY['motor', 'vehicle', 'car', 'fuel', 'mileage'], 10),
  (NULL, '481', 'Vehicle Lease', 'vehicle', ARRAY['vehicle lease', 'car lease'], 10),

  -- IT & Software
  (NULL, '490', 'Software Subscriptions', 'it_software', ARRAY['software', 'subscription', 'saas', 'cloud'], 10),
  (NULL, '491', 'IT Equipment Lease', 'it_software', ARRAY['computer', 'it lease', 'server'], 10)
ON CONFLICT (organization_id, xero_account_code) DO NOTHING;


-- ============================================
-- SEED DATA - INDUSTRY BENCHMARKS
-- ============================================

INSERT INTO public.industry_benchmarks (industry, practice_size, region, metric_name, metric_category, benchmark_value, benchmark_low, benchmark_high, effective_from, source)
VALUES
  -- Operating Leases benchmarks
  ('dental_practice', 'all', 'uk', 'operating_leases_pct_revenue', 'operating_leases', 0.12, 0.08, 0.15, '2024-01-01', 'NASDAL Benchmarks 2024'),
  ('dental_practice', 'all', 'uk', 'building_lease_pct_revenue', 'operating_leases', 0.08, 0.06, 0.10, '2024-01-01', 'NASDAL Benchmarks 2024'),
  ('dental_practice', 'all', 'uk', 'equipment_lease_pct_revenue', 'operating_leases', 0.02, 0.01, 0.03, '2024-01-01', 'NASDAL Benchmarks 2024'),
  ('dental_practice', 'all', 'uk', 'vehicle_lease_pct_revenue', 'operating_leases', 0.01, 0.005, 0.015, '2024-01-01', 'NASDAL Benchmarks 2024'),
  ('dental_practice', 'all', 'uk', 'it_software_pct_revenue', 'operating_leases', 0.01, 0.005, 0.015, '2024-01-01', 'NASDAL Benchmarks 2024'),

  -- Staff Costs benchmarks
  ('dental_practice', 'all', 'uk', 'staff_costs_pct_revenue', 'staff_costs', 0.38, 0.35, 0.42, '2024-01-01', 'NASDAL Benchmarks 2024'),

  -- Lab Fees benchmarks
  ('dental_practice', 'all', 'uk', 'lab_fees_pct_revenue', 'lab_fees', 0.075, 0.06, 0.09, '2024-01-01', 'NASDAL Benchmarks 2024')
ON CONFLICT (industry, practice_size, region, metric_name, effective_from) DO NOTHING;


-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on new tables
ALTER TABLE public.lease_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lease_category_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industry_benchmarks ENABLE ROW LEVEL SECURITY;

-- lease_master policies
CREATE POLICY "Users can view lease_master in their organization"
  ON public.lease_master FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert lease_master in their organization"
  ON public.lease_master FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update lease_master in their organization"
  ON public.lease_master FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete lease_master in their organization"
  ON public.lease_master FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
  );

-- lease_category_mapping policies (allow viewing global + org-specific)
CREATE POLICY "Users can view lease_category_mapping"
  ON public.lease_category_mapping FOR SELECT
  USING (
    organization_id IS NULL OR
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage lease_category_mapping in their organization"
  ON public.lease_category_mapping FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
  );

-- industry_benchmarks policies (read-only for all authenticated users)
CREATE POLICY "Authenticated users can view benchmarks"
  ON public.industry_benchmarks FOR SELECT
  TO authenticated
  USING (is_active = true);


-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE public.lease_master IS 'Stores lease contract details that are not available in Xero (expiry dates, renewal terms, etc.)';
COMMENT ON TABLE public.lease_category_mapping IS 'Maps Xero account codes to lease categories (building, equipment, vehicle, it_software)';
COMMENT ON TABLE public.industry_benchmarks IS 'Industry benchmark data for cost analysis comparisons';

COMMENT ON COLUMN public.lease_master.xero_account_code IS 'Primary Xero account code for matching invoice line items';
COMMENT ON COLUMN public.lease_master.xero_contact_id IS 'Xero ContactID of the landlord/lessor for matching invoices';
COMMENT ON COLUMN public.lease_category_mapping.match_keywords IS 'Keywords to auto-match line item descriptions when account code not explicitly mapped';
