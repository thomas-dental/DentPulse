-- Add onboarding_skipped flag to profiles to track users who skip onboarding
ALTER TABLE public.profiles 
ADD COLUMN onboarding_skipped boolean NOT NULL DEFAULT false;