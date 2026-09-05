-- ============================================================================
-- Patient Economics — effective-dated practitioner private-share rates
--
-- One row per (practice, practitioner, effective_from). Rate history is
-- append-only: never UPDATE rate/effective_from in place — always INSERT a
-- new row so invoice-based contribution resolves to the rate in force on the
-- invoice date.
--
-- practice_id = public.organizations(id) — same key as sync_cursors / PE PAT.
-- practitioner_id = public.providers(id) — Dentally practitioner via external_id.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.practitioner_private_share_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  practice_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rate NUMERIC(5, 2) NOT NULL
    CHECK (rate >= 0 AND rate <= 100),
  effective_from DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT practitioner_private_share_rates_unique_effective
    UNIQUE (practice_id, practitioner_id, effective_from)
);

COMMENT ON TABLE public.practitioner_private_share_rates IS
  'Patient Economics: append-only per-practitioner private-share % history. Org members SELECT; INSERT via service_role only. Resolve rate for an invoice date with the latest row where effective_from <= invoice_date.';
COMMENT ON COLUMN public.practitioner_private_share_rates.practice_id IS
  'FK to public.organizations (tenant / practice). Same key as PE sync_cursors.';
COMMENT ON COLUMN public.practitioner_private_share_rates.practitioner_id IS
  'FK to public.providers.id (Dentally practitioner row for this practice).';
COMMENT ON COLUMN public.practitioner_private_share_rates.rate IS
  'Associate private-share percentage (0–100). Clinician retains this % of attributed private/plan revenue.';
COMMENT ON COLUMN public.practitioner_private_share_rates.effective_from IS
  'First calendar date this rate applies (inclusive). Never changed in place — insert a new row instead.';
COMMENT ON COLUMN public.practitioner_private_share_rates.created_by IS
  'Authenticated user who recorded the rate via backend (nullable when written by system seed).';

CREATE INDEX IF NOT EXISTS idx_practitioner_private_share_rates_lookup
  ON public.practitioner_private_share_rates (practice_id, practitioner_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS idx_practitioner_private_share_rates_practice_id
  ON public.practitioner_private_share_rates (practice_id);

-- ---------------------------------------------------------------------------
-- Practitioner must belong to the practice (providers.organization_id)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.practitioner_private_share_rates_assert_practice()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.providers p
    WHERE p.id = NEW.practitioner_id
      AND p.organization_id = NEW.practice_id
  ) THEN
    RAISE EXCEPTION
      'practitioner_private_share_rates: practitioner % does not belong to practice %',
      NEW.practitioner_id,
      NEW.practice_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS practitioner_private_share_rates_assert_practice
  ON public.practitioner_private_share_rates;
CREATE TRIGGER practitioner_private_share_rates_assert_practice
  BEFORE INSERT ON public.practitioner_private_share_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.practitioner_private_share_rates_assert_practice();

-- ---------------------------------------------------------------------------
-- Append-only: reject UPDATE/DELETE for all roles (corrections = new INSERT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.practitioner_private_share_rates_reject_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'practitioner_private_share_rates is append-only: UPDATE not allowed';
END;
$$;

CREATE OR REPLACE FUNCTION public.practitioner_private_share_rates_reject_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'practitioner_private_share_rates is append-only: DELETE not allowed';
END;
$$;

DROP TRIGGER IF EXISTS practitioner_private_share_rates_no_update
  ON public.practitioner_private_share_rates;
CREATE TRIGGER practitioner_private_share_rates_no_update
  BEFORE UPDATE ON public.practitioner_private_share_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.practitioner_private_share_rates_reject_update();

DROP TRIGGER IF EXISTS practitioner_private_share_rates_no_delete
  ON public.practitioner_private_share_rates;
CREATE TRIGGER practitioner_private_share_rates_no_delete
  BEFORE DELETE ON public.practitioner_private_share_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.practitioner_private_share_rates_reject_delete();

-- ---------------------------------------------------------------------------
-- RLS + grants (match event_ledger / sync_cursors PE pattern)
-- ---------------------------------------------------------------------------
ALTER TABLE public.practitioner_private_share_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view practitioner private share rates for their practice"
  ON public.practitioner_private_share_rates;
CREATE POLICY "Users can view practitioner private share rates for their practice"
  ON public.practitioner_private_share_rates
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.user_in_org(auth.uid(), practice_id)
  );

REVOKE ALL ON TABLE public.practitioner_private_share_rates FROM anon, authenticated;
GRANT SELECT ON TABLE public.practitioner_private_share_rates TO authenticated;

REVOKE ALL ON TABLE public.practitioner_private_share_rates FROM service_role;
GRANT SELECT, INSERT ON TABLE public.practitioner_private_share_rates TO service_role;
