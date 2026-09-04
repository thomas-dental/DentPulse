-- Invoices worklist: TopBar period filters on raised date (invoice_date) only.

CREATE OR REPLACE FUNCTION public.pe_invoices_mapped_rows(
  p_org_ids UUID[],
  p_location_id UUID DEFAULT NULL,
  p_period_start DATE DEFAULT NULL,
  p_period_end DATE DEFAULT NULL,
  p_today DATE DEFAULT CURRENT_DATE,
  p_cash_leakage_days INT DEFAULT 30,
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
    WITH inv AS (
      SELECT
        i.organization_id,
        o.name AS organization_name,
        i.platform_invoice_id,
        i.invoice_number,
        i.invoice_date,
        i.due_date,
        i.subtotal,
        i.amount_outstanding,
        i.status,
        i.is_paid,
        i.patient_id,
        i.account_id,
        i.invoice_uuid,
        i.location_id
      FROM public.platform_integration_invoices i
      INNER JOIN public.organizations o
        ON o.id = i.organization_id
      WHERE i.organization_id = ANY (p_org_ids)
        AND i.platform_type = 'dentally'
        AND i.deleted_at IS NULL
        AND (p_location_id IS NULL OR i.location_id = p_location_id)
        AND (
          p_period_start IS NULL
          OR p_period_end IS NULL
          OR (
            i.invoice_date IS NOT NULL
            AND i.invoice_date::date BETWEEN p_period_start AND p_period_end
          )
        )
    ),
    joined AS (
      SELECT
        inv.*,
        pl.location_name,
        NULLIF(TRIM(CONCAT(p.pt_first_name, ' ', p.pt_last_name)), '') AS patient_name,
        NULLIF(BTRIM(p.pt_unique_id::text), '') AS pt_unique_id,
        p.id AS patient_record_id,
        (p.pt_payment_plan_id IS NOT NULL AND p.pt_payment_plan_id::numeric > 0) AS on_payment_plan,
        COALESCE(a_inv.da_uuid, a_pt.da_uuid) AS account_uuid
      FROM inv
      LEFT JOIN public.patients p
        ON p.organization_id = inv.organization_id
       AND p.pt_id = NULLIF(BTRIM(inv.patient_id::text), '')::bigint
       AND p.deleted_at IS NULL
      LEFT JOIN public.practice_locations pl
        ON pl.id = inv.location_id
       AND pl.deleted_at IS NULL
      LEFT JOIN public.dentally_patients_accounts a_inv
        ON a_inv.organization_id = inv.organization_id
       AND a_inv.da_id = inv.account_id
       AND a_inv.deleted_at IS NULL
      LEFT JOIN public.dentally_patients_accounts a_pt
        ON a_pt.organization_id = inv.organization_id
       AND a_pt.da_id = NULLIF(BTRIM(p.pt_account_id), '')::bigint
       AND a_pt.deleted_at IS NULL
    ),
    computed AS (
      SELECT
        j.*,
        ROUND(
          CASE
            WHEN COALESCE(j.amount_outstanding, 0) > 0 THEN j.amount_outstanding
            WHEN COALESCE(j.is_paid, false) THEN 0::numeric
            ELSE COALESCE(j.subtotal, 0)
          END,
          2
        ) AS outstanding_gbp,
        CASE
          WHEN j.due_date IS NOT NULL OR j.invoice_date IS NOT NULL THEN
            GREATEST(
              0,
              p_today - COALESCE(j.due_date::date, j.invoice_date::date)
            )
          ELSE 0
        END AS days_past_due,
        CASE
          WHEN j.invoice_date IS NOT NULL THEN
            GREATEST(0, p_today - j.invoice_date::date)
          ELSE 0
        END AS days_since_raised
      FROM joined j
    ),
    final AS (
      SELECT
        c.*,
        CASE
          WHEN c.days_past_due <= p_aging_b0 THEN '0-30'
          WHEN c.days_past_due <= p_aging_b1 THEN '31-60'
          WHEN c.days_past_due <= p_aging_b2 THEN '61-90'
          ELSE '90+'
        END AS aging_bucket,
        (
          c.outstanding_gbp > 0
          AND LOWER(COALESCE(c.status, '')) <> 'voided'
        ) AS is_outstanding,
        (COALESCE(c.is_paid, false) OR c.outstanding_gbp <= 0) AS is_paid_display,
        (
          c.invoice_date IS NOT NULL
          AND COALESCE(c.subtotal, 0) > 0
          AND LOWER(COALESCE(c.status, '')) NOT IN ('draft', 'voided', 'deleted')
        ) AS is_charged
      FROM computed c
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'organization_id', f.organization_id,
          'organization_name', f.organization_name,
          'platform_invoice_id', f.platform_invoice_id,
          'invoice_number', f.invoice_number,
          'invoice_date', f.invoice_date,
          'due_date', f.due_date,
          'subtotal', f.subtotal,
          'amount_outstanding', f.amount_outstanding,
          'status', f.status,
          'is_paid', f.is_paid,
          'patient_id', f.patient_id,
          'account_id', f.account_id,
          'invoice_uuid', f.invoice_uuid,
          'location_id', f.location_id,
          'location_name', f.location_name,
          'patient_name', f.patient_name,
          'pt_unique_id', f.pt_unique_id,
          'patient_record_id', f.patient_record_id,
          'on_payment_plan', f.on_payment_plan,
          'account_uuid', f.account_uuid,
          'outstanding_gbp', f.outstanding_gbp,
          'days_past_due', f.days_past_due,
          'days_since_raised', f.days_since_raised,
          'aging_bucket', f.aging_bucket,
          'is_outstanding', f.is_outstanding,
          'is_paid_display', f.is_paid_display,
          'is_cash_leakage', (
            f.is_charged
            AND f.is_outstanding
            AND f.days_since_raised >= p_cash_leakage_days
          )
        )
        ORDER BY f.invoice_date DESC NULLS LAST, f.platform_invoice_id
      ),
      '[]'::jsonb
    )
    FROM final f
  );
END;
$$;

COMMENT ON FUNCTION public.pe_invoices_mapped_rows(
  UUID[], UUID, DATE, DATE, DATE, INT, INT, INT, INT
) IS
  'Invoice worklist rows scoped by raised date (invoice_date) when period set; outstanding KPIs use pe_invoices_outstanding_kpis.';
