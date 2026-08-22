-- Multi-user comment threads on 13-week cashflow forecast cells.
-- Unlike cashflow_forecast_overrides (ONE upserted row per cell), this table
-- holds MANY comments per cell from different users — a discussion thread shown
-- below the cell editor. Scoped to the organization via RLS so a tenant only
-- ever sees its OWN users' comments. Author name + email are denormalized at
-- insert time so the thread renders without a cross-user read of profiles
-- (there is no permissive profiles SELECT policy).

CREATE TABLE IF NOT EXISTS public.cashflow_forecast_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id     UUID REFERENCES public.practice_locations(id) ON DELETE CASCADE,
  week_start DATE         NOT NULL,
  line_key   VARCHAR(120) NOT NULL,
  comment    TEXT         NOT NULL,
  author_name  TEXT,
  author_email TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- One lookup per cell (org + location + week + row), returning the whole thread.
CREATE INDEX IF NOT EXISTS idx_cf_forecast_comments_cell
  ON public.cashflow_forecast_comments(organization_id, location_id, week_start, line_key);

ALTER TABLE public.cashflow_forecast_comments ENABLE ROW LEVEL SECURITY;

-- Read: any user that belongs to the organization (so only that tenant's users
-- see the thread — never another org's comments).
DROP POLICY IF EXISTS "cf_forecast_comments_select" ON public.cashflow_forecast_comments;
CREATE POLICY "cf_forecast_comments_select" ON public.cashflow_forecast_comments FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));

-- Insert: must be a member of the org AND must stamp themselves as the author.
DROP POLICY IF EXISTS "cf_forecast_comments_insert" ON public.cashflow_forecast_comments;
CREATE POLICY "cf_forecast_comments_insert" ON public.cashflow_forecast_comments FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id) AND created_by = auth.uid());

-- Delete: org member AND only their own comments (delete-own-only).
DROP POLICY IF EXISTS "cf_forecast_comments_delete" ON public.cashflow_forecast_comments;
CREATE POLICY "cf_forecast_comments_delete" ON public.cashflow_forecast_comments FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id) AND created_by = auth.uid());

COMMENT ON TABLE public.cashflow_forecast_comments IS
  'Multi-user comment threads on 13-week cashflow forecast cells. Many rows per (org, location, week_start, line_key). Org-scoped read via RLS; insert/delete restricted to the authoring user.';
