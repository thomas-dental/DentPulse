-- Drop the existing constraint
ALTER TABLE public.provider_sliding_scales
DROP CONSTRAINT IF EXISTS provider_sliding_scales_scale_type_check;

-- Add new constraint with updated values
ALTER TABLE public.provider_sliding_scales
ADD CONSTRAINT provider_sliding_scales_scale_type_check
CHECK (scale_type IN ('sliding_scale', 'lab_sliding_scale'));

-- Update existing records to use new scale_type values
UPDATE public.provider_sliding_scales
SET scale_type = 'sliding_scale'
WHERE scale_type = 'associate';

UPDATE public.provider_sliding_scales
SET scale_type = 'lab_sliding_scale'
WHERE scale_type = 'lab';
