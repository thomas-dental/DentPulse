-- Batch-evaluate open reactivation flags: PATIENT_REACTIVATED + recovery window contribution.

CREATE INDEX IF NOT EXISTS idx_event_ledger_patient_reactivated
  ON public.event_ledger (practice_id, patient_id, created_at)
  WHERE event_type = 'PATIENT_REACTIVATED';

CREATE OR REPLACE FUNCTION public.pe_evaluate_reactivation_recovery(p_practice_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_use_facts boolean := false;
  v_recovered integer := 0;
BEGIN
  PERFORM set_config('statement_timeout', '120000', true);

  SELECT EXISTS (
    SELECT 1
    FROM public.pe_invoice_contribution_facts f
    WHERE f.practice_id = p_practice_id
    LIMIT 1
  )
  INTO v_use_facts;

  WITH open_flags AS (
    SELECT
      fl.id,
      fl.patient_id,
      fl.flagged_at,
      GREATEST(1, COALESCE(fl.recovery_window_days, 365)) AS recovery_window_days
    FROM public.pe_reactivation_flags fl
    WHERE fl.practice_id = p_practice_id
      AND fl.status = 'open'
  ),
  reactivation AS (
    SELECT DISTINCT ON (of.id)
      of.id AS flag_id,
      of.patient_id,
      of.recovery_window_days,
      el.created_at AS reactivated_at
    FROM open_flags of
    JOIN public.event_ledger el
      ON el.practice_id = p_practice_id
     AND el.patient_id = of.patient_id
     AND el.event_type = 'PATIENT_REACTIVATED'
     AND el.created_at > of.flagged_at
    ORDER BY of.id, el.created_at ASC
  ),
  recovered_sum AS (
    SELECT
      r.flag_id,
      r.reactivated_at,
      ROUND(
        CASE
          WHEN v_use_facts THEN (
            SELECT COALESCE(SUM(f.contribution), 0)
            FROM public.pe_invoice_contribution_facts f
            WHERE f.practice_id = p_practice_id
              AND f.patient_id = r.patient_id
              AND f.invoice_date >= r.reactivated_at::date
              AND f.invoice_date <= (
                r.reactivated_at + (r.recovery_window_days || ' days')::interval
              )::date
          )
          ELSE (
            SELECT COALESCE(SUM(v.contribution), 0)
            FROM public.v_invoice_contribution v
            WHERE v.practice_id = p_practice_id
              AND v.patient_id = r.patient_id
              AND v.invoice_date >= r.reactivated_at::date
              AND v.invoice_date <= (
                r.reactivated_at + (r.recovery_window_days || ' days')::interval
              )::date
          )
        END,
        2
      ) AS contribution_recovered
    FROM reactivation r
  ),
  updated AS (
    UPDATE public.pe_reactivation_flags fl
    SET
      status = 'recovered',
      recovered_at = rs.reactivated_at,
      reactivation_event_at = rs.reactivated_at,
      contribution_recovered = rs.contribution_recovered,
      updated_at = NOW()
    FROM recovered_sum rs
    WHERE fl.id = rs.flag_id
      AND fl.status = 'open'
    RETURNING fl.id
  )
  SELECT COUNT(*)::integer INTO v_recovered FROM updated;

  RETURN jsonb_build_object('recovered', COALESCE(v_recovered, 0));
EXCEPTION
  WHEN undefined_table THEN
    RETURN jsonb_build_object('recovered', 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pe_evaluate_reactivation_recovery(UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.pe_evaluate_reactivation_recovery(UUID) IS
  'Mark open reactivation flags recovered when PATIENT_REACTIVATED follows flagged_at; sums invoice contribution within recovery window (batch).';
