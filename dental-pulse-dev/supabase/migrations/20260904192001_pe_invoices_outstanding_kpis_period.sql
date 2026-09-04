-- Outstanding KPIs: filter by raised date (invoice_date) when period set; align total with Dentally unpaid sum.

DROP FUNCTION IF EXISTS public.pe_invoices_outstanding_kpis(
  UUID, UUID[], UUID, DATE, INT, INT, INT
);

CREATE OR REPLACE FUNCTION public.pe_invoices_outstanding_kpis(
  p_practice_id UUID,
  p_org_ids UUID[],
  p_location_id UUID DEFAULT NULL,
  p_period_start DATE DEFAULT NULL,
  p_period_end DATE DEFAULT NULL,
  p_today DATE DEFAULT CURRENT_DATE,
  p_aging_b0 INT DEFAULT 30,
  p_aging_b1 INT DEFAULT 60,
  p_aging_b2 INT DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('statement_timeout', '180000', true);

  RETURN (
    WITH inv AS MATERIALIZED (
      SELECT
        i.organization_id,
        i.patient_id,
        i.due_date,
        i.invoice_date,
        i.subtotal,
        i.amount_outstanding,
        i.status,
        i.is_paid,
        ROUND(COALESCE(i.amount_outstanding, 0)::numeric, 2) AS outstanding_gbp,
        GREATEST(
          0,
          p_today - COALESCE(i.due_date::date, i.invoice_date::date)
        ) AS days_past_due
      FROM public.platform_integration_invoices i
      WHERE i.organization_id = ANY (p_org_ids)
        AND i.platform_type = 'dentally'
        AND i.deleted_at IS NULL
        AND (p_location_id IS NULL OR i.location_id = p_location_id)
        AND (
          p_location_id IS NOT NULL
          OR i.organization_id = p_practice_id
        )
        AND LOWER(COALESCE(i.status, '')) <> 'voided'
        AND COALESCE(i.is_paid, false) IS NOT TRUE
        AND (
          p_period_start IS NULL
          OR p_period_end IS NULL
          OR (
            i.invoice_date IS NOT NULL
            AND i.invoice_date::date BETWEEN p_period_start AND p_period_end
          )
        )
    ),
    outstanding AS (
      SELECT *
      FROM inv
      WHERE outstanding_gbp > 0
    ),
    with_plan AS (
      SELECT
        o.outstanding_gbp,
        o.days_past_due,
        o.patient_id,
        (
          p.pt_payment_plan_id IS NOT NULL
          AND p.pt_payment_plan_id::numeric > 0
        ) AS on_payment_plan
      FROM outstanding o
      LEFT JOIN public.patients p
        ON p.organization_id = o.organization_id
       AND p.pt_id = NULLIF(BTRIM(o.patient_id::text), '')::bigint
       AND p.deleted_at IS NULL
    ),
    bucketed AS (
      SELECT
        CASE
          WHEN days_past_due <= p_aging_b0 THEN '0-30'
          WHEN days_past_due <= p_aging_b1 THEN '31-60'
          WHEN days_past_due <= p_aging_b2 THEN '61-90'
          ELSE '90+'
        END AS bucket,
        outstanding_gbp
      FROM with_plan
    ),
    bucket_agg AS (
      SELECT
        bucket,
        SUM(outstanding_gbp) AS outstanding_gbp,
        COUNT(*)::int AS invoice_count
      FROM bucketed
      GROUP BY bucket
    ),
    bucket_labels AS (
      SELECT *
      FROM (
        VALUES
          ('0-30', '0–30 days', 1),
          ('31-60', '31–60 days', 2),
          ('61-90', '61–90 days', 3),
          ('90+', '90+ days', 4)
      ) AS t(bucket, label, sort_order)
    )
    SELECT jsonb_build_object(
      'totalOutstandingGbp',
        ROUND(COALESCE((SELECT SUM(outstanding_gbp) FROM inv), 0)::numeric, 2),
      'overdue60PlusGbp',
        ROUND(
          COALESCE(
            (SELECT SUM(outstanding_gbp) FROM outstanding WHERE days_past_due > 60),
            0
          )::numeric,
          2
        ),
      'onPaymentPlanOutstandingGbp',
        ROUND(
          COALESCE(
            (SELECT SUM(outstanding_gbp) FROM with_plan WHERE on_payment_plan),
            0
          )::numeric,
          2
        ),
      'onPaymentPlanArrangementCount',
        COALESCE(
          (
            SELECT COUNT(DISTINCT patient_id)::int
            FROM with_plan
            WHERE on_payment_plan
              AND patient_id IS NOT NULL
              AND BTRIM(patient_id::text) <> ''
          ),
          0
        ),
      'agedBuckets',
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'bucket', bl.bucket,
                'label', bl.label,
                'outstandingGbp', ROUND(COALESCE(ba.outstanding_gbp, 0)::numeric, 2),
                'invoiceCount', COALESCE(ba.invoice_count, 0)
              )
              ORDER BY bl.sort_order
            )
            FROM bucket_labels bl
            LEFT JOIN bucket_agg ba ON ba.bucket = bl.bucket
          ),
          '[]'::jsonb
        )
    )
  );
END;
$$;

COMMENT ON FUNCTION public.pe_invoices_outstanding_kpis(
  UUID, UUID[], UUID, DATE, DATE, DATE, INT, INT, INT
) IS
  'Outstanding invoice KPIs for PE Invoices; scoped by raised date when period set. Total sums unpaid amount_outstanding (Dentally-aligned).';

GRANT EXECUTE ON FUNCTION public.pe_invoices_outstanding_kpis(
  UUID, UUID[], UUID, DATE, DATE, DATE, INT, INT, INT
) TO service_role;
