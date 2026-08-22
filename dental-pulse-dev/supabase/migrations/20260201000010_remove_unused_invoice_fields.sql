-- Remove unused fields from platform_integration_invoices table
-- This migration removes fields that are not needed for Dentally invoice integration

-- Drop columns from platform_integration_invoices if table exists
DO $$
BEGIN
    -- Check if table exists
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoices'
    ) THEN
        -- Drop dentally_id column if it exists
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoices'
            AND column_name = 'dentally_id'
        ) THEN
            ALTER TABLE public.platform_integration_invoices DROP COLUMN dentally_id;
            RAISE NOTICE 'Dropped column dentally_id from platform_integration_invoices';
        END IF;

        -- Drop raw_data column if it exists
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoices'
            AND column_name = 'raw_data'
        ) THEN
            ALTER TABLE public.platform_integration_invoices DROP COLUMN raw_data;
            RAISE NOTICE 'Dropped column raw_data from platform_integration_invoices';
        END IF;

        -- Drop meta_data column if it exists
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoices'
            AND column_name = 'meta_data'
        ) THEN
            ALTER TABLE public.platform_integration_invoices DROP COLUMN meta_data;
            RAISE NOTICE 'Dropped column meta_data from platform_integration_invoices';
        END IF;

        -- Drop custom_fields column if it exists
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoices'
            AND column_name = 'custom_fields'
        ) THEN
            ALTER TABLE public.platform_integration_invoices DROP COLUMN custom_fields;
            RAISE NOTICE 'Dropped column custom_fields from platform_integration_invoices';
        END IF;
    ELSE
        RAISE NOTICE 'Table platform_integration_invoices does not exist';
    END IF;
END $$;

-- Drop columns from platform_integration_invoice_line_items if table exists
DO $$
BEGIN
    -- Check if table exists
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
    ) THEN
        -- Drop tracking column if it exists
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoice_line_items'
            AND column_name = 'tracking'
        ) THEN
            ALTER TABLE public.platform_integration_invoice_line_items DROP COLUMN tracking;
            RAISE NOTICE 'Dropped column tracking from platform_integration_invoice_line_items';
        END IF;

        -- Drop raw_data column if it exists
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoice_line_items'
            AND column_name = 'raw_data'
        ) THEN
            ALTER TABLE public.platform_integration_invoice_line_items DROP COLUMN raw_data;
            RAISE NOTICE 'Dropped column raw_data from platform_integration_invoice_line_items';
        END IF;
    ELSE
        RAISE NOTICE 'Table platform_integration_invoice_line_items does not exist';
    END IF;
END $$;
