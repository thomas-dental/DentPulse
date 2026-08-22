-- ============================================
-- Patient plan-membership change capture
--
-- Dentally exposes plan membership only as a point-in-time snapshot on the
-- patient record (pt_payment_plan_id / pt_payment_plan_subscription_id /
-- pt_payment_plan_subscription_status) — there is no subscription-history
-- endpoint, so join/leave/plan-change dates cannot be recovered from the API.
-- This trigger records every observed transition of those three columns so
-- membership tenure, joiners/leavers and clinician conversion can be computed
-- from real dates going forward.
--
-- change_type semantics:
--   'baseline'       — first time we see this patient WITH a plan (row INSERT).
--                      NOT a real join date — the patient may have been on the
--                      plan for years before the org connected DentPulse.
--                      Churn/conversion consumers must ignore baseline rows.
--   'joined'         — plan id went NULL → NOT NULL (real join, observed).
--   'left'           — plan id went NOT NULL → NULL (real leave, observed).
--   'plan_changed'   — plan id changed between two non-null values.
--   'status_changed' — subscription id/status changed, plan id unchanged.
--
-- Event dates are observation dates (when the sync saw the change), bounded by
-- sync frequency — accurate to ~1 day under the nightly auto-sync.
-- ============================================

CREATE TABLE IF NOT EXISTS public.patient_plan_membership_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES public.integrations(id) ON DELETE SET NULL,
  location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL,
  patient_row_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  pt_id BIGINT,                              -- Dentally patient id (denormalised; scope lookups by integration_id — Dentally ids collide across integrations)

  change_type VARCHAR(20) NOT NULL CHECK (change_type IN ('baseline', 'joined', 'left', 'plan_changed', 'status_changed')),

  old_payment_plan_id BIGINT,
  new_payment_plan_id BIGINT,
  old_subscription_id VARCHAR(255),
  new_subscription_id VARCHAR(255),
  old_subscription_status VARCHAR(100),
  new_subscription_status VARCHAR(100),

  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ppme_org_changed_at ON public.patient_plan_membership_events(organization_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_ppme_patient_row_id ON public.patient_plan_membership_events(patient_row_id);
CREATE INDEX IF NOT EXISTS idx_ppme_org_change_type ON public.patient_plan_membership_events(organization_id, change_type);
CREATE INDEX IF NOT EXISTS idx_ppme_org_pt_id ON public.patient_plan_membership_events(organization_id, pt_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE public.patient_plan_membership_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view plan membership events in their org" ON public.patient_plan_membership_events;
CREATE POLICY "Users can view plan membership events in their org"
ON public.patient_plan_membership_events FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Service role full access to patient_plan_membership_events" ON public.patient_plan_membership_events;
CREATE POLICY "Service role full access to patient_plan_membership_events"
ON public.patient_plan_membership_events FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- No user INSERT/UPDATE/DELETE policies: rows are written only by the trigger
-- below (SECURITY DEFINER, so it works regardless of the writing role's RLS).

-- ============================================
-- TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION public.capture_patient_plan_membership_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_change_type VARCHAR(20);
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Baseline observation: only interesting when the patient arrives with a plan.
    IF NEW.pt_payment_plan_id IS NOT NULL OR NEW.pt_payment_plan_subscription_id IS NOT NULL THEN
      INSERT INTO public.patient_plan_membership_events (
        organization_id, integration_id, location_id, patient_row_id, pt_id,
        change_type,
        old_payment_plan_id, new_payment_plan_id,
        old_subscription_id, new_subscription_id,
        old_subscription_status, new_subscription_status
      ) VALUES (
        NEW.organization_id, NEW.integration_id, NEW.location_id, NEW.id, NEW.pt_id,
        'baseline',
        NULL, NEW.pt_payment_plan_id,
        NULL, NEW.pt_payment_plan_subscription_id,
        NULL, NEW.pt_payment_plan_subscription_status
      );
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: record only real transitions. Sync upserts rewrite the whole row
  -- on every run, so IS DISTINCT FROM guards keep no-op writes out.
  IF NEW.pt_payment_plan_id IS DISTINCT FROM OLD.pt_payment_plan_id
     OR NEW.pt_payment_plan_subscription_id IS DISTINCT FROM OLD.pt_payment_plan_subscription_id
     OR NEW.pt_payment_plan_subscription_status IS DISTINCT FROM OLD.pt_payment_plan_subscription_status THEN

    v_change_type := CASE
      WHEN OLD.pt_payment_plan_id IS NULL AND NEW.pt_payment_plan_id IS NOT NULL THEN 'joined'
      WHEN OLD.pt_payment_plan_id IS NOT NULL AND NEW.pt_payment_plan_id IS NULL THEN 'left'
      WHEN NEW.pt_payment_plan_id IS DISTINCT FROM OLD.pt_payment_plan_id THEN 'plan_changed'
      ELSE 'status_changed'
    END;

    INSERT INTO public.patient_plan_membership_events (
      organization_id, integration_id, location_id, patient_row_id, pt_id,
      change_type,
      old_payment_plan_id, new_payment_plan_id,
      old_subscription_id, new_subscription_id,
      old_subscription_status, new_subscription_status
    ) VALUES (
      NEW.organization_id, NEW.integration_id, NEW.location_id, NEW.id, NEW.pt_id,
      v_change_type,
      OLD.pt_payment_plan_id, NEW.pt_payment_plan_id,
      OLD.pt_payment_plan_subscription_id, NEW.pt_payment_plan_subscription_id,
      OLD.pt_payment_plan_subscription_status, NEW.pt_payment_plan_subscription_status
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS capture_patient_plan_membership_change ON public.patients;
CREATE TRIGGER capture_patient_plan_membership_change
  AFTER INSERT OR UPDATE OF pt_payment_plan_id, pt_payment_plan_subscription_id, pt_payment_plan_subscription_status
  ON public.patients
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_patient_plan_membership_change();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE public.patient_plan_membership_events IS 'Observed transitions of a patient''s Dentally payment-plan membership (join/leave/plan change/status change). Written only by the patients-table trigger; observation-dated, so accuracy is bounded by sync frequency. baseline rows are first-sight snapshots, not real join dates.';
COMMENT ON COLUMN public.patient_plan_membership_events.change_type IS 'baseline = first sight with a plan (ignore for churn); joined/left/plan_changed/status_changed = real observed transitions.';
COMMENT ON COLUMN public.patient_plan_membership_events.pt_id IS 'Dentally patient id. Dentally ids collide across integrations — always scope lookups by integration_id.';
