import { supabase } from '@/integrations/supabase/client';

/**
 * Resolve the Anthropic API key from the backend.
 *
 * Replaces the old `import.meta.env.VITE_ANTHROPIC_API_KEY`: the key is no longer
 * baked into the client bundle. Instead the backend returns the caller's resolved
 * per-user / tenant-owner key (from `user_ai_keys`, gated by requireUserAiKey), so
 * key management stays entirely in the backend and follows the same per-tenant
 * rules as the chatbot and forecast.
 *
 * Throws if the user has no AI access (no personal key and no enabled tenant key).
 */
let cached: { key: string; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function getAnthropicKey(): Promise<string> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.key;

  const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${backendUrl}/api/ai-key`, {
    headers: { Authorization: `Bearer ${session?.access_token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'AI is not enabled for your account. Ask your administrator to enable it.');
  }

  const { apiKey } = await res.json();
  if (!apiKey) throw new Error('No AI key available for your account.');

  cached = { key: apiKey, at: Date.now() };
  return apiKey;
}

/** Clear the cached key (e.g. after sign-out or an auth error). */
export function clearAnthropicKeyCache(): void {
  cached = null;
}
