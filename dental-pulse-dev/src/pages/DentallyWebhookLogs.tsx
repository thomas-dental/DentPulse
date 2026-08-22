import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  RefreshCw, Copy, Eye, EyeOff, Webhook, CheckCircle2, XCircle, Filter,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

// ── Webhook configuration ─────────────────────────────────────────────
// NOTE: the signing secret is used to VERIFY inbound webhook signatures and
// belongs in a backend env var in production — it is shown here only for this
// internal tracking/dev page. Do not expose this page to untrusted users.
const WEBHOOK = {
  url: 'https://p-eu-west-1-region-api.portal.dental/webhooks/dentally/patients?practice_id=e8051ca1-aa26-4647-a08d-da5f56822a85',
  practiceId: 'e8051ca1-aa26-4647-a08d-da5f56822a85',
  resource: 'patients',
  secret: '00860073e12862079eab8c2f23975ae1',
};

// The Supabase table this page reads from when present. If it doesn't exist
// yet, the page falls back to the sample rows below so the layout is visible.
const LOG_TABLE = 'dentally_webhook_logs';

type WebhookLog = {
  id: string;
  received_at: string;
  resource: string;       // patients, appointments, …
  action: string;         // created | updated | destroyed
  object_id: string | null;
  signature_valid: boolean;
  status_code: number;
  payload: unknown;
};

// ── Sample data (used only when the log table is absent/empty) ─────────
const SAMPLE_LOGS: WebhookLog[] = [
  {
    id: 'smpl-1', received_at: '2026-07-14T10:22:41Z', resource: 'patients', action: 'updated',
    object_id: '12854', signature_valid: true, status_code: 200,
    payload: { event: 'patient.updated', patient: { id: 12854, first_name: 'Paul', last_name: 'Bowen', updated_at: '2026-07-14T10:22:40Z' } },
  },
  {
    id: 'smpl-2', received_at: '2026-07-14T10:05:12Z', resource: 'patients', action: 'created',
    object_id: '13246', signature_valid: true, status_code: 200,
    payload: { event: 'patient.created', patient: { id: 13246, first_name: 'Nina', last_name: 'Okafor', created_at: '2026-07-14T10:05:11Z' } },
  },
  {
    id: 'smpl-3', received_at: '2026-07-14T09:48:03Z', resource: 'patients', action: 'destroyed',
    object_id: '11902', signature_valid: false, status_code: 401,
    payload: { event: 'patient.destroyed', patient: { id: 11902 }, note: 'signature mismatch' },
  },
  {
    id: 'smpl-4', received_at: '2026-07-14T09:31:55Z', resource: 'patients', action: 'updated',
    object_id: '9526', signature_valid: true, status_code: 200,
    payload: { event: 'patient.updated', patient: { id: 9526, first_name: 'Corina', last_name: 'Lamb' } },
  },
];

function maskSecret(secret: string): string {
  if (secret.length <= 8) return '•'.repeat(secret.length);
  return `${secret.slice(0, 4)}${'•'.repeat(secret.length - 8)}${secret.slice(-4)}`;
}

function actionVariant(action: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (action === 'created') return 'default';
  if (action === 'destroyed') return 'destructive';
  return 'secondary';
}

