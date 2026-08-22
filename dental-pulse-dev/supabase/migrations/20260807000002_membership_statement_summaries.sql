-- ============================================
-- Practice Plan statement header + event persistence
--
-- The Practice Plan monthly statement PDF contains (per dentist):
--   - Summary page totals (collections, failed collections, total collected)
--   - Failed Collections rows  — the practice's ONLY visibility of DD failures
--   - Cancelled Patients rows  — leavers, at statement-month granularity
-- Until now the upload pipeline imported only the member collection rows and
-- discarded everything else. These two tables persist the statement header
-- (one row per org + month + dentist statement) and its informational event
-- rows, enabling arrears exposure, gross-vs-net reconciliation and
-- churn-signal features.
-- ============================================

CREATE TABLE IF NOT EXISTS public.membership_statement_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  upload_location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  source TEXT NOT NULL DEFAULT 'practice-plan',
  treating_dentist TEXT,                       -- statement dentist (page header)
  statement_month INTEGER NOT NULL CHECK (statement_month BETWEEN 1 AND 12),
  statement_year INTEGER NOT NULL CHECK (statement_year BETWEEN 2000 AND 2100),
  file_name TEXT,

  -- Statement's own Summary-page numbers (authoritative where present)
  new_patient_count INTEGER,
  new_patient_value NUMERIC(12, 2),
  existing_patient_count INTEGER,
  existing_patient_value NUMERIC(12, 2),
  total_collected_value NUMERIC(12, 2),
  failed_collection_count INTEGER,
  failed_collection_value NUMERIC(12, 2),
  cancelled_patient_count INTEGER,

  -- Raw parsed structures, kept whole for future features / reconciliation
  plan_breakdown JSONB,                        -- [{code, description, price, monthly, annual, total}]
  summary_lines JSONB,                         -- [{label, count, value}] — every Summary-page line

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mss_org_period
  ON public.membership_statement_summaries(organization_id, statement_year, statement_month);
CREATE INDEX IF NOT EXISTS idx_mss_deleted_at
  ON public.membership_statement_summaries(deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.membership_statement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  statement_id UUID NOT NULL REFERENCES public.membership_statement_summaries(id) ON DELETE CASCADE,

  event_type TEXT NOT NULL CHECK (event_type IN ('failed_collection', 'cancelled_patient')),

  -- Practice Plan's own patient id — same id space as
  -- membership_upload_members.pay_grp_id, which is how an event row joins back
  -- to a member row (and from there to the matched Dentally patient).
  pp_patient_id TEXT,
  surname TEXT,
  title TEXT,
  initial TEXT,
  dob DATE,
  plan_code TEXT,
  fee_category TEXT,                           -- plan description resolved from the statement's Plan Breakdown
  amount NUMERIC(12, 2),
  event_date DATE,                             -- failure/cancellation date when the row carries one
  raw_line TEXT,                               -- original statement text, kept verbatim

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mse_statement_id ON public.membership_statement_events(statement_id);
CREATE INDEX IF NOT EXISTS idx_mse_org_type ON public.membership_statement_events(organization_id, event_type);
CREATE INDEX IF NOT EXISTS idx_mse_org_pp_patient ON public.membership_statement_events(organization_id, pp_patient_id);

-- ============================================
-- ROW LEVEL SECURITY (uploads run client-side, so org users need full CRUD)
-- ============================================
ALTER TABLE public.membership_statement_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_statement_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view statement summaries in their org" ON public.membership_statement_summaries;
CREATE POLICY "Users can view statement summaries in their org"
ON public.membership_statement_summaries FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert statement summaries in their org" ON public.membership_statement_summaries;
CREATE POLICY "Users can insert statement summaries in their org"
ON public.membership_statement_summaries FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update statement summaries in their org" ON public.membership_statement_summaries;
CREATE POLICY "Users can update statement summaries in their org"
ON public.membership_statement_summaries FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete statement summaries in their org" ON public.membership_statement_summaries;
CREATE POLICY "Users can delete statement summaries in their org"
ON public.membership_statement_summaries FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Service role full access to membership_statement_summaries" ON public.membership_statement_summaries;
CREATE POLICY "Service role full access to membership_statement_summaries"
ON public.membership_statement_summaries FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can view statement events in their org" ON public.membership_statement_events;
CREATE POLICY "Users can view statement events in their org"
ON public.membership_statement_events FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert statement events in their org" ON public.membership_statement_events;
CREATE POLICY "Users can insert statement events in their org"
ON public.membership_statement_events FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete statement events in their org" ON public.membership_statement_events;
CREATE POLICY "Users can delete statement events in their org"
ON public.membership_statement_events FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Service role full access to membership_statement_events" ON public.membership_statement_events;
CREATE POLICY "Service role full access to membership_statement_events"
ON public.membership_statement_events FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- updated_at trigger (summaries only; events are insert-only)
-- ============================================
CREATE OR REPLACE FUNCTION update_membership_statement_summaries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_membership_statement_summaries_updated_at ON public.membership_statement_summaries;
CREATE TRIGGER update_membership_statement_summaries_updated_at
    BEFORE UPDATE ON public.membership_statement_summaries
    FOR EACH ROW
    EXECUTE FUNCTION update_membership_statement_summaries_updated_at();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE public.membership_statement_summaries IS 'One row per uploaded Practice Plan statement (org + month + dentist): Summary-page totals plus the raw plan breakdown. Replaced wholesale on re-upload of the same statement.';
COMMENT ON TABLE public.membership_statement_events IS 'Failed Collections / Cancelled Patients rows from a Practice Plan statement. pp_patient_id joins membership_upload_members.pay_grp_id to reach the matched Dentally patient.';
COMMENT ON COLUMN public.membership_statement_events.event_date IS 'Failure/cancellation date printed on the row, when present. DOB-vs-event classification is by year proximity to the statement period.';
