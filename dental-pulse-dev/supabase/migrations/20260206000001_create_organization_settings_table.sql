-- Add missing columns if table already exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'organization_settings'
        AND column_name = 'fiscal_year_start'
    ) THEN
        ALTER TABLE public.organization_settings
        ADD COLUMN fiscal_year_start varchar(20) DEFAULT 'january';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'organization_settings'
        AND column_name = 'currency'
    ) THEN
        ALTER TABLE public.organization_settings
        ADD COLUMN currency varchar(10) DEFAULT 'USD';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'organization_settings'
        AND column_name = 'date_format'
    ) THEN
        ALTER TABLE public.organization_settings
        ADD COLUMN date_format varchar(20) DEFAULT 'MM/DD/YYYY';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'organization_settings'
        AND column_name = 'notifications_enabled'
    ) THEN
        ALTER TABLE public.organization_settings
        ADD COLUMN notifications_enabled boolean DEFAULT true;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'organization_settings'
        AND column_name = 'onboarding_completed'
    ) THEN
        ALTER TABLE public.organization_settings
        ADD COLUMN onboarding_completed boolean DEFAULT false;
    END IF;
END $$;

-- Create index on organization_id
CREATE INDEX IF NOT EXISTS idx_organization_settings_org_id
    ON public.organization_settings(organization_id);

-- Enable RLS
ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DO $$
BEGIN
    -- Drop existing policies if they exist
    DROP POLICY IF EXISTS "Users can view their organization settings" ON public.organization_settings;
    DROP POLICY IF EXISTS "Users can insert their organization settings" ON public.organization_settings;
    DROP POLICY IF EXISTS "Users can update their organization settings" ON public.organization_settings;

    -- Create policies
    CREATE POLICY "Users can view their organization settings"
        ON public.organization_settings FOR SELECT
        USING (
            organization_id IN (
                SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
            )
        );

    CREATE POLICY "Users can insert their organization settings"
        ON public.organization_settings FOR INSERT
        WITH CHECK (
            organization_id IN (
                SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
            )
        );

    CREATE POLICY "Users can update their organization settings"
        ON public.organization_settings FOR UPDATE
        USING (
            organization_id IN (
                SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
            )
        );
END $$;
