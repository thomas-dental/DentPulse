-- Change ID fields in platform_integration_invoice_line_items from BIGINT to VARCHAR
-- These fields can contain UUIDs from the Dentally API

DO $$
BEGIN
    -- Change treatment_id from BIGINT to VARCHAR
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
        AND column_name = 'treatment_id'
        AND data_type = 'bigint'
    ) THEN
        ALTER TABLE public.platform_integration_invoice_line_items
        ALTER COLUMN treatment_id TYPE CHARACTER VARYING(255) USING treatment_id::VARCHAR;
        RAISE NOTICE 'Changed treatment_id to VARCHAR(255)';
    END IF;

    -- Change practitioner_id from BIGINT to VARCHAR
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
        AND column_name = 'practitioner_id'
        AND data_type = 'bigint'
    ) THEN
        ALTER TABLE public.platform_integration_invoice_line_items
        ALTER COLUMN practitioner_id TYPE CHARACTER VARYING(255) USING practitioner_id::VARCHAR;
        RAISE NOTICE 'Changed practitioner_id to VARCHAR(255)';
    END IF;

    -- Change sundry_id from BIGINT to VARCHAR
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
        AND column_name = 'sundry_id'
        AND data_type = 'bigint'
    ) THEN
        ALTER TABLE public.platform_integration_invoice_line_items
        ALTER COLUMN sundry_id TYPE CHARACTER VARYING(255) USING sundry_id::VARCHAR;
        RAISE NOTICE 'Changed sundry_id to VARCHAR(255)';
    END IF;

    -- Change treatment_plan_id from BIGINT to VARCHAR
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
        AND column_name = 'treatment_plan_id'
        AND data_type = 'bigint'
    ) THEN
        ALTER TABLE public.platform_integration_invoice_line_items
        ALTER COLUMN treatment_plan_id TYPE CHARACTER VARYING(255) USING treatment_plan_id::VARCHAR;
        RAISE NOTICE 'Changed treatment_plan_id to VARCHAR(255)';
    END IF;

    -- Change treatment_plan_item_id from BIGINT to VARCHAR
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
        AND column_name = 'treatment_plan_item_id'
        AND data_type = 'bigint'
    ) THEN
        ALTER TABLE public.platform_integration_invoice_line_items
        ALTER COLUMN treatment_plan_item_id TYPE CHARACTER VARYING(255) USING treatment_plan_item_id::VARCHAR;
        RAISE NOTICE 'Changed treatment_plan_item_id to VARCHAR(255)';
    END IF;

    -- Also change patient_id in platform_integration_invoices if needed
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoices'
        AND column_name = 'patient_id'
        AND data_type = 'bigint'
    ) THEN
        ALTER TABLE public.platform_integration_invoices
        ALTER COLUMN patient_id TYPE CHARACTER VARYING(255) USING patient_id::VARCHAR;
        RAISE NOTICE 'Changed patient_id to VARCHAR(255)';
    END IF;

    -- Also change invoice_user_id in platform_integration_invoices if needed
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoices'
        AND column_name = 'invoice_user_id'
        AND data_type = 'bigint'
    ) THEN
        ALTER TABLE public.platform_integration_invoices
        ALTER COLUMN invoice_user_id TYPE CHARACTER VARYING(255) USING invoice_user_id::VARCHAR;
        RAISE NOTICE 'Changed invoice_user_id to VARCHAR(255)';
    END IF;

END $$;
