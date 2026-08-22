-- Add missing fields for Edit Provider tab
-- provider_code, primary_chair, leaving_date, additional_options

DO $$
BEGIN
    -- Add provider_code column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'providers'
        AND column_name = 'provider_code'
    ) THEN
        ALTER TABLE public.providers
        ADD COLUMN provider_code VARCHAR(100);

        -- Initialize provider_code with name for existing records
        UPDATE public.providers
        SET provider_code = name
        WHERE provider_code IS NULL;

        RAISE NOTICE 'Added provider_code column to providers table';
    END IF;

    -- Add primary_chair column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'providers'
        AND column_name = 'primary_chair'
    ) THEN
        ALTER TABLE public.providers
        ADD COLUMN primary_chair VARCHAR(100);

        RAISE NOTICE 'Added primary_chair column to providers table';
    END IF;

    -- Add leaving_date column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'providers'
        AND column_name = 'leaving_date'
    ) THEN
        ALTER TABLE public.providers
        ADD COLUMN leaving_date TIMESTAMPTZ;

        RAISE NOTICE 'Added leaving_date column to providers table';
    END IF;

    -- Add additional_options column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'providers'
        AND column_name = 'additional_options'
    ) THEN
        ALTER TABLE public.providers
        ADD COLUMN additional_options INTEGER DEFAULT 0;

        RAISE NOTICE 'Added additional_options column to providers table';
    END IF;
END $$;
