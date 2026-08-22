import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const DEFAULT_ORG_ID = "4d538b46-5443-48e2-ac87-c445e236a26f"; // testiplicit
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

type Integration = {
  id: string;
  platform_name: string;
  is_connected: boolean;
  token_expires_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

type StatusResponse = {
  connected: boolean;
  integration: Integration | null;
};

export default function SageTest() {
  const [orgId, setOrgId] = useState<string>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("org_id");
    return fromUrl || DEFAULT_ORG_ID;
  });
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValidUuid = useMemo(
    () => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId),
    [orgId],
  );

  const fetchStatus = useCallback(async () => {
    if (!isValidUuid) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/sage/status?org_id=${orgId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setStatus(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [orgId, isValidUuid]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleConnect = () => {
    if (!isValidUuid) {
      toast.error("Enter a valid organization UUID first");
      return;
    }
    window.location.href = `${BACKEND_URL}/api/sage/connect?org_id=${orgId}`;
  };

  const handleDisconnect = async () => {
    if (!isValidUuid) return;
    if (!confirm("Disconnect Sage for this organization? Tokens will be cleared.")) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/sage/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success("Sage disconnected");
      await fetchStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Disconnect failed: ${msg}`);
    } finally {
      setActionLoading(false);
    }
  };

  const connected = Boolean(status?.connected);

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sage Integration — Test Console</h1>
          <p className="text-sm text-gray-600 mt-1">
            Phase 1: OAuth connect/disconnect for Sage Business Cloud Accounting (UK).
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Organization</CardTitle>
            <CardDescription>UUID of the organization to test against</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={orgId}
              onChange={(e) => setOrgId(e.target.value.trim())}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="font-mono text-sm"
            />
            {!isValidUuid && (
              <p className="text-xs text-red-600">Not a valid UUID</p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={fetchStatus}
              disabled={!isValidUuid || loading}
            >
              {loading ? "Checking..." : "Refresh status"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Connection Status</CardTitle>
              <CardDescription>From {BACKEND_URL}/api/sage/status</CardDescription>
            </div>
            <Badge variant={connected ? "default" : "secondary"} className={connected ? "bg-green-600" : ""}>
              {connected ? "Connected" : "Not connected"}
            </Badge>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            {!error && status?.integration && (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-gray-500">Integration ID</dt>
                <dd className="font-mono text-xs">{status.integration.id}</dd>

                <dt className="text-gray-500">Platform</dt>
                <dd>{status.integration.platform_name}</dd>

                <dt className="text-gray-500">Token expires</dt>
                <dd>{formatDate(status.integration.token_expires_at)}</dd>

                <dt className="text-gray-500">Last synced</dt>
                <dd>{formatDate(status.integration.last_synced_at)}</dd>

                <dt className="text-gray-500">Created</dt>
                <dd>{formatDate(status.integration.created_at)}</dd>

                <dt className="text-gray-500">Updated</dt>
                <dd>{formatDate(status.integration.updated_at)}</dd>
              </dl>
            )}
            {!error && !status?.integration && (
              <p className="text-sm text-gray-500">No Sage integration row exists yet for this org.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Button
              onClick={handleConnect}
              disabled={!isValidUuid || actionLoading}
              className="bg-green-600 hover:bg-green-700"
            >
              Connect Sage
            </Button>
            <Button
              variant="outline"
              onClick={handleDisconnect}
              disabled={!isValidUuid || !connected || actionLoading}
            >
              {actionLoading ? "Disconnecting..." : "Disconnect"}
            </Button>
          </CardContent>
        </Card>

        <p className="text-xs text-gray-500 text-center">
          Connect button takes you to Sage's authorize page. After authorizing, Sage redirects back
          to <span className="font-mono">/api/sage/callback</span> and tokens are saved.
        </p>
      </div>
    </div>
  );
}

function formatDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}
