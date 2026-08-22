/**
 * Sage Data Viewer — temp/debug page to inspect synced Sage data.
 *
 * Route: /sage-data?org_id=<uuid>
 * NOT added to sidebar. Direct URL access only.
 *
 * Displays all Sage entities synced into Supabase (dedicated tables):
 *   Master:       sage_suppliers, sage_chart_of_accounts
 *   Lookups:      sage_tax_rates, sage_payment_methods
 *   Catalog:      sage_products
 *   Transactions: sage_invoices + lines, sage_credit_notes + lines, sage_journals + lines
 *   Bank:         sage_bank_accounts, sage_bank_transactions,
 *                 sage_other_payments, sage_other_receipts, sage_bank_transfers
 *   Files:        sage_attachments
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const DEFAULT_ORG_ID = "137f09b4-7ea1-4d61-8816-e827c64729c4";

type Supplier = { id: string; sage_contact_id: string; displayed_as: string; email: string | null; telephone: string | null; address_line_1: string | null; city: string | null; postal_code: string | null; country_id: string | null; default_purchase_ledger_account_id: string | null; is_active: boolean; last_synced_at: string };
type CoaAccount = { id: string; account_code: string | null; account_name: string; account_type: string; classification: string | null; tax_type: string | null; is_active: boolean };
type TaxRate = { id: string; sage_tax_rate_id: string; displayed_as: string | null; name: string | null; percentage: number | null; tax_code: string | null; is_visible: boolean; is_default: boolean };
type PaymentMethod = { id: string; sage_payment_method_id: string; displayed_as: string | null; name: string | null; payment_method_type: string | null; is_visible: boolean };
type Product = { id: string; sage_product_id: string; displayed_as: string | null; item_code: string | null; product_type: string; sales_price: number | null; purchase_price: number | null; is_sold: boolean; is_purchased: boolean };
type Invoice = { id: string; sage_invoice_id: string; invoice_number: string | null; invoice_date: string | null; due_date: string | null; contact_id: string | null; contact_name: string | null; status: string | null; total_amount: number | null; amount_due: number | null; currency: string | null; last_synced_at: string };
type LineItem = { id: string; invoice_id: string; description: string | null; quantity: number | null; unit_amount: number | null; line_amount: number | null; account_code: string | null; account_name: string | null };
type CreditNote = { id: string; sage_credit_note_id: string; credit_note_number: string | null; credit_note_date: string | null; contact_name: string | null; status: string | null; total_amount: number | null; outstanding_amount: number | null; currency: string | null };
type CreditNoteLine = { id: string; credit_note_id: string; description: string | null; quantity: number | null; unit_amount: number | null; line_amount: number | null; account_code: string | null; account_name: string | null };
type Journal = { id: string; sage_journal_id: string; reference: string | null; narrative: string | null; journal_date: string | null; status: string | null; total_debits: number | null; total_credits: number | null };
type JournalLine = { id: string; journal_id: string; ledger_account_name: string | null; account_code: string | null; debit: number | null; credit: number | null; description: string | null };
type BankAccount = { id: string; sage_bank_account_id: string; displayed_as: string; account_name: string | null; account_number: string | null; sort_code: string | null; current_balance: number | null; is_default: boolean; is_active: boolean };
type BankTransaction = { id: string; sage_bank_transaction_id: string; bank_account_name: string | null; transaction_type_label: string | null; transaction_date: string | null; reference: string | null; total_amount: number | null; contact_name: string | null };
type OtherPayment = { id: string; sage_other_payment_id: string; bank_account_name: string | null; transaction_date: string | null; reference: string | null; description: string | null; total_amount: number | null };
type OtherReceipt = { id: string; sage_other_receipt_id: string; bank_account_name: string | null; transaction_date: string | null; reference: string | null; description: string | null; total_amount: number | null };
type BankTransfer = { id: string; sage_bank_transfer_id: string; from_bank_account_name: string | null; to_bank_account_name: string | null; transfer_date: string | null; reference: string | null; amount: number | null };
type Attachment = { id: string; sage_attachment_id: string; file_name: string | null; content_type: string | null; file_size: number | null; attached_to_entity: string | null; attached_to_id: string | null };

export default function SageDataViewer() {
  const [orgId, setOrgId] = useState<string>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("org_id");
    return fromUrl || DEFAULT_ORG_ID;
  });

  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [coa, setCoa]             = useState<CoaAccount[]>([]);
  const [taxRates, setTaxRates]   = useState<TaxRate[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [products, setProducts]   = useState<Product[]>([]);
  const [invoices, setInvoices]   = useState<Invoice[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [creditNotes, setCreditNotes]       = useState<CreditNote[]>([]);
  const [creditNoteLines, setCreditNoteLines] = useState<CreditNoteLine[]>([]);
  const [journals, setJournals]   = useState<Journal[]>([]);
  const [journalLines, setJournalLines] = useState<JournalLine[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>([]);
  const [otherPayments, setOtherPayments] = useState<OtherPayment[]>([]);
  const [otherReceipts, setOtherReceipts] = useState<OtherReceipt[]>([]);
  const [bankTransfers, setBankTransfers] = useState<BankTransfer[]>([]);
  const [attachments, setAttachments]   = useState<Attachment[]>([]);

  const isValidUuid = useMemo(
    () => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId),
    [orgId],
  );

  const loadData = useCallback(async () => {
    if (!isValidUuid) {
      setError("Invalid organization UUID");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [
        supRes, coaRes, taxRes, pmRes, prodRes,
        invRes, cnRes, jnlRes,
        baRes, btxnRes, opRes, orRes, btRes, attRes,
      ] = await Promise.all([
        supabase.from('sage_suppliers' as any)
          .select('id, sage_contact_id, displayed_as, email, telephone, address_line_1, city, postal_code, country_id, default_purchase_ledger_account_id, is_active, last_synced_at')
          .eq('organization_id', orgId).order('displayed_as'),
        supabase.from('sage_chart_of_accounts' as any)
          .select('id, account_code, account_name, account_type, classification, tax_type, is_active')
          .eq('organization_id', orgId).order('account_code'),
        supabase.from('sage_tax_rates' as any)
          .select('id, sage_tax_rate_id, displayed_as, name, percentage, tax_code, is_visible, is_default')
          .eq('organization_id', orgId).order('percentage', { ascending: false }),
        supabase.from('sage_payment_methods' as any)
          .select('id, sage_payment_method_id, displayed_as, name, payment_method_type, is_visible')
          .eq('organization_id', orgId).order('name'),
        supabase.from('sage_products' as any)
          .select('id, sage_product_id, displayed_as, item_code, product_type, sales_price, purchase_price, is_sold, is_purchased')
          .eq('organization_id', orgId).order('displayed_as'),
        supabase.from('sage_invoices' as any)
          .select('id, sage_invoice_id, invoice_number, invoice_date, due_date, contact_id, contact_name, status, total_amount, amount_due, currency, last_synced_at')
          .eq('organization_id', orgId).order('invoice_date', { ascending: false }),
        supabase.from('sage_credit_notes' as any)
          .select('id, sage_credit_note_id, credit_note_number, credit_note_date, contact_name, status, total_amount, outstanding_amount, currency')
          .eq('organization_id', orgId).order('credit_note_date', { ascending: false }),
        supabase.from('sage_journals' as any)
          .select('id, sage_journal_id, reference, narrative, journal_date, status, total_debits, total_credits')
          .eq('organization_id', orgId).order('journal_date', { ascending: false }),
        supabase.from('sage_bank_accounts' as any)
          .select('id, sage_bank_account_id, displayed_as, account_name, account_number, sort_code, current_balance, is_default, is_active')
          .eq('organization_id', orgId).order('displayed_as'),
        supabase.from('sage_bank_transactions' as any)
          .select('id, sage_bank_transaction_id, bank_account_name, transaction_type_label, transaction_date, reference, total_amount, contact_name')
          .eq('organization_id', orgId).order('transaction_date', { ascending: false }),
        supabase.from('sage_other_payments' as any)
          .select('id, sage_other_payment_id, bank_account_name, transaction_date, reference, description, total_amount')
          .eq('organization_id', orgId).order('transaction_date', { ascending: false }),
        supabase.from('sage_other_receipts' as any)
          .select('id, sage_other_receipt_id, bank_account_name, transaction_date, reference, description, total_amount')
          .eq('organization_id', orgId).order('transaction_date', { ascending: false }),
        supabase.from('sage_bank_transfers' as any)
          .select('id, sage_bank_transfer_id, from_bank_account_name, to_bank_account_name, transfer_date, reference, amount')
          .eq('organization_id', orgId).order('transfer_date', { ascending: false }),
        supabase.from('sage_attachments' as any)
          .select('id, sage_attachment_id, file_name, content_type, file_size, attached_to_entity, attached_to_id')
          .eq('organization_id', orgId).order('file_name'),
      ]);

      const checks = [
        ['suppliers', supRes], ['COA', coaRes], ['tax rates', taxRes], ['payment methods', pmRes],
        ['products', prodRes], ['invoices', invRes], ['credit notes', cnRes], ['journals', jnlRes],
        ['bank accounts', baRes], ['bank transactions', btxnRes], ['other payments', opRes],
        ['other receipts', orRes], ['bank transfers', btRes], ['attachments', attRes],
      ] as const;
      for (const [label, res] of checks) {
        if ((res as any).error) throw new Error(`${label}: ${(res as any).error.message}`);
      }

      const invoiceList = (invRes.data || []) as Invoice[];
      const creditNoteList = (cnRes.data || []) as CreditNote[];
      const journalList = (jnlRes.data || []) as Journal[];

      setSuppliers((supRes.data || []) as Supplier[]);
      setCoa((coaRes.data || []) as CoaAccount[]);
      setTaxRates((taxRes.data || []) as TaxRate[]);
      setPaymentMethods((pmRes.data || []) as PaymentMethod[]);
      setProducts((prodRes.data || []) as Product[]);
      setInvoices(invoiceList);
      setCreditNotes(creditNoteList);
      setJournals(journalList);
      setBankAccounts((baRes.data || []) as BankAccount[]);
      setBankTransactions((btxnRes.data || []) as BankTransaction[]);
      setOtherPayments((opRes.data || []) as OtherPayment[]);
      setOtherReceipts((orRes.data || []) as OtherReceipt[]);
      setBankTransfers((btRes.data || []) as BankTransfer[]);
      setAttachments((attRes.data || []) as Attachment[]);

      // Fetch line items / sub-records in parallel
      const [liRes, cnliRes, jliRes] = await Promise.all([
        invoiceList.length > 0
          ? supabase.from('sage_invoice_line_items' as any)
              .select('id, invoice_id, description, quantity, unit_amount, line_amount, account_code, account_name')
              .in('invoice_id', invoiceList.map(i => i.id)).order('line_number')
          : Promise.resolve({ data: [], error: null }),
        creditNoteList.length > 0
          ? supabase.from('sage_credit_note_line_items' as any)
              .select('id, credit_note_id, description, quantity, unit_amount, line_amount, account_code, account_name')
              .in('credit_note_id', creditNoteList.map(c => c.id)).order('line_number')
          : Promise.resolve({ data: [], error: null }),
        journalList.length > 0
          ? supabase.from('sage_journal_lines' as any)
              .select('id, journal_id, ledger_account_name, account_code, debit, credit, description')
              .in('journal_id', journalList.map(j => j.id)).order('line_number')
          : Promise.resolve({ data: [], error: null }),
      ]);

      if ((liRes as any).error)   throw new Error(`invoice lines: ${(liRes as any).error.message}`);
      if ((cnliRes as any).error) throw new Error(`credit note lines: ${(cnliRes as any).error.message}`);
      if ((jliRes as any).error)  throw new Error(`journal lines: ${(jliRes as any).error.message}`);

      setLineItems(((liRes.data) || []) as LineItem[]);
      setCreditNoteLines(((cnliRes.data) || []) as CreditNoteLine[]);
      setJournalLines(((jliRes.data) || []) as JournalLine[]);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setError(msg);
      toast.error("Failed to load Sage data", { description: msg });
    } finally {
      setLoading(false);
    }
  }, [orgId, isValidUuid]);

  useEffect(() => { loadData(); }, [loadData]);

  const formatGBP = (n: number | null) =>
    n === null || n === undefined ? '—' : `£${Number(n).toFixed(2)}`;
  const formatPct = (n: number | null) =>
    n === null || n === undefined ? '—' : `${Number(n).toFixed(2)}%`;
  const formatDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB') : '—';
  const formatBytes = (b: number | null) => {
    if (b === null || b === undefined) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(2)} MB`;
  };

  const totals = useMemo(() => ({
    invoiceTotal: invoices.reduce((s, i) => s + (i.total_amount || 0), 0),
    creditNoteTotal: creditNotes.reduce((s, c) => s + (c.total_amount || 0), 0),
    bankBalance: bankAccounts.reduce((s, b) => s + (b.current_balance || 0), 0),
  }), [invoices, creditNotes, bankAccounts]);

  const EmptyState = ({ label }: { label: string }) => (
    <p className="text-muted-foreground text-sm italic">No {label} synced yet.</p>
  );

  const ActiveBadge = ({ active }: { active: boolean }) => active
    ? <Badge variant="default" className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20">Active</Badge>
    : <Badge variant="secondary">Inactive</Badge>;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sage Synced Data</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Inspect all 15 entities synced from Sage Business Cloud Accounting.
            </p>
          </div>
          <Button onClick={loadData} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </Button>
        </div>

        {/* Org selector */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">Organization:</span>
          <Input
            value={orgId}
            onChange={e => setOrgId(e.target.value.trim())}
            placeholder="organization UUID"
            className="font-mono text-[11px] h-7 max-w-md bg-muted/40 border-muted-foreground/20"
          />
          {!isValidUuid && <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" />Invalid</Badge>}
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Suppliers</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{suppliers.length}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">COA</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{coa.length}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Tax Rates</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{taxRates.length}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Payment Methods</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{paymentMethods.length}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Products/Svc</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{products.length}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Bank Accounts</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{bankAccounts.length}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Purchase Invoices</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{invoices.length}</div><div className="text-[10px] text-emerald-600 font-medium">{formatGBP(totals.invoiceTotal)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Credit Notes</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{creditNotes.length}</div><div className="text-[10px] text-emerald-600 font-medium">{formatGBP(totals.creditNoteTotal)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Journals</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{journals.length}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Bank Txns</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{bankTransactions.length}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Other Pay/Rec</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{otherPayments.length + otherReceipts.length}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Transfers/Files</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{bankTransfers.length + attachments.length}</div></CardContent></Card>
        </div>

        {error && (
          <Card className="border-destructive bg-destructive/5">
            <CardContent className="pt-4 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-destructive mt-0.5" />
              <div>
                <p className="font-medium text-destructive">Error loading data</p>
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs defaultValue="suppliers" className="space-y-4">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="suppliers">Suppliers <Badge variant="secondary" className="ml-2">{suppliers.length}</Badge></TabsTrigger>
            <TabsTrigger value="coa">COA <Badge variant="secondary" className="ml-2">{coa.length}</Badge></TabsTrigger>
            <TabsTrigger value="tax">Tax Rates <Badge variant="secondary" className="ml-2">{taxRates.length}</Badge></TabsTrigger>
            <TabsTrigger value="pm">Payment Methods <Badge variant="secondary" className="ml-2">{paymentMethods.length}</Badge></TabsTrigger>
            <TabsTrigger value="prod">Products/Services <Badge variant="secondary" className="ml-2">{products.length}</Badge></TabsTrigger>
            <TabsTrigger value="invoices">Invoices <Badge variant="secondary" className="ml-2">{invoices.length}</Badge></TabsTrigger>
            <TabsTrigger value="cn">Credit Notes <Badge variant="secondary" className="ml-2">{creditNotes.length}</Badge></TabsTrigger>
            <TabsTrigger value="jnl">Journals <Badge variant="secondary" className="ml-2">{journals.length}</Badge></TabsTrigger>
            <TabsTrigger value="ba">Bank Accounts <Badge variant="secondary" className="ml-2">{bankAccounts.length}</Badge></TabsTrigger>
            <TabsTrigger value="btxn">Bank Txns <Badge variant="secondary" className="ml-2">{bankTransactions.length}</Badge></TabsTrigger>
            <TabsTrigger value="op">Other Payments <Badge variant="secondary" className="ml-2">{otherPayments.length}</Badge></TabsTrigger>
            <TabsTrigger value="or">Other Receipts <Badge variant="secondary" className="ml-2">{otherReceipts.length}</Badge></TabsTrigger>
            <TabsTrigger value="bt">Bank Transfers <Badge variant="secondary" className="ml-2">{bankTransfers.length}</Badge></TabsTrigger>
            <TabsTrigger value="att">Attachments <Badge variant="secondary" className="ml-2">{attachments.length}</Badge></TabsTrigger>
          </TabsList>

          {/* Suppliers */}
          <TabsContent value="suppliers">
            <Card>
              <CardHeader><CardTitle>Suppliers</CardTitle><CardDescription>Vendor contacts synced from Sage Accounting</CardDescription></CardHeader>
              <CardContent>
                {suppliers.length === 0 ? <EmptyState label="suppliers" /> : (
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Address</TableHead>
                      <TableHead>City</TableHead><TableHead>Postcode</TableHead><TableHead>Country</TableHead>
                      <TableHead>Active</TableHead><TableHead className="font-mono text-xs">Sage ID</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{suppliers.map(s => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.displayed_as}</TableCell>
                        <TableCell>{s.email || '—'}</TableCell>
                        <TableCell>{s.address_line_1 || '—'}</TableCell>
                        <TableCell>{s.city || '—'}</TableCell>
                        <TableCell>{s.postal_code || '—'}</TableCell>
                        <TableCell>{s.country_id || '—'}</TableCell>
                        <TableCell><ActiveBadge active={s.is_active} /></TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">{s.sage_contact_id.substring(0, 12)}…</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* COA */}
          <TabsContent value="coa">
            <Card>
              <CardHeader><CardTitle>Chart of Accounts</CardTitle><CardDescription>Ledger accounts auto-created by Sage</CardDescription></CardHeader>
              <CardContent>
                {coa.length === 0 ? <EmptyState label="accounts" /> : (
                  <div className="overflow-x-auto max-h-[60vh] overflow-y-auto"><Table>
                    <TableHeader className="sticky top-0 bg-background z-10"><TableRow>
                      <TableHead className="w-[80px]">Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead>
                      <TableHead>Classification</TableHead><TableHead>Tax Rate</TableHead><TableHead>Active</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{coa.map(a => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-xs">{a.account_code || '—'}</TableCell>
                        <TableCell className="font-medium">{a.account_name}</TableCell>
                        <TableCell className="text-xs">{a.account_type}</TableCell>
                        <TableCell>{a.classification && <Badge variant="outline" className="text-[10px]">{a.classification}</Badge>}</TableCell>
                        <TableCell className="text-xs">{a.tax_type || '—'}</TableCell>
                        <TableCell><ActiveBadge active={a.is_active} /></TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tax Rates */}
          <TabsContent value="tax">
            <Card>
              <CardHeader><CardTitle>Tax Rates</CardTitle><CardDescription>UK VAT lookup (Standard, Reduced, Zero, Exempt, No VAT)</CardDescription></CardHeader>
              <CardContent>
                {taxRates.length === 0 ? <EmptyState label="tax rates" /> : (
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Display</TableHead><TableHead>Name</TableHead><TableHead className="text-right">Percentage</TableHead>
                      <TableHead>Tax Code</TableHead><TableHead>Visible</TableHead><TableHead>Default</TableHead>
                      <TableHead className="font-mono text-xs">Sage ID</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{taxRates.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.displayed_as || '—'}</TableCell>
                        <TableCell>{t.name || '—'}</TableCell>
                        <TableCell className="text-right font-mono">{formatPct(t.percentage)}</TableCell>
                        <TableCell className="font-mono text-xs">{t.tax_code || '—'}</TableCell>
                        <TableCell><ActiveBadge active={t.is_visible} /></TableCell>
                        <TableCell>{t.is_default ? <Badge variant="default" className="bg-blue-500/15 text-blue-700">Default</Badge> : '—'}</TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">{t.sage_tax_rate_id}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Payment Methods */}
          <TabsContent value="pm">
            <Card>
              <CardHeader><CardTitle>Payment Methods</CardTitle><CardDescription>BACS / cheque / card / direct debit lookup</CardDescription></CardHeader>
              <CardContent>
                {paymentMethods.length === 0 ? <EmptyState label="payment methods" /> : (
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Display</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead>
                      <TableHead>Visible</TableHead><TableHead className="font-mono text-xs">Sage ID</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{paymentMethods.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.displayed_as || '—'}</TableCell>
                        <TableCell>{p.name || '—'}</TableCell>
                        <TableCell className="text-xs">{p.payment_method_type || '—'}</TableCell>
                        <TableCell><ActiveBadge active={p.is_visible} /></TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">{p.sage_payment_method_id}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Products / Services */}
          <TabsContent value="prod">
            <Card>
              <CardHeader><CardTitle>Products &amp; Services</CardTitle><CardDescription>Product/service catalog (sales + purchase prices)</CardDescription></CardHeader>
              <CardContent>
                {products.length === 0 ? <EmptyState label="products or services" /> : (
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Display</TableHead><TableHead>Code</TableHead><TableHead>Type</TableHead>
                      <TableHead className="text-right">Sales £</TableHead><TableHead className="text-right">Purchase £</TableHead>
                      <TableHead>Sold</TableHead><TableHead>Purchased</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{products.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.displayed_as || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{p.item_code || '—'}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px] capitalize">{p.product_type}</Badge></TableCell>
                        <TableCell className="text-right">{formatGBP(p.sales_price)}</TableCell>
                        <TableCell className="text-right">{formatGBP(p.purchase_price)}</TableCell>
                        <TableCell>{p.is_sold ? '✓' : '—'}</TableCell>
                        <TableCell>{p.is_purchased ? '✓' : '—'}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Invoices + line items */}
          <TabsContent value="invoices">
            <Card>
              <CardHeader><CardTitle>Purchase Invoices</CardTitle><CardDescription>Bills synced from Sage Accounting</CardDescription></CardHeader>
              <CardContent>
                {invoices.length === 0 ? <EmptyState label="invoices" /> : (
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Invoice #</TableHead><TableHead>Date</TableHead><TableHead>Due</TableHead>
                      <TableHead>Supplier</TableHead><TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Outstanding</TableHead>
                      <TableHead>Currency</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{invoices.map(inv => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-xs font-medium">{inv.invoice_number || '—'}</TableCell>
                        <TableCell>{formatDate(inv.invoice_date)}</TableCell>
                        <TableCell>{formatDate(inv.due_date)}</TableCell>
                        <TableCell>{inv.contact_name || '—'}</TableCell>
                        <TableCell><Badge variant={inv.status === 'paid' ? 'default' : 'secondary'} className={inv.status === 'paid' ? 'bg-emerald-500/15 text-emerald-700' : ''}>{inv.status || '—'}</Badge></TableCell>
                        <TableCell className="text-right font-medium">{formatGBP(inv.total_amount)}</TableCell>
                        <TableCell className="text-right">{formatGBP(inv.amount_due)}</TableCell>
                        <TableCell className="text-xs">{inv.currency || '—'}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
            {lineItems.length > 0 && (
              <Card className="mt-4">
                <CardHeader><CardTitle>Invoice Line Items</CardTitle><CardDescription>{lineItems.length} line items across all invoices above</CardDescription></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Invoice</TableHead><TableHead>Description</TableHead>
                      <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit £</TableHead>
                      <TableHead className="text-right">Line £</TableHead>
                      <TableHead>Ledger Code</TableHead><TableHead>Ledger Name</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{lineItems.map(li => {
                      const parent = invoices.find(i => i.id === li.invoice_id);
                      return (
                        <TableRow key={li.id}>
                          <TableCell className="font-mono text-xs">{parent?.invoice_number || '—'}</TableCell>
                          <TableCell>{li.description || '—'}</TableCell>
                          <TableCell className="text-right">{li.quantity ?? '—'}</TableCell>
                          <TableCell className="text-right">{formatGBP(li.unit_amount)}</TableCell>
                          <TableCell className="text-right font-medium">{formatGBP(li.line_amount)}</TableCell>
                          <TableCell className="font-mono text-xs">{li.account_code || '—'}</TableCell>
                          <TableCell className="text-xs">{li.account_name || '—'}</TableCell>
                        </TableRow>
                      );
                    })}</TableBody>
                  </Table></div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Credit Notes + lines */}
          <TabsContent value="cn">
            <Card>
              <CardHeader><CardTitle>Purchase Credit Notes</CardTitle><CardDescription>Supplier refunds / returns</CardDescription></CardHeader>
              <CardContent>
                {creditNotes.length === 0 ? <EmptyState label="credit notes" /> : (
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Credit Note #</TableHead><TableHead>Date</TableHead>
                      <TableHead>Supplier</TableHead><TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Outstanding</TableHead>
                      <TableHead>Currency</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{creditNotes.map(cn => (
                      <TableRow key={cn.id}>
                        <TableCell className="font-mono text-xs font-medium">{cn.credit_note_number || '—'}</TableCell>
                        <TableCell>{formatDate(cn.credit_note_date)}</TableCell>
                        <TableCell>{cn.contact_name || '—'}</TableCell>
                        <TableCell><Badge variant="secondary">{cn.status || '—'}</Badge></TableCell>
                        <TableCell className="text-right font-medium">{formatGBP(cn.total_amount)}</TableCell>
                        <TableCell className="text-right">{formatGBP(cn.outstanding_amount)}</TableCell>
                        <TableCell className="text-xs">{cn.currency || '—'}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
            {creditNoteLines.length > 0 && (
              <Card className="mt-4">
                <CardHeader><CardTitle>Credit Note Line Items</CardTitle><CardDescription>{creditNoteLines.length} line items</CardDescription></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Credit Note</TableHead><TableHead>Description</TableHead>
                      <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit £</TableHead>
                      <TableHead className="text-right">Line £</TableHead>
                      <TableHead>Ledger Code</TableHead><TableHead>Ledger Name</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{creditNoteLines.map(li => {
                      const parent = creditNotes.find(c => c.id === li.credit_note_id);
                      return (
                        <TableRow key={li.id}>
                          <TableCell className="font-mono text-xs">{parent?.credit_note_number || '—'}</TableCell>
                          <TableCell>{li.description || '—'}</TableCell>
                          <TableCell className="text-right">{li.quantity ?? '—'}</TableCell>
                          <TableCell className="text-right">{formatGBP(li.unit_amount)}</TableCell>
                          <TableCell className="text-right font-medium">{formatGBP(li.line_amount)}</TableCell>
                          <TableCell className="font-mono text-xs">{li.account_code || '—'}</TableCell>
                          <TableCell className="text-xs">{li.account_name || '—'}</TableCell>
                        </TableRow>
                      );
                    })}</TableBody>
                  </Table></div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Journals + lines */}
          <TabsContent value="jnl">
            <Card>
              <CardHeader><CardTitle>Journals</CardTitle><CardDescription>Manual accounting entries (DR/CR)</CardDescription></CardHeader>
              <CardContent>
                {journals.length === 0 ? <EmptyState label="journals" /> : (
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Reference</TableHead><TableHead>Date</TableHead>
                      <TableHead>Narrative</TableHead><TableHead>Status</TableHead>
                      <TableHead className="text-right">Debits</TableHead><TableHead className="text-right">Credits</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{journals.map(j => (
                      <TableRow key={j.id}>
                        <TableCell className="font-mono text-xs font-medium">{j.reference || '—'}</TableCell>
                        <TableCell>{formatDate(j.journal_date)}</TableCell>
                        <TableCell>{j.narrative || '—'}</TableCell>
                        <TableCell><Badge variant="secondary">{j.status || '—'}</Badge></TableCell>
                        <TableCell className="text-right font-medium">{formatGBP(j.total_debits)}</TableCell>
                        <TableCell className="text-right font-medium">{formatGBP(j.total_credits)}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
            {journalLines.length > 0 && (
              <Card className="mt-4">
                <CardHeader><CardTitle>Journal Lines</CardTitle><CardDescription>{journalLines.length} DR/CR lines</CardDescription></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Journal</TableHead><TableHead>Account Code</TableHead><TableHead>Account Name</TableHead>
                      <TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{journalLines.map(li => {
                      const parent = journals.find(j => j.id === li.journal_id);
                      return (
                        <TableRow key={li.id}>
                          <TableCell className="font-mono text-xs">{parent?.reference || '—'}</TableCell>
                          <TableCell className="font-mono text-xs">{li.account_code || '—'}</TableCell>
                          <TableCell>{li.ledger_account_name || '—'}</TableCell>
                          <TableCell className="text-right font-medium">{li.debit ? formatGBP(li.debit) : '—'}</TableCell>
                          <TableCell className="text-right font-medium">{li.credit ? formatGBP(li.credit) : '—'}</TableCell>
                          <TableCell className="text-xs">{li.description || '—'}</TableCell>
                        </TableRow>
                      );
                    })}</TableBody>
                  </Table></div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Bank Accounts */}
          <TabsContent value="ba">
            <Card>
              <CardHeader><CardTitle>Bank Accounts</CardTitle><CardDescription>{`Total balance: ${formatGBP(totals.bankBalance)}`}</CardDescription></CardHeader>
              <CardContent>
                {bankAccounts.length === 0 ? <EmptyState label="bank accounts" /> : (
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Display</TableHead><TableHead>Account Name</TableHead><TableHead>Account #</TableHead>
                      <TableHead>Sort Code</TableHead><TableHead className="text-right">Current Balance</TableHead>
                      <TableHead>Default</TableHead><TableHead>Active</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{bankAccounts.map(b => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.displayed_as}</TableCell>
                        <TableCell>{b.account_name || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{b.account_number || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{b.sort_code || '—'}</TableCell>
                        <TableCell className="text-right font-medium">{formatGBP(b.current_balance)}</TableCell>
                        <TableCell>{b.is_default ? <Badge variant="default" className="bg-blue-500/15 text-blue-700">Default</Badge> : '—'}</TableCell>
                        <TableCell><ActiveBadge active={b.is_active} /></TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Bank Transactions */}
          <TabsContent value="btxn">
            <Card>
              <CardHeader><CardTitle>Bank Transactions</CardTitle><CardDescription>From /contact_payments (supplier payments + receipts)</CardDescription></CardHeader>
              <CardContent>
                {bankTransactions.length === 0 ? <EmptyState label="bank transactions" /> : (
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Date</TableHead><TableHead>Bank Account</TableHead><TableHead>Type</TableHead>
                      <TableHead>Reference</TableHead><TableHead>Contact</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{bankTransactions.map(t => (
                      <TableRow key={t.id}>
                        <TableCell>{formatDate(t.transaction_date)}</TableCell>
                        <TableCell>{t.bank_account_name || '—'}</TableCell>
                        <TableCell className="text-xs">{t.transaction_type_label || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{t.reference || '—'}</TableCell>
                        <TableCell>{t.contact_name || '—'}</TableCell>
                        <TableCell className="text-right font-medium">{formatGBP(t.total_amount)}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Other Payments */}
          <TabsContent value="op">
            <Card>
              <CardHeader><CardTitle>Other Payments</CardTitle><CardDescription>Bank-side payments not tied to a contact (bank charges, fees)</CardDescription></CardHeader>
              <CardContent>
                {otherPayments.length === 0 ? <EmptyState label="other payments" /> : (
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Date</TableHead><TableHead>Bank Account</TableHead>
                      <TableHead>Reference</TableHead><TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{otherPayments.map(p => (
                      <TableRow key={p.id}>
                        <TableCell>{formatDate(p.transaction_date)}</TableCell>
                        <TableCell>{p.bank_account_name || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{p.reference || '—'}</TableCell>
                        <TableCell>{p.description || '—'}</TableCell>
                        <TableCell className="text-right font-medium">{formatGBP(p.total_amount)}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Other Receipts */}
          <TabsContent value="or">
            <Card>
              <CardHeader><CardTitle>Other Receipts</CardTitle><CardDescription>Bank-side receipts not from a contact (interest, refunds)</CardDescription></CardHeader>
              <CardContent>
                {otherReceipts.length === 0 ? <EmptyState label="other receipts" /> : (
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Date</TableHead><TableHead>Bank Account</TableHead>
                      <TableHead>Reference</TableHead><TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{otherReceipts.map(r => (
                      <TableRow key={r.id}>
                        <TableCell>{formatDate(r.transaction_date)}</TableCell>
                        <TableCell>{r.bank_account_name || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{r.reference || '—'}</TableCell>
                        <TableCell>{r.description || '—'}</TableCell>
                        <TableCell className="text-right font-medium">{formatGBP(r.total_amount)}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Bank Transfers */}
          <TabsContent value="bt">
            <Card>
              <CardHeader><CardTitle>Bank Transfers</CardTitle><CardDescription>Transfers between bank accounts</CardDescription></CardHeader>
              <CardContent>
                {bankTransfers.length === 0 ? <EmptyState label="bank transfers" /> : (
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Date</TableHead><TableHead>From</TableHead><TableHead>To</TableHead>
                      <TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{bankTransfers.map(t => (
                      <TableRow key={t.id}>
                        <TableCell>{formatDate(t.transfer_date)}</TableCell>
                        <TableCell>{t.from_bank_account_name || '—'}</TableCell>
                        <TableCell>{t.to_bank_account_name || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{t.reference || '—'}</TableCell>
                        <TableCell className="text-right font-medium">{formatGBP(t.amount)}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Attachments */}
          <TabsContent value="att">
            <Card>
              <CardHeader><CardTitle>Attachments</CardTitle><CardDescription>Files attached to Sage records (invoice PDFs, receipt images)</CardDescription></CardHeader>
              <CardContent>
                {attachments.length === 0 ? <EmptyState label="attachments" /> : (
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow>
                      <TableHead>File Name</TableHead><TableHead>Type</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead>Attached To</TableHead>
                      <TableHead className="font-mono text-xs">Parent ID</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>{attachments.map(a => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.file_name || '—'}</TableCell>
                        <TableCell className="text-xs">{a.content_type || '—'}</TableCell>
                        <TableCell className="text-right text-xs">{formatBytes(a.file_size)}</TableCell>
                        <TableCell>{a.attached_to_entity ? <Badge variant="outline" className="text-[10px]">{a.attached_to_entity}</Badge> : '—'}</TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">{a.attached_to_id?.substring(0, 12)}…</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <p className="text-[10px] text-muted-foreground text-center">
          Last loaded {new Date().toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}