export default function DentallyWebhookLogs() {
  const [revealSecret, setRevealSecret] = useState(false);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [selected, setSelected] = useState<WebhookLog | null>(null);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['dentally_webhook_logs', WEBHOOK.practiceId],
    queryFn: async (): Promise<{ rows: WebhookLog[]; isSample: boolean }> => {
      try {
        const { data: rows, error } = await (supabase as any)
          .from(LOG_TABLE)
          .select('id, received_at, resource, action, object_id, signature_valid, status_code, payload')
          .order('received_at', { ascending: false })
          .limit(200);
        if (error || !rows || rows.length === 0) {
          return { rows: SAMPLE_LOGS, isSample: true };
        }
        return { rows: rows as WebhookLog[], isSample: false };
      } catch {
        return { rows: SAMPLE_LOGS, isSample: true };
      }
    },
    staleTime: 30 * 1000,
  });

  const logs = data?.rows ?? [];
  const isSample = data?.isSample ?? true;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (actionFilter !== 'all' && l.action !== actionFilter) return false;
      if (!q) return true;
      return (
        (l.object_id ?? '').toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        l.resource.toLowerCase().includes(q) ||
        JSON.stringify(l.payload).toLowerCase().includes(q)
      );
    });
  }, [logs, search, actionFilter]);

  const copy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error('Copy failed'),
    );
  };

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { hour12: false });
  };

  const validCount = filtered.filter((l) => l.signature_valid).length;
  const invalidCount = filtered.length - validCount;

  return (
    <MainLayout>
      <Helmet><title>Dentally Webhook Logs</title></Helmet>

      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Webhook className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-semibold">Dentally Webhook Logs</h1>
              <p className="text-sm text-muted-foreground">Inbound webhook events for the configured practice</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Configuration card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Webhook Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ConfigRow label="Endpoint URL">
              <code className="break-all rounded bg-muted px-2 py-1 text-xs">{WEBHOOK.url}</code>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy(WEBHOOK.url, 'URL')}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </ConfigRow>
            <ConfigRow label="Practice ID">
              <code className="rounded bg-muted px-2 py-1 text-xs">{WEBHOOK.practiceId}</code>
            </ConfigRow>
            <ConfigRow label="Resource">
              <Badge variant="outline">{WEBHOOK.resource}</Badge>
            </ConfigRow>
            <ConfigRow label="Signing Secret">
              <code className="rounded bg-muted px-2 py-1 text-xs">
                {revealSecret ? WEBHOOK.secret : maskSecret(WEBHOOK.secret)}
              </code>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setRevealSecret((v) => !v)}>
                {revealSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy(WEBHOOK.secret, 'Secret')}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </ConfigRow>
          </CardContent>
        </Card>

        {/* Sample-data banner */}
        {isSample && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Showing <strong>sample data</strong> — no <code>{LOG_TABLE}</code> table found or it is empty. Point a
            receiver at the endpoint above and persist events into that table to see live logs here.
          </div>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Filter className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient id, action, payload…"
              className="w-72 pl-8"
            />
          </div>
          <div className="flex gap-1">
            {['all', 'created', 'updated', 'destroyed'].map((a) => (
              <Button
                key={a}
                variant={actionFilter === a ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActionFilter(a)}
                className="capitalize"
              >
                {a}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" />{validCount} valid</span>
            <span className="flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-red-600" />{invalidCount} invalid</span>
            <span>{filtered.length} events</span>
          </div>
        </div>

        {/* Logs table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[190px]">Received</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Object ID</TableHead>
                  <TableHead>Signature</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Payload</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                      No webhook events match your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{fmt(log.received_at)}</TableCell>
                      <TableCell><Badge variant="outline">{log.resource}</Badge></TableCell>
                      <TableCell><Badge variant={actionVariant(log.action)} className="capitalize">{log.action}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{log.object_id ?? '—'}</TableCell>
                      <TableCell>
                        {log.signature_valid
                          ? <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3.5 w-3.5" />Valid</span>
                          : <span className="flex items-center gap-1 text-xs text-red-600"><XCircle className="h-3.5 w-3.5" />Invalid</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={log.status_code >= 400 ? 'destructive' : 'secondary'}>{log.status_code}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setSelected(log)}>View</Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Payload viewer */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Webhook payload {selected?.object_id ? `· #${selected.object_id}` : ''}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline">{selected.resource}</Badge>
                <Badge variant={actionVariant(selected.action)} className="capitalize">{selected.action}</Badge>
                <span className="text-muted-foreground">{fmt(selected.received_at)}</span>
              </div>
              <pre className="max-h-[50vh] overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(selected.payload, null, 2)}
              </pre>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => copy(JSON.stringify(selected.payload, null, 2), 'Payload')}>
                  <Copy className="h-3.5 w-3.5 mr-2" />Copy JSON
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}

function ConfigRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
}
