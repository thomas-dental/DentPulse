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
  RefreshCw, Copy, Webhook, CheckCircle2, XCircle, Filter,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

const LOG_TABLE = 'dentally_webhook_logs';

/** Dev page — set VITE_DENTALLY_WEBHOOK_PRACTICE_ID to filter logs for one org. */
const PRACTICE_ID =
  import.meta.env.VITE_DENTALLY_WEBHOOK_PRACTICE_ID?.trim() || '';

const API_BASE =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ||
  (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:5000` : '');

const WEBHOOK_PAYMENTS_URL = PRACTICE_ID
  ? `${API_BASE}/api/dentally-webhook/payments?practice_id=${PRACTICE_ID}`
  : `${API_BASE}/api/dentally-webhook/payments?practice_id={organization_uuid}`;

const WEBHOOK_APPOINTMENTS_URL = PRACTICE_ID
  ? `${API_BASE}/api/dentally-webhook/appointments?practice_id=${PRACTICE_ID}`
  : `${API_BASE}/api/dentally-webhook/appointments?practice_id={organization_uuid}`;

type WebhookLog = {
  id: string;
  received_at: string;
  resource: string;
  action: string;
  object_id: string | null;
  event_name?: string | null;
  signature_valid: boolean;
  status_code: number | null;
  processing_status?: string | null;
  payload: unknown;
};

const SAMPLE_LOGS: WebhookLog[] = [
  {
    id: 'smpl-1',
    received_at: '2026-07-14T10:22:41Z',
    resource: 'payment',
    action: 'updated',
    object_id: '12854',
    event_name: 'payment.updated',
    signature_valid: true,
    status_code: 200,
    processing_status: 'processed',
    payload: {
      event: 'payment.updated',
      object: 'payment',
      data: { id: 12854, amount: '250.00', explanations: [{ invoice_id: 62988296, amount: '250.00' }] },
    },
  },
  {
    id: 'smpl-2',
    received_at: '2026-07-14T10:05:12Z',
    resource: 'payment',
    action: 'created',
    object_id: '13246',
    event_name: 'payment.created',
    signature_valid: true,
    status_code: 200,
    processing_status: 'processed',
    payload: {
      event: 'payment.created',
      object: 'payment',
      data: { id: 13246, amount: '18.5', patient_id: 5106 },
    },
  },
  {
    id: 'smpl-3',
    received_at: '2026-07-14T09:48:03Z',
    resource: 'payment',
    action: 'deleted',
    object_id: '11902',
    event_name: 'payment.deleted',
    signature_valid: false,
    status_code: 401,
    processing_status: 'failed',
    payload: { event: 'payment.deleted', object: 'payment', data: { id: 11902 } },
  },
  {
    id: 'smpl-4',
    received_at: '2026-07-14T11:10:22Z',
    resource: 'appointment',
    action: 'updated',
    object_id: '88421',
    event_name: 'appointment.updated',
    signature_valid: true,
    status_code: 200,
    processing_status: 'processed',
    payload: {
      event: 'appointment.updated',
      object: 'appointment',
      data: { id: 88421, patient_id: 5106, state: 'Completed' },
    },
  },
];

function actionVariant(action: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (action === 'created') return 'default';
  if (action === 'deleted') return 'destructive';
  return 'secondary';
}

export default function DentallyWebhookLogs() {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [resourceFilter, setResourceFilter] = useState<string>('all');
  const [selected, setSelected] = useState<WebhookLog | null>(null);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['dentally_webhook_logs', PRACTICE_ID],
    queryFn: async (): Promise<{ rows: WebhookLog[]; isSample: boolean }> => {
      try {
        let query = (supabase as any)
          .from(LOG_TABLE)
          .select(
            'id, received_at, resource, action, object_id, event_name, signature_valid, status_code, processing_status, payload',
          )
          .order('received_at', { ascending: false })
          .limit(200);

        if (PRACTICE_ID) {
          query = query.eq('practice_id', PRACTICE_ID);
        }

        const { data: rows, error } = await query;
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
      if (resourceFilter !== 'all' && l.resource !== resourceFilter) return false;
      if (!q) return true;
      return (
        (l.object_id ?? '').toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        l.resource.toLowerCase().includes(q) ||
        (l.event_name ?? '').toLowerCase().includes(q) ||
        JSON.stringify(l.payload).toLowerCase().includes(q)
      );
    });
  }, [logs, search, actionFilter, resourceFilter]);

  const resources = useMemo(
    () => [...new Set(logs.map((l) => l.resource).filter(Boolean))],
    [logs],
  );

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
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Webhook className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-semibold">Dentally Webhook Logs</h1>
              <p className="text-sm text-muted-foreground">
                Inbound Dentally webhook events {PRACTICE_ID ? `· practice ${PRACTICE_ID.slice(0, 8)}…` : '· all practices'}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Payment webhook endpoint</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ConfigRow label="URL">
                <code className="break-all rounded bg-muted px-2 py-1 text-xs">{WEBHOOK_PAYMENTS_URL}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy(WEBHOOK_PAYMENTS_URL, 'URL')}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </ConfigRow>
              <ConfigRow label="Events">
                <div className="flex flex-wrap gap-1">
                  {['payment.created', 'payment.updated', 'payment.deleted'].map((e) => (
                    <Badge key={e} variant="outline" className="font-mono text-[10px]">{e}</Badge>
                  ))}
                </div>
              </ConfigRow>
              <ConfigRow label="Secret">
                <span className="text-xs text-muted-foreground">
                  Store in <code className="rounded bg-muted px-1">integrations.webhook_secret</code> (backend only — not shown here).
                </span>
              </ConfigRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Appointment webhook endpoint</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ConfigRow label="URL">
                <code className="break-all rounded bg-muted px-2 py-1 text-xs">{WEBHOOK_APPOINTMENTS_URL}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy(WEBHOOK_APPOINTMENTS_URL, 'URL')}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </ConfigRow>
              <ConfigRow label="Events">
                <div className="flex flex-wrap gap-1">
                  {['appointment.created', 'appointment.updated', 'appointment.deleted'].map((e) => (
                    <Badge key={e} variant="outline" className="font-mono text-[10px]">{e}</Badge>
                  ))}
                </div>
              </ConfigRow>
              <ConfigRow label="Downstream">
                <span className="text-xs text-muted-foreground">
                  Refreshes linked <code className="rounded bg-muted px-1">treatment_appointments</code> and writes{' '}
                  <code className="rounded bg-muted px-1">event_ledger</code> link/unlink events.
                </span>
              </ConfigRow>
            </CardContent>
          </Card>
        </div>

        {isSample && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Showing <strong>sample data</strong> — no live rows in <code>{LOG_TABLE}</code> yet. Configure the endpoints in
            Dentally Developer Settings and trigger a payment or appointment event to see live logs.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Filter className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search object id, event, payload…"
              className="w-72 pl-8"
            />
          </div>
          <div className="flex gap-1">
            {['all', 'created', 'updated', 'deleted'].map((a) => (
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
          {resources.length > 1 && (
            <div className="flex gap-1">
              <Button
                variant={resourceFilter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setResourceFilter('all')}
              >
                All resources
              </Button>
              {resources.map((r) => (
                <Button
                  key={r}
                  variant={resourceFilter === r ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setResourceFilter(r)}
                >
                  {r}
                </Button>
              ))}
            </div>
          )}
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" />{validCount} valid</span>
            <span className="flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-red-600" />{invalidCount} invalid</span>
            <span>{filtered.length} events</span>
          </div>
        </div>

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
                  <TableHead>Processing</TableHead>
                  <TableHead className="text-right">Payload</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-sm text-muted-foreground">
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
                        <Badge variant={(log.status_code ?? 0) >= 400 ? 'destructive' : 'secondary'}>
                          {log.status_code ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs capitalize text-muted-foreground">
                        {log.processing_status ?? '—'}
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

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Webhook payload {selected?.object_id ? `· payment #${selected.object_id}` : ''}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline">{selected.resource}</Badge>
                <Badge variant={actionVariant(selected.action)} className="capitalize">{selected.action}</Badge>
                {selected.event_name && (
                  <Badge variant="secondary" className="font-mono">{selected.event_name}</Badge>
                )}
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
