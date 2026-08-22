-- Create new function that matches .NET procedure using treatment_plan_items AND invoice_line_items
-- Uses actual field names from existing database schema
-- UPDATED: Added treatment name and treatment category name

-- Drop existing function first if it exists (required when changing return type)
DROP FUNCTION IF EXISTS get_practitioner_activity_report_v2(UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_practitioner_activity_report_v2(
  p_organization_id UUID,
  p_from_date DATE,
  p_to_date DATE,
  p_treatment_ids TEXT DEFAULT NULL,
  p_practitioner_ids TEXT DEFAULT NULL,
  p_treatment_category_ids TEXT DEFAULT NULL,
  p_payment_plan_ids TEXT DEFAULT NULL
)
RETURNS TABLE (
  invoice_date DATE,
  patient_name TEXT,
  treatment TEXT,
  treatment_category TEXT,
  practitioner TEXT,
  referrer TEXT,
  payment_plan TEXT,
  duration INTEGER,
  price NUMERIC,
  invoiced_on DATE,
  paid_on DATE,
  invoice_status TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    tpi.tpi_completed_at::DATE AS invoice_date,

    -- Patient Name: Join with patients
    CASE
      WHEN pt.pt_first_name IS NOT NULL AND pt.pt_last_name IS NOT NULL
      THEN LTRIM(RTRIM(pt.pt_first_name || ' ' || pt.pt_last_name))
      WHEN pt.pt_first_name IS NOT NULL
      THEN LTRIM(RTRIM(pt.pt_first_name))
      WHEN pt.pt_last_name IS NOT NULL
      THEN LTRIM(RTRIM(pt.pt_last_name))
      ELSE 'Unknown Patient'
    END::TEXT AS patient_name,

    -- Treatment name from treatments table
    COALESCE(t.treatment_name, 'Unknown Treatment')::TEXT AS treatment,

    -- Treatment Category name from treatment_categories table
    COALESCE(tc.name, 'Uncategorized')::TEXT AS treatment_category,

    -- Practitioner name from providers
    COALESCE(prac.name, 'Unknown Provider')::TEXT AS practitioner,

    -- Referrer (not available in current schema)
    'Unknown Provider'::TEXT AS referrer,

    -- Payment Plan
    COALESCE(pp.pp_name::TEXT, 'Unknown Plan') AS payment_plan,

    -- Duration from treatment_plan_items or treatments table
    COALESCE(tpi.duration, t.duration_minutes, 0)::INTEGER AS duration,

    -- Price from treatment_plan_items (no SUM needed since grouping by tpi.id)
    COALESCE(tpi.tpi_price, 0) AS price,

    -- Invoice dates from platform_integration_invoices
    inv.invoice_date AS invoiced_on,
    inv.paid_date AS paid_on,
    COALESCE(inv.status::TEXT, 'unknown') AS invoice_status

  FROM treatment_plan_items tpi

  -- Join with practitioners (matches .NET: dtpi.PractitionerId = dprac.DentallyId)
  INNER JOIN providers prac
    ON tpi.organization_id = prac.organization_id
    AND tpi.tpi_practitioner_id::INTEGER = prac.external_id
    AND prac.deleted_at IS NULL
    AND prac.is_active = true

  -- Join with patients (matches .NET: dtpi.PatientId = dp.DentallyId)
  INNER JOIN patients pt
    ON tpi.organization_id = pt.organization_id
    AND tpi.tpi_patient_id = pt.pt_id
    AND pt.deleted_at IS NULL

  -- Join with treatments (tpi.tpi_treatment_id → treatments.external_id)
  LEFT JOIN treatments t
    ON (
      (t.external_id IS NOT NULL AND t.external_id::bigint = tpi.tpi_treatment_id::bigint)
      OR
      (CAST(t.external_id AS text) = CAST(tpi.tpi_treatment_id AS text))
    )
    AND t.organization_id = tpi.organization_id
    AND t.deleted_at IS NULL
    AND t.is_active = true

  -- Join with treatment categories (treatments.category_id UUID → treatment_categories.id UUID)
  LEFT JOIN treatment_categories tc
    ON tc.id = t.category_id
    AND tc.organization_id = t.organization_id
    AND tc.deleted_at IS NULL

  -- Join with invoices (OPTIONAL - many treatment_plan_items have NULL invoice_id)
  LEFT JOIN platform_integration_invoices inv
    ON tpi.organization_id = inv.organization_id
    AND tpi.tpi_invoice_id::TEXT = inv.platform_invoice_id
    AND inv.deleted_at IS NULL
    AND inv.platform_type = 'Dentally'

  -- Join with payment plans (OPTIONAL)
  LEFT JOIN payment_plans pp
    ON tpi.organization_id = pp.organization_id
    AND tpi.tpi_payment_plan_id = pp.pp_id
    AND pp.deleted_at IS NULL

  WHERE tpi.organization_id = p_organization_id
    AND tpi.tpi_completed_at IS NOT NULL  -- Must have completion date (matches .NET)
    AND tpi.tpi_completed = true          -- Must be marked as completed (matches .NET: Completed = 1)
    AND tpi.tpi_completed_at::DATE BETWEEN p_from_date AND p_to_date
    AND COALESCE(tpi.tpi_price, 0) <> 0   -- Must have non-zero price (matches .NET)
    AND tpi.deleted_at IS NULL

    -- Filter by TreatmentIds (filter on tpi.tpi_treatment_id)
    AND (p_treatment_ids IS NULL OR p_treatment_ids = ''
         OR tpi.tpi_treatment_id::TEXT = ANY(string_to_array(p_treatment_ids, ',')))

    -- Filter by PractitionerIds (filter on tpi.tpi_practitioner_id)
    AND (p_practitioner_ids IS NULL OR p_practitioner_ids = ''
         OR tpi.tpi_practitioner_id::TEXT = ANY(string_to_array(p_practitioner_ids, ',')))

    -- Filter by TreatmentCategoryIds (filter on treatment_categories.id)
    AND (p_treatment_category_ids IS NULL OR p_treatment_category_ids = ''
         OR tc.id::TEXT = ANY(string_to_array(p_treatment_category_ids, ',')))

    -- Filter by PaymentPlanIds (filter on tpi.tpi_payment_plan_id, allow NULL for records without payment plans)
    AND (p_payment_plan_ids IS NULL OR p_payment_plan_ids = ''
         OR tpi.tpi_payment_plan_id IS NULL
         OR tpi.tpi_payment_plan_id::TEXT = ANY(string_to_array(p_payment_plan_ids, ',')))

  GROUP BY
    tpi.id,  -- Add unique ID to prevent over-aggregation
    tpi.tpi_completed_at::DATE,
    pt.pt_first_name,
    pt.pt_last_name,
    t.treatment_name,
    tc.name,
    prac.name,
    pp.pp_name,
    tpi.duration,
    t.duration_minutes,
    inv.invoice_date,
    inv.paid_date,
    inv.status

  ORDER BY
    tpi.tpi_completed_at::DATE DESC,
    prac.name,
    pt.pt_last_name;
END;
$$;

COMMENT ON FUNCTION get_practitioner_activity_report_v2 IS
'Get practitioner activity report from treatment_plan_items AND invoice_line_items (matches .NET procedure logic).
Use this for periods after treatment_plan_items sync started.
Filters: completed treatments only (tpi_completed = true AND tpi_completed_at IS NOT NULL).
Includes treatment name and treatment category name from treatments and treatment_categories tables.';



-- Standalone query with variable declarations for testing
 -- Modify the parameter values in the WITH clause as needed

 WITH params AS (
   SELECT
     'a67dff02-c04e-421c-9d03-d3fac8e6464d'::UUID AS p_organization_id,
     '2025-01-01'::DATE AS p_from_date,
     '2025-01-31'::DATE AS p_to_date,
     NULL::TEXT AS p_treatment_ids,
     NULL::TEXT AS p_practitioner_ids,
     NULL::TEXT AS p_treatment_category_ids,
     NULL::TEXT AS p_payment_plan_ids
 )
 SELECT
   tpi.tpi_completed_at::DATE AS invoice_date,

   -- Patient Name: Join with patients
   CASE
     WHEN pt.pt_first_name IS NOT NULL AND pt.pt_last_name IS NOT NULL
     THEN LTRIM(RTRIM(pt.pt_first_name || ' ' || pt.pt_last_name))
     WHEN pt.pt_first_name IS NOT NULL
     THEN LTRIM(RTRIM(pt.pt_first_name))
     WHEN pt.pt_last_name IS NOT NULL
     THEN LTRIM(RTRIM(pt.pt_last_name))
     ELSE 'Unknown Patient'
   END::TEXT AS patient_name,

  -- Treatment name from treatments table
  COALESCE(t.treatment_name, 'Unknown Treatment')::TEXT AS treatment,

  -- Treatment Category name from treatment_categories table
  COALESCE(tc.name, 'Uncategorized')::TEXT AS treatment_category,

  -- Practitioner name from providers
  COALESCE(prac.name, 'Unknown Provider')::TEXT AS practitioner,

  -- Referrer (not available in current schema)
  'Unknown Provider'::TEXT AS referrer,

  -- Payment Plan
  COALESCE(pp.pp_name::TEXT, 'Unknown Plan') AS payment_plan,

  -- Duration from treatment_plan_items or treatments table
  COALESCE(tpi.duration, t.duration_minutes, 0)::INTEGER AS duration,

   -- Price from treatment_plan_items (no SUM needed since grouping by tpi.id)
   COALESCE(tpi.tpi_price, 0) AS price,

   -- Invoice dates from platform_integration_invoices
   inv.invoice_date AS invoiced_on,
   inv.paid_date AS paid_on,
   COALESCE(inv.status::TEXT, 'unknown') AS invoice_status

 FROM treatment_plan_items tpi
 CROSS JOIN params

 -- Join with practitioners (matches .NET: dtpi.PractitionerId = dprac.DentallyId)
 INNER JOIN providers prac
   ON tpi.organization_id = prac.organization_id
   AND tpi.tpi_practitioner_id::INTEGER = prac.external_id
   AND prac.deleted_at IS NULL
   AND prac.is_active = true

 -- Join with patients (matches .NET: dtpi.PatientId = dp.DentallyId)
 INNER JOIN patients pt
   ON tpi.organization_id = pt.organization_id
   AND tpi.tpi_patient_id = pt.pt_id
   AND pt.deleted_at IS NULL

 -- Join with treatments (tpi.tpi_treatment_id → treatments.external_id)
 LEFT JOIN treatments t
   ON (
     (t.external_id IS NOT NULL AND t.external_id::bigint = tpi.tpi_treatment_id::bigint)
     OR
     (CAST(t.external_id AS text) = CAST(tpi.tpi_treatment_id AS text))
   )
   AND t.organization_id = tpi.organization_id
   AND t.deleted_at IS NULL
   AND t.is_active = true

 -- Join with treatment categories (treatments.category_id UUID → treatment_categories.id UUID)
 LEFT JOIN treatment_categories tc
   ON tc.id = t.category_id
   AND tc.organization_id = t.organization_id
   AND tc.deleted_at IS NULL

 -- Join with invoices (OPTIONAL - many treatment_plan_items have NULL invoice_id)
 LEFT JOIN platform_integration_invoices inv
   ON tpi.organization_id = inv.organization_id
   AND tpi.tpi_invoice_id::TEXT = inv.platform_invoice_id
   AND inv.deleted_at IS NULL
   AND inv.platform_type = 'Dentally'

 -- Join with payment plans (OPTIONAL)
 LEFT JOIN payment_plans pp
   ON tpi.organization_id = pp.organization_id
   AND tpi.tpi_payment_plan_id = pp.pp_id
   AND pp.deleted_at IS NULL

 WHERE tpi.organization_id = params.p_organization_id
   AND tpi.tpi_completed_at IS NOT NULL  -- Must have completion date (matches .NET)
   AND tpi.tpi_completed = true          -- Must be marked as completed (matches .NET: Completed = 1)
   AND tpi.tpi_completed_at::DATE BETWEEN params.p_from_date AND params.p_to_date
   AND COALESCE(tpi.tpi_price, 0) <> 0   -- Must have non-zero price (matches .NET)
   AND tpi.deleted_at IS NULL

   -- Filter by TreatmentIds (filter on tpi.tpi_treatment_id)
   AND (params.p_treatment_ids IS NULL OR params.p_treatment_ids = ''
        OR tpi.tpi_treatment_id::TEXT = ANY(string_to_array(params.p_treatment_ids, ',')))

   -- Filter by PractitionerIds (filter on tpi.tpi_practitioner_id)
   AND (params.p_practitioner_ids IS NULL OR params.p_practitioner_ids = ''
        OR tpi.tpi_practitioner_id::TEXT = ANY(string_to_array(params.p_practitioner_ids, ',')))

   -- Filter by TreatmentCategoryIds (filter on treatment_categories.id)
   AND (params.p_treatment_category_ids IS NULL OR params.p_treatment_category_ids = ''
        OR tc.id::TEXT = ANY(string_to_array(params.p_treatment_category_ids, ',')))

   -- Filter by PaymentPlanIds (filter on tpi.tpi_payment_plan_id, allow NULL for records without payment plans)
   AND (params.p_payment_plan_ids IS NULL OR params.p_payment_plan_ids = ''
        OR tpi.tpi_payment_plan_id IS NULL
        OR tpi.tpi_payment_plan_id::TEXT = ANY(string_to_array(params.p_payment_plan_ids, ',')))

 GROUP BY
   tpi.id,  -- Add unique ID to prevent over-aggregation
   tpi.tpi_completed_at::DATE,
   pt.pt_first_name,
   pt.pt_last_name,
   t.treatment_name,
   tc.name,
   prac.name,
   pp.pp_name,
   tpi.duration,
   t.duration_minutes,
   inv.invoice_date,
   inv.paid_date,
   inv.status

 ORDER BY
   tpi.tpi_completed_at::DATE DESC,
   prac.name,
   pt.pt_last_name;