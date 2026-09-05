-- PE Invoices tab: single-pass mapped invoice rows + batched collection totals.
-- Replaces paginated invoice + patient + full-account scans in invoicesSummary.js.

CREATE INDEX IF NOT EXISTS idx_dpa_org_da_id_uuid_live
  ON public.dentally_patients_accounts (organization_id, da_id)
  INCLUDE (da_uuid)
  WHERE deleted_at IS NULL AND da_uuid IS NOT NULL;

-- ---------------------------------------------------------------------------
-- pe_invoices_mapped_rows — scoped invoices with patient, location, account JOINs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pe_invoices_mapped_rows(
  p_org_ids UUID[],
  p_location_id UUID DEFAULT NULL,
  p_period_start DATE DEFAULT NULL,
  p_period_end DATE DEFAULT NULL
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
          (
            p_period_start IS NOT NULL
            AND p_period_end IS NOT NULL
            AND i.invoice_date::date BETWEEN p_period_start AND p_period_end
          )
          OR (
            LOWER(COALESCE(i.status, '')) <> 'voided'
            AND (
              COALESCE(i.amount_outstanding, 0) > 0
              OR (
                COALESCE(i.is_paid, false) IS NOT TRUE
                AND COALESCE(i.subtotal, 0) > 0
              )
            )
          )
        )
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'organization_id', inv.organization_id,
          'organization_name', inv.organization_name,
          'platform_invoice_id', inv.platform_invoice_id,
          'invoice_number', inv.invoice_number,
          'invoice_date', inv.invoice_date,
          'due_date', inv.due_date,
          'subtotal', inv.subtotal,
          'amount_outstanding', inv.amount_outstanding,
          'status', inv.status,
          'is_paid', inv.is_paid,
          'patient_id', inv.patient_id,
          'account_id', inv.account_id,
          'invoice_uuid', inv.invoice_uuid,
          'location_id', inv.location_id,
          'location_name', pl.location_name,
          'patient_name', NULLIF(
            TRIM(CONCAT(p.pt_first_name, ' ', p.pt_last_name)),
            ''
          ),
          'pt_unique_id', NULLIF(BTRIM(p.pt_unique_id::text), ''),
          'patient_record_id', p.id,
          'pt_account_id', p.pt_account_id,
          'on_payment_plan', (
            p.pt_payment_plan_id IS NOT NULL
            AND p.pt_payment_plan_id::numeric > 0
          ),
          'account_uuid', COALESCE(a_inv.da_uuid, a_pt.da_uuid)
        )
        ORDER BY inv.invoice_date DESC NULLS LAST, inv.platform_invoice_id
      ),
      '[]'::jsonb
    )
    FROM inv
    LEFT JOIN public.patients p
      ON p.organization_id = inv.organization_id
     AND p.pt_id = inv.patient_id::bigint
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
  );
END;
$$;

COMMENT ON FUNCTION public.pe_invoices_mapped_rows(UUID[], UUID, DATE, DATE) IS
  'Scoped invoice rows for PE Invoices tab with patient, location, and account UUID joins (one pass).';

GRANT EXECUTE ON FUNCTION public.pe_invoices_mapped_rows(UUID[], UUID, DATE, DATE) TO service_role;

-- ---------------------------------------------------------------------------
-- pe_invoices_collection_totals — invoiced + collected per rollup unit
-- p_units: [{ "unitId", "unitName", "organizationId", "locationId"? }]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pe_invoices_collection_totals(
  p_units JSONB,
  p_period_start DATE,
  p_period_end DATE
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
    WITH units AS (
      SELECT
        u->>'unitId' AS unit_id,
        u->>'unitName' AS unit_name,
        (u->>'organizationId')::uuid AS organization_id,
        NULLIF(u->>'locationId', '')::uuid AS location_id
      FROM jsonb_array_elements(COALESCE(p_units, '[]'::jsonb)) AS u
    ),
    invoiced AS (
      SELECT
        un.unit_id,
        un.unit_name,
        COALESCE(SUM(i.subtotal), 0)::numeric AS invoiced_gbp
      FROM units un
      LEFT JOIN public.platform_integration_invoices i
        ON i.organization_id = un.organization_id
       AND i.platform_type = 'dentally'
       AND i.deleted_at IS NULL
       AND i.invoice_date::date BETWEEN p_period_start AND p_period_end
       AND (un.location_id IS NULL OR i.location_id = un.location_id)
      GROUP BY un.unit_id, un.unit_name
    ),
    collected AS (
      SELECT
        un.unit_id,
        COALESCE(SUM(pay.dp_amount), 0)::numeric AS collected_gbp
      FROM units un
      LEFT JOIN public.dentally_payments pay
        ON pay.organization_id = un.organization_id
       AND pay.deleted_at IS NULL
       AND pay.dp_dated_on::date BETWEEN p_period_start AND p_period_end
       AND (un.location_id IS NULL OR pay.location_id = un.location_id)
      GROUP BY un.unit_id
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'practiceId', iv.unit_id,
          'practiceName', iv.unit_name,
          'invoicedGbp', ROUND(iv.invoiced_gbp::numeric, 2),
          'collectedGbp', ROUND(COALESCE(c.collected_gbp, 0)::numeric, 2),
          'collectionRate', CASE
            WHEN iv.invoiced_gbp > 0 THEN
              ROUND(COALESCE(c.collected_gbp, 0) / iv.invoiced_gbp, 4)
            ELSE NULL
          END
        )
        ORDER BY iv.unit_name
      ),
      '[]'::jsonb
    )
    FROM invoiced iv
    LEFT JOIN collected c ON c.unit_id = iv.unit_id
  );
END;
$$;

COMMENT ON FUNCTION public.pe_invoices_collection_totals(JSONB, DATE, DATE) IS
  'Invoiced and collected totals per PE rollup unit for the Invoices collection-rate chart.';

GRANT EXECUTE ON FUNCTION public.pe_invoices_collection_totals(JSONB, DATE, DATE) TO service_role;
