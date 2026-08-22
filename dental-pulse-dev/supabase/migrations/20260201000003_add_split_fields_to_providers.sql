-- Add split configuration fields to providers table

DO $$
BEGIN
    -- Add split_source_method column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'providers'
        AND column_name = 'split_source_method'
    ) THEN
        ALTER TABLE public.providers
        ADD COLUMN split_source_method VARCHAR(20) DEFAULT 'flat-percentage' CHECK (split_source_method IN ('flat-percentage', 'sliding-scale'));

        RAISE NOTICE 'Added split_source_method column to providers table';
    END IF;

    -- Add associate_split_percentage column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'providers'
        AND column_name = 'associate_split_percentage'
    ) THEN
        ALTER TABLE public.providers
        ADD COLUMN associate_split_percentage DECIMAL(5, 2) DEFAULT 50.00;

        RAISE NOTICE 'Added associate_split_percentage column to providers table';
    END IF;

    -- Add lab_split_percentage column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'providers'
        AND column_name = 'lab_split_percentage'
    ) THEN
        ALTER TABLE public.providers
        ADD COLUMN lab_split_percentage DECIMAL(5, 2) DEFAULT 50.00;

        RAISE NOTICE 'Added lab_split_percentage column to providers table';
    END IF;
END $$;
