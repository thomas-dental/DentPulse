/**
 * RBAC sync — fires after every Supabase RBAC mutation to broadcast the
 * change to Central Auth via the DentPulse backend proxy.
 *
 * Fire-and-forget. Sync failures only log; never block the user's action.
 */
import { supabase } from '@/integrations/supabase/client';

const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || (isLocal
  ? 'http://localhost:4000'
  : 'https://dent-enterprise-api.dentpulse.com');

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No active session');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

function fireAndForget(promise: Promise<unknown>, tag: string): void {
  promise.catch((err) => {
    console.warn(`[role-sync:${tag}] failed (non-blocking):`, err);
  });
}

interface RolePayload {
  tenant_platform_id: string;
  source_role_id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  is_system?: boolean;
}

export const roleSyncService = {
  upsertRole(payload: RolePayload): void {
    fireAndForget(
      authHeaders().then((headers) =>
        fetch(`${BACKEND_URL}/api/role-sync/role`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        }),
      ),
      'upsert-role',
    );
  },

  deleteRole(source_role_id: string): void {
    fireAndForget(
      authHeaders().then((headers) =>
        fetch(`${BACKEND_URL}/api/role-sync/role`, {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ source_role_id }),
        }),
      ),
      'delete-role',
    );
  },

  syncPermissions(
    source_role_id: string,
    items: Array<{ permission_name: string; granted: boolean }>,
  ): void {
    if (!items.length) return;
    fireAndForget(
      authHeaders().then((headers) =>
        fetch(`${BACKEND_URL}/api/role-sync/permissions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ source_role_id, items }),
        }),
      ),
      'sync-permissions',
    );
  },

  assignRole(payload: {
    tenant_platform_id: string;
    user_email: string;
    source_role_id: string;
  }): void {
    fireAndForget(
      authHeaders().then((headers) =>
        fetch(`${BACKEND_URL}/api/role-sync/assign`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        }),
      ),
      'assign-role',
    );
  },

  unassignRole(payload: {
    tenant_platform_id: string;
    user_email: string;
    source_role_id: string;
  }): void {
    fireAndForget(
      authHeaders().then((headers) =>
        fetch(`${BACKEND_URL}/api/role-sync/assign`, {
          method: 'DELETE',
          headers,
          body: JSON.stringify(payload),
        }),
      ),
      'unassign-role',
    );
  },
};

/**
 * Build a "module:card:action" permission key from individual fields.
 * Mirrors permissionRegistry.permissionKey() for use in sync calls.
 */
export function buildPermissionName(module: string, card: string | null, action: string): string {
  if (!card) return `${module}:page_access:${action}`;
  return `${module}:${card}:${action}`;
}
