-- Update platform_integration_invoices and platform_integration_invoice_line_items tables for Dentally sync
-- Remove and add fields as specified for proper Dentally invoice integration

-- ============================================================
-- Update platform_integration_invoices table
-- ============================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoices'
    ) THEN
        -- Remove practitioner_id if it exists (this field belongs in line items, not invoice)
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoices'
            AND column_name = 'practitioner_id'
        ) THEN
            ALTER TABLE public.platform_integration_invoices DROP COLUMN practitioner_id;
            RAISE NOTICE 'Dropped column practitioner_id from platform_integration_invoices';
        END IF;

        -- Remove practitioner_name if it exists
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoices'
            AND column_name = 'practitioner_name'
        ) THEN
            ALTER TABLE public.platform_integration_invoices DROP COLUMN practitioner_name;
            RAISE NOTICE 'Dropped column practitioner_name from platform_integration_invoices';
        END IF;

        -- Add invoice_user_id if it doesn't exist (from Dentally API user_id field)
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoices'
            AND column_name = 'invoice_user_id'
        ) THEN
            ALTER TABLE public.platform_integration_invoices
            ADD COLUMN invoice_user_id BIGINT NULL;

            RAISE NOTICE 'Added column invoice_user_id to platform_integration_invoices';

            COMMENT ON COLUMN public.platform_integration_invoices.invoice_user_id
            IS 'User ID from Dentally API who created/manages the invoice';

            -- Create index for faster queries
            CREATE INDEX IF NOT EXISTS idx_platform_integration_invoices_user_id
            ON public.platform_integration_invoices(invoice_user_id);
        END IF;

        RAISE NOTICE 'Successfully updated platform_integration_invoices table';
    ELSE
        RAISE NOTICE 'Table platform_integration_invoices does not exist';
    END IF;
END $$;

-- ============================================================
-- Update platform_integration_invoice_line_items table
-- ============================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
    ) THEN
        -- Remove practitioner_name if it exists (not provided in Dentally line items API)
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoice_line_items'
            AND column_name = 'practitioner_name'
        ) THEN
            ALTER TABLE public.platform_integration_invoice_line_items DROP COLUMN practitioner_name;
            RAISE NOTICE 'Dropped column practitioner_name from platform_integration_invoice_line_items';
        END IF;

        -- Add practitioner_id if it doesn't exist (from Dentally API)
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoice_line_items'
            AND column_name = 'practitioner_id'
        ) THEN
            ALTER TABLE public.platform_integration_invoice_line_items
            ADD COLUMN practitioner_id BIGINT NULL;

            RAISE NOTICE 'Added column practitioner_id to platform_integration_invoice_line_items';

            COMMENT ON COLUMN public.platform_integration_invoice_line_items.practitioner_id
            IS 'Practitioner ID from Dentally API who performed the treatment';

            -- Create index for faster queries
            CREATE INDEX IF NOT EXISTS idx_platform_integration_invoice_items_practitioner
            ON public.platform_integration_invoice_line_items(practitioner_id);
        END IF;

        -- Add sundry_id if it doesn't exist
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoice_line_items'
            AND column_name = 'sundry_id'
        ) THEN
            ALTER TABLE public.platform_integration_invoice_line_items
            ADD COLUMN sundry_id BIGINT NULL;

            RAISE NOTICE 'Added column sundry_id to platform_integration_invoice_line_items';

            COMMENT ON COLUMN public.platform_integration_invoice_line_items.sundry_id
            IS 'Sundry item ID from Dentally API if line item is a sundry';
        END IF;

        -- Add treatment_plan_id if it doesn't exist
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoice_line_items'
            AND column_name = 'treatment_plan_id'
        ) THEN
            ALTER TABLE public.platform_integration_invoice_line_items
            ADD COLUMN treatment_plan_id BIGINT NULL;

            RAISE NOTICE 'Added column treatment_plan_id to platform_integration_invoice_line_items';

            COMMENT ON COLUMN public.platform_integration_invoice_line_items.treatment_plan_id
            IS 'Treatment plan ID from Dentally API';

            -- Create index for faster queries
            CREATE INDEX IF NOT EXISTS idx_platform_integration_invoice_items_treatment_plan
            ON public.platform_integration_invoice_line_items(treatment_plan_id);
        END IF;

        -- Add treatment_plan_item_id if it doesn't exist
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoice_line_items'
            AND column_name = 'treatment_plan_item_id'
        ) THEN
            ALTER TABLE public.platform_integration_invoice_line_items
            ADD COLUMN treatment_plan_item_id BIGINT NULL;

            RAISE NOTICE 'Added column treatment_plan_item_id to platform_integration_invoice_line_items';

            COMMENT ON COLUMN public.platform_integration_invoice_line_items.treatment_plan_item_id
            IS 'Treatment plan item ID from Dentally API';

            -- Create index for faster queries
            CREATE INDEX IF NOT EXISTS idx_platform_integration_invoice_items_treatment_plan_item
            ON public.platform_integration_invoice_line_items(treatment_plan_item_id);
        END IF;

        RAISE NOTICE 'Successfully updated platform_integration_invoice_line_items table';
    ELSE
        RAISE NOTICE 'Table platform_integration_invoice_line_items does not exist';
    END IF;
END $$;
