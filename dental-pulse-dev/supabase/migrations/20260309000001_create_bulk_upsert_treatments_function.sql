-- Add unique constraint on (organization_id, treatment_code) for upsert matching
-- Only applies to non-null, non-empty treatment codes
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'treatments_org_treatment_code_unique'
        AND conrelid = 'public.treatments'::regclass
    ) THEN
        -- First, remove duplicates if any exist (keep the most recently updated one)
        DELETE FROM public.treatments a
        USING public.treatments b
        WHERE a.organization_id = b.organization_id
          AND a.treatment_code = b.treatment_code
          AND a.treatment_code IS NOT NULL
          AND a.treatment_code != ''
          AND a.deleted_at IS NULL
          AND b.deleted_at IS NULL
          AND a.updated_at < b.updated_at;

        ALTER TABLE public.treatments
        ADD CONSTRAINT treatments_org_treatment_code_unique
        UNIQUE (organization_id, treatment_code);
    END IF;
END $$;

-- Create bulk_upsert_treatments function
CREATE OR REPLACE FUNCTION public.bulk_upsert_treatments(
  p_organization_id uuid,
  p_user_id uuid,
  p_treatments jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_treatment jsonb;
  v_inserted int := 0;
  v_updated int := 0;
  v_errors int := 0;
  v_treatment_code text;
  v_existing_id uuid;
BEGIN
  FOR v_treatment IN SELECT * FROM jsonb_array_elements(p_treatments)
  LOOP
    BEGIN
      v_treatment_code := v_treatment->>'treatment_code';

      -- Skip if no treatment_name
      IF COALESCE(v_treatment->>'treatment_name', '') = '' THEN
        v_errors := v_errors + 1;
        CONTINUE;
      END IF;

      -- Check if treatment exists by treatment_code + organization_id
      IF v_treatment_code IS NOT NULL AND v_treatment_code != '' THEN
        SELECT id INTO v_existing_id
        FROM public.treatments
        WHERE organization_id = p_organization_id
          AND treatment_code = v_treatment_code
          AND deleted_at IS NULL
        LIMIT 1;
      ELSE
        v_existing_id := NULL;
      END IF;

      IF v_existing_id IS NOT NULL THEN
        -- UPDATE existing treatment
        UPDATE public.treatments SET
          treatment_name = COALESCE(v_treatment->>'treatment_name', treatment_name),
          treatment_type = COALESCE(v_treatment->>'treatment_type', treatment_type),
          price = COALESCE((v_treatment->>'price')::numeric, price),
          category_id = COALESCE((v_treatment->>'category_id')::uuid, category_id),
          duration_minutes = COALESCE((v_treatment->>'duration_minutes')::integer, duration_minutes),
          therapist_time_mins = COALESCE((v_treatment->>'therapist_time_mins')::integer, therapist_time_mins),
          lab_bill = COALESCE((v_treatment->>'lab_bill')::numeric, lab_bill),
          lab_bill_discount = COALESCE((v_treatment->>'lab_bill_discount')::numeric, lab_bill_discount),
          material_cost = COALESCE((v_treatment->>'material_cost')::numeric, material_cost),
          percent_fees = COALESCE((v_treatment->>'percent_fees')::numeric, percent_fees),
          therapist_pay_rate = COALESCE((v_treatment->>'therapist_pay_rate')::numeric, therapist_pay_rate),
          finance_fee = COALESCE((v_treatment->>'finance_fee')::numeric, finance_fee),
          hourly_rate = COALESCE((v_treatment->>'hourly_rate')::numeric, hourly_rate),
          average_time_minutes = COALESCE((v_treatment->>'average_time_minutes')::numeric, average_time_minutes),
          updated_by = p_user_id,
          updated_at = now()
        WHERE id = v_existing_id;
        v_updated := v_updated + 1;
      ELSE
        -- INSERT new treatment
        INSERT INTO public.treatments (
          organization_id, treatment_code, treatment_name, treatment_type,
          price, category_id,
          duration_minutes, therapist_time_mins, lab_bill, lab_bill_discount,
          material_cost, percent_fees, therapist_pay_rate, finance_fee,
          hourly_rate, average_time_minutes,
          created_by, updated_by
        ) VALUES (
          p_organization_id,
          NULLIF(v_treatment->>'treatment_code', ''),
          v_treatment->>'treatment_name',
          COALESCE(v_treatment->>'treatment_type', 'private'),
          COALESCE((v_treatment->>'price')::numeric, 0),
          (v_treatment->>'category_id')::uuid,
          (v_treatment->>'duration_minutes')::integer,
          (v_treatment->>'therapist_time_mins')::integer,
          (v_treatment->>'lab_bill')::numeric,
          (v_treatment->>'lab_bill_discount')::numeric,
          (v_treatment->>'material_cost')::numeric,
          (v_treatment->>'percent_fees')::numeric,
          (v_treatment->>'therapist_pay_rate')::numeric,
          (v_treatment->>'finance_fee')::numeric,
          (v_treatment->>'hourly_rate')::numeric,
          (v_treatment->>'average_time_minutes')::numeric,
          p_user_id,
          p_user_id
        );
        v_inserted := v_inserted + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'inserted', v_inserted,
    'updated', v_updated,
    'errors', v_errors
  );
END;
$$;

-- Create remove_duplicate_treatments function
CREATE OR REPLACE FUNCTION public.remove_duplicate_treatments(
  p_organization_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_removed int := 0;
BEGIN
  -- Remove duplicates based on treatment_code, keeping the most recently updated
  WITH duplicates AS (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY organization_id, treatment_code
        ORDER BY updated_at DESC, created_at DESC
      ) as rn
    FROM public.treatments
    WHERE organization_id = p_organization_id
      AND treatment_code IS NOT NULL
      AND treatment_code != ''
      AND deleted_at IS NULL
  )
  DELETE FROM public.treatments
  WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Also remove duplicates by treatment_name (for treatments without codes)
  WITH name_duplicates AS (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY organization_id, treatment_name, treatment_type
        ORDER BY updated_at DESC, created_at DESC
      ) as rn
    FROM public.treatments
    WHERE organization_id = p_organization_id
      AND (treatment_code IS NULL OR treatment_code = '')
      AND deleted_at IS NULL
  )
  DELETE FROM public.treatments
  WHERE id IN (SELECT id FROM name_duplicates WHERE rn > 1);

  GET DIAGNOSTICS v_removed = v_removed + ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'removed', v_removed
  );
END;
$$;
