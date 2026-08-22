-- Add specialty and provider_type columns to providers table
-- These columns store the actual values as VARCHAR

-- Add specialty column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'specialty'
    ) THEN
        ALTER TABLE public.providers 
        ADD COLUMN specialty VARCHAR(255); -- e.g., General Dentistry, Orthodontics, Endodontics, Periodontics, Oral Surgery, Pediatric Dentistry, Prosthodontics
    END IF;
END $$;

-- Add provider_type column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'provider_type'
    ) THEN
        ALTER TABLE public.providers 
        ADD COLUMN provider_type VARCHAR(100); -- e.g., dentist, hygienist, assistant, specialist
    END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_providers_specialty ON public.providers(specialty);
CREATE INDEX IF NOT EXISTS idx_providers_provider_type ON public.providers(provider_type);
