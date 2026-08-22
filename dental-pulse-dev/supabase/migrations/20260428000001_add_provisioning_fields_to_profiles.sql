-- Add provisioning fields to profiles table
-- password_set: false for provisioned users (password not yet set in Supabase), true for self-signup users
-- source_platform: null for self-signup, 'dentledger'/'skmarketing' for provisioned users

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_set BOOLEAN DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS source_platform TEXT DEFAULT NULL;
