-- Formalize 4-tier retention segmentation — documented rule table + shared query surface.
-- Extends 20260830250002 (pe_retention_status) in place; does not replace thresholds.

CREATE OR REPLACE FUNCTION public.pe_max_recall_overdue_days(
  dentist_recall date,
  hygienist_recall date,
  as_of date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT GREATEST(
    CASE
      WHEN dentist_recall IS NOT NULL AND dentist_recall < as_of
      THEN (as_of - dentist_recall)::integer
      ELSE 0
    END,
    CASE
      WHEN hygienist_recall IS NOT NULL AND hygienist_recall < as_of
      THEN (as_of - hygienist_recall)::integer
      ELSE 0
    END
  );
$$;

COMMENT ON FUNCTION public.pe_max_recall_overdue_days(date, date, date) IS
  'Max overdue days across dentist and hygienist recall dates vs as_of (UTC date). 0 when no overdue recall.';

COMMENT ON FUNCTION public.pe_retention_status(uuid, boolean, date, date, timestamptz, date) IS
  '4-tier retention segmentation for Patient Records and Retention & Reactivation.

Rule table (first match wins):
  1. is_active = false → effectively_lost (Derived)
  2. visit_gap_days > retention_effectively_lost_visit_gap_days (default 730) → effectively_lost (Modelled)
  3. recall_overdue_days > retention_effectively_lost_recall_overdue_days (default 180) → effectively_lost (Modelled)
  4. recall_overdue_days > retention_lapsed_recall_overdue_days (default 90) → lapsed (Modelled)
  5. visit_gap_days > retention_lapsed_visit_gap_days (default 365) → lapsed (Modelled)
  6. recall_overdue_days BETWEEN 1 AND lapsed_recall threshold → drifting (Modelled)
  7. visit_gap_days > retention_drifting_visit_gap_days (default 182) → drifting (Modelled)
  8. else → active (Derived)

visit_gap_days = days since last completed appointment (apmt_completed_at or state=completed).
recall_overdue_days = pe_max_recall_overdue_days(dentist_recall, hygienist_recall).
Thresholds tunable per practice in pe_economic_assumptions. Not event_ledger inputs.';

COMMENT ON FUNCTION public.pe_retention_status_tier(uuid, boolean, date, date, timestamptz, date) IS
  'Provenance for pe_retention_status: Derived (Dentally is_active / default active) or Modelled (day thresholds).';

DROP VIEW IF EXISTS public.v_pe_retention_segment;

CREATE VIEW public.v_pe_retention_segment
WITH (security_invoker = true)
AS
WITH patient_last_visit AS (
  SELECT
    p.organization_id AS practice_id,
    p.id AS patient_id,
    MAX(COALESCE(a.apmt_completed_at, a.apmt_start_time)) AS last_completed_at
  FROM public.patients p
  INNER JOIN public.appointments a
    ON a.organization_id = p.organization_id
   AND a.apmt_patient_id = p.pt_id
   AND (
     a.apmt_completed_at IS NOT NULL
     OR LOWER(BTRIM(COALESCE(a.apmt_state, ''))) = 'completed'
   )
   AND LOWER(BTRIM(COALESCE(a.apmt_state, ''))) NOT IN (
     'cancelled', 'did not attend', 'dna'
   )
  WHERE p.deleted_at IS NULL
    AND p.pt_id IS NOT NULL
  GROUP BY p.organization_id, p.id
)
SELECT
  pc.practice_id,
  pc.patient_id,
  pc.pt_id,
  pc.patient_name,
  p.is_active,
  p.pt_dentist_recall_date,
  p.pt_hygienist_recall_date,
  plv.last_completed_at AS last_visit_at,
  public.pe_max_recall_overdue_days(
    p.pt_dentist_recall_date::date,
    p.pt_hygienist_recall_date::date,
    CURRENT_DATE
  ) AS recall_overdue_days,
  CASE
    WHEN plv.last_completed_at IS NOT NULL
    THEN (CURRENT_DATE - plv.last_completed_at::date)::integer
    ELSE NULL
  END AS visit_gap_days,
  pc.retention_status,
  pc.retention_status_tier,
  pc.contribution,
  pc.opportunity_gross,
  pc.quality_score
FROM public.v_patient_contribution pc
INNER JOIN public.patients p
  ON p.id = pc.patient_id
 AND p.organization_id = pc.practice_id
 AND p.deleted_at IS NULL
LEFT JOIN patient_last_visit plv
  ON plv.practice_id = pc.practice_id
 AND plv.patient_id = pc.patient_id;

COMMENT ON VIEW public.v_pe_retention_segment IS
  'Queryable 4-tier retention segment per patient — shared by Patient Records and Retention & Reactivation. Includes recall/visit facts for spot-checks.';

COMMENT ON COLUMN public.v_pe_retention_segment.recall_overdue_days IS
  'Derived — max overdue days across dentist/hygienist recall (pe_max_recall_overdue_days).';

COMMENT ON COLUMN public.v_pe_retention_segment.visit_gap_days IS
  'Derived — days since last completed appointment; NULL when no completed visit on file.';

GRANT SELECT ON public.v_pe_retention_segment TO authenticated;
GRANT SELECT ON public.v_pe_retention_segment TO service_role;
