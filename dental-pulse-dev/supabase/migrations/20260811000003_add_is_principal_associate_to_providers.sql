-- Adds the "Principal Associate" flag, settable from a provider's Edit Provider
-- screen -> Additional Options (Associate/Dentist providers only).

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS is_principal_associate boolean NOT NULL DEFAULT false;
