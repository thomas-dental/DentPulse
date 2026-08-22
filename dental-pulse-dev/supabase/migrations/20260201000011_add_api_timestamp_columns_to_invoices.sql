-- Add API timestamp columns to platform integration invoice tables
-- These columns store when the invoice/line item was created/updated in Dentally API
-- (different from our database created_at/updated_at which track when the record was synced to our DB)

-- Add columns to platform_integration_invoices table
DO $$
BEGIN
    -- Check if table exists
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoices'
    ) THEN
        -- Add api_record_created_at column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoices'
            AND column_name = 'api_record_created_at'
        ) THEN
            ALTER TABLE public.platform_integration_invoices
            ADD COLUMN api_record_created_at TIMESTAMPTZ NULL;

            RAISE NOTICE 'Added column api_record_created_at to platform_integration_invoices';

            COMMENT ON COLUMN public.platform_integration_invoices.api_record_created_at
            IS 'Timestamp when the invoice was created in Dentally (from API created_at field)';
        END IF;

        -- Add api_record_updated_at column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoices'
            AND column_name = 'api_record_updated_at'
        ) THEN
            ALTER TABLE public.platform_integration_invoices
            ADD COLUMN api_record_updated_at TIMESTAMPTZ NULL;

            RAISE NOTICE 'Added column api_record_updated_at to platform_integration_invoices';

            COMMENT ON COLUMN public.platform_integration_invoices.api_record_updated_at
            IS 'Timestamp when the invoice was last updated in Dentally (from API updated_at field)';
        END IF;

        -- Create index on api_record_created_at for faster queries
        IF NOT EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = 'public'
            AND tablename = 'platform_integration_invoices'
            AND indexname = 'idx_platform_integration_invoices_api_created_at'
        ) THEN
            CREATE INDEX idx_platform_integration_invoices_api_created_at
            ON public.platform_integration_invoices(api_record_created_at);

            RAISE NOTICE 'Created index on api_record_created_at';
        END IF;

        -- Create index on api_record_updated_at for faster queries
        IF NOT EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = 'public'
            AND tablename = 'platform_integration_invoices'
            AND indexname = 'idx_platform_integration_invoices_api_updated_at'
        ) THEN
            CREATE INDEX idx_platform_integration_invoices_api_updated_at
            ON public.platform_integration_invoices(api_record_updated_at);

            RAISE NOTICE 'Created index on api_record_updated_at';
        END IF;
    ELSE
        RAISE NOTICE 'Table platform_integration_invoices does not exist';
    END IF;
END $$;

-- Add columns to platform_integration_invoice_line_items table
DO $$
BEGIN
    -- Check if table exists
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
    ) THEN
        -- Add api_record_created_at column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoice_line_items'
            AND column_name = 'api_record_created_at'
        ) THEN
            ALTER TABLE public.platform_integration_invoice_line_items
            ADD COLUMN api_record_created_at TIMESTAMPTZ NULL;

            RAISE NOTICE 'Added column api_record_created_at to platform_integration_invoice_line_items';

            COMMENT ON COLUMN public.platform_integration_invoice_line_items.api_record_created_at
            IS 'Timestamp when the invoice item was created in Dentally (from API created_at field)';
        END IF;

        -- Add api_record_updated_at column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'platform_integration_invoice_line_items'
            AND column_name = 'api_record_updated_at'
        ) THEN
            ALTER TABLE public.platform_integration_invoice_line_items
            ADD COLUMN api_record_updated_at TIMESTAMPTZ NULL;

            RAISE NOTICE 'Added column api_record_updated_at to platform_integration_invoice_line_items';

            COMMENT ON COLUMN public.platform_integration_invoice_line_items.api_record_updated_at
            IS 'Timestamp when the invoice item was last updated in Dentally (from API updated_at field)';
        END IF;

        -- Create index on api_record_created_at for faster queries
        IF NOT EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = 'public'
            AND tablename = 'platform_integration_invoice_line_items'
            AND indexname = 'idx_platform_integration_invoice_items_api_created_at'
        ) THEN
            CREATE INDEX idx_platform_integration_invoice_items_api_created_at
            ON public.platform_integration_invoice_line_items(api_record_created_at);

            RAISE NOTICE 'Created index on api_record_created_at';
        END IF;

        -- Create index on api_record_updated_at for faster queries
        IF NOT EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = 'public'
            AND tablename = 'platform_integration_invoice_line_items'
            AND indexname = 'idx_platform_integration_invoice_items_api_updated_at'
        ) THEN
            CREATE INDEX idx_platform_integration_invoice_items_api_updated_at
            ON public.platform_integration_invoice_line_items(api_record_updated_at);

            RAISE NOTICE 'Created index on api_record_updated_at';
        END IF;
    ELSE
        RAISE NOTICE 'Table platform_integration_invoice_line_items does not exist';
    END IF;
END $$;
