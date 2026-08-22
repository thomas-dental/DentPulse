-- Add central_auth_id to profiles table
-- Universal ID from Central Auth (DP_Users.id UUID) used for all cross-platform sync operations

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS central_auth_id TEXT DEFAULT NULL;

-- Create unique index (allows nulls)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_central_auth_id_unique ON profiles (central_auth_id) WHERE central_auth_id IS NOT NULL;
