import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Loader2,
  Building2,
  Landmark,
  Plus,
  CheckCircle2,
  CreditCard,
  HelpCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { PlaidService } from '@/services/plaidService';
import type { AccountsPayableInvoice } from '@/hooks/useAccountsPayableInvoices';
import type { PlaidConnection } from '@/hooks/usePlaidConnections';

interface VendorBankAccount {
  id: string;
  vendor_name: string | null;
  account_name: string;
  account_number: string | null;
  sort_code: string | null;
  bank_name: string | null;
}

interface PayInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: AccountsPayableInvoice;
  orgId: string;
  /** Accounting platform name — used to decide whether to fetch live bank accounts */
  platformName?: string;
  /** Bank accounts from the accounting platform (Xero/Sage/QB) — "Record Against" (fallback/non-Xero) */
  bankAccounts: any[];
  isLoadingBankAccounts: boolean;
  /** Called with accounting bank account ID, account code (fallback), and Plaid link token when user confirms */
  onConfirmPay: (bankAccountId: string, bankAccountCode: string, linkToken: string) => void;
}

const EMPTY_NEW_BANK = { account_name: '', account_number: '', sort_code: '', bank_name: '' };

function fmt(amount: number | null | undefined, currency?: string | null) {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency || 'GBP',
    minimumFractionDigits: 2,
  }).format(amount);
}

function getCurrencySymbol(code: string | null | undefined): string {
  if (!code) return '£';
  try {
    const s = (0).toLocaleString('en', { style: 'currency', currency: code, minimumFractionDigits: 0 });
    return s.replace(/[\d,.\s]/g, '').trim();
  } catch {
    return code;
  }
}

export function PayInvoiceDialog({
  open,
  onOpenChange,
  invoice,
  orgId,
  platformName,
  bankAccounts: cachedBankAccounts,
  isLoadingBankAccounts: isLoadingCached,
  onConfirmPay,
}: PayInvoiceDialogProps) {
  // For Xero: fetch live bank accounts from Xero API so we always show valid accounts
  // regardless of whether the local DB cache is stale or from a different tenant.
  const [liveBankAccounts, setLiveBankAccounts] = useState<any[] | null>(null);
  const [isLoadingLive, setIsLoadingLive] = useState(false);

  const bankAccounts = (platformName?.toLowerCase() === 'xero' && liveBankAccounts !== null)
    ? liveBankAccounts
    : cachedBankAccounts;
  const isLoadingBankAccounts = platformName?.toLowerCase() === 'xero' ? isLoadingLive : isLoadingCached;
  const remaining = invoice.amount_due ?? invoice.total_amount ?? 0;
  const currency = invoice.currency;


  const [selectedPlaidAccountId, setSelectedPlaidAccountId] = useState('');
  const [selectedVendorBankId, setSelectedVendorBankId] = useState('');
  const [selectedXeroBankId, setSelectedXeroBankId] = useState('');
  const [selectedXeroBankCode, setSelectedXeroBankCode] = useState('');
  const [reference, setReference] = useState('');

  const [plaidConnections, setPlaidConnections] = useState<PlaidConnection[]>([]);
  const [isLoadingPlaid, setIsLoadingPlaid] = useState(false);

  const [vendorBanks, setVendorBanks] = useState<VendorBankAccount[]>([]);
  const [isLoadingVendorBanks, setIsLoadingVendorBanks] = useState(false);

  const [showAddBank, setShowAddBank] = useState(true);
  const [newBank, setNewBank] = useState(EMPTY_NEW_BANK);
  const [isSavingBank, setIsSavingBank] = useState(false);

  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [isPaying, setIsPaying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedPlaidAccountId('');
    setSelectedVendorBankId('');
    setSelectedXeroBankId('');
    setSelectedXeroBankCode('');
    setReference(invoice.invoice_number ? `Payment for ${invoice.invoice_number}` : '');
    setShowAddBank(true);
    setNewBank(EMPTY_NEW_BANK);
    setConfirmDialogOpen(false);
    setIsPaying(false);
    loadPlaidConnections();
    loadVendorBanks();
    if (platformName?.toLowerCase() === 'xero') {
      loadLiveXeroBankAccounts();
    }
  }, [open, invoice.invoice_number, platformName]);

  async function loadLiveXeroBankAccounts() {
    setIsLoadingLive(true);
    try {
      const result = await supabase.functions.invoke('xero-create-invoice', {
        body: { invoiceId: invoice.id, action: 'getBankAccounts' },
      });
      if (result.data?.success && Array.isArray(result.data.bankAccounts)) {
        setLiveBankAccounts(result.data.bankAccounts);
      } else {
        setLiveBankAccounts(null); // fall back to cached
      }
    } catch {
      setLiveBankAccounts(null); // fall back to cached
    } finally {
      setIsLoadingLive(false);
    }
  }

  async function loadPlaidConnections() {
    setIsLoadingPlaid(true);
    try {
      const res = await PlaidService.getConnections(orgId);
      setPlaidConnections(res.connections ?? []);
    } catch {
      setPlaidConnections([]);
    } finally {
      setIsLoadingPlaid(false);
    }
  }

  async function loadVendorBanks() {
    setIsLoadingVendorBanks(true);
    try {
      const { data, error } = await (supabase as any)
        .from('vendor_bank_accounts')
        .select('id, vendor_name, account_name, account_number, sort_code, bank_name')
        .eq('organization_id', orgId)
        .order('account_name', { ascending: true });
      if (error) throw error;
      const banks = data ?? [];
      setVendorBanks(banks);
      // If saved banks exist, collapse the form by default so user can pick from dropdown
      if (banks.length > 0) setShowAddBank(false);
    } catch {
      setVendorBanks([]);
    } finally {
      setIsLoadingVendorBanks(false);
    }
  }

  async function handleSaveVendorBank() {
    if (!newBank.account_name.trim()) {
      toast.error('Account holder name is required');
      return;
    }
    setIsSavingBank(true);
    try {
      const { data, error } = await (supabase as any)
        .from('vendor_bank_accounts')
        .insert({
          organization_id: orgId,
          vendor_name: invoice.vendor_name || null,
          account_name: newBank.account_name.trim(),
          account_number: newBank.account_number.trim() || null,
          sort_code: newBank.sort_code.trim() || null,
          bank_name: newBank.bank_name.trim() || null,
        })
        .select()
        .single();
      if (error) throw error;
      setVendorBanks(prev => [...prev, data]);
      setSelectedVendorBankId(data.id);
      setNewBank(EMPTY_NEW_BANK);
      setShowAddBank(false);
      toast.success('Bank details saved');
    } catch (e: any) {
      toast.error('Failed to save bank details', { description: e.message });
    } finally {
      setIsSavingBank(false);
    }
  }

  // ── Confirm & Pay flow ────────────────────────────────────────────────────────

  function handleClickConfirmAndPay() {
    if (!selectedXeroBankId) {
      toast.error('Please select an account to record the payment against');
      return;
    }
    const hasVendorBank = selectedVendorBankId || (showAddBank && newBank.account_name.trim());
    if (!hasVendorBank) {
      toast.error('Please select or add vendor bank details to pay to');
      return;
    }
    setConfirmDialogOpen(true);
  }

  async function handleConfirm() {
    setConfirmDialogOpen(false);
    setIsPaying(true);

    try {
      // Resolve vendor bank details for Plaid Payment Initiation
      let bankId         = selectedVendorBankId || undefined;
      let bankName: string | undefined;
      let sortCode: string | undefined;
      let accountNumber: string | undefined;

      if (showAddBank && newBank.account_name.trim()) {
        // Save the new bank first so we can cache the recipient ID against it
        const { data, error } = await (supabase as any)
          .from('vendor_bank_accounts')
          .insert({
            organization_id: orgId,
            vendor_name:     invoice.vendor_name || null,
            account_name:    newBank.account_name.trim(),
            account_number:  newBank.account_number.trim() || null,
            sort_code:       newBank.sort_code.trim() || null,
            bank_name:       newBank.bank_name.trim() || null,
          })
          .select()
          .single();
        if (error) throw error;
        bankId        = data.id;
        bankName      = data.account_name;
        sortCode      = data.sort_code ?? undefined;
        accountNumber = data.account_number ?? undefined;
      } else if (bankId) {
        const bank = vendorBanks.find(b => b.id === bankId);
        bankName      = bank?.account_name;
        sortCode      = bank?.sort_code ?? undefined;
        accountNumber = bank?.account_number ?? undefined;
      }

      // Call backend to create Plaid payment + get link token for consent
      const result = await PlaidService.initiateInvoicePayment({
        orgId,
        vendorBankId:        bankId,
        vendorBankName:      bankName,
        vendorSortCode:      sortCode,
        vendorAccountNumber: accountNumber,
        amount:              payAmount,
        reference,
      });

      // Hand off to drawer: dialog closes, Plaid Link opens at drawer level (no competing overlays)
      onConfirmPay(selectedXeroBankId, selectedXeroBankCode, result.linkToken);

    } catch (e: any) {
      toast.error('Failed to initiate payment', { description: e.message });
      setIsPaying(false);
    }
  }

  const plaidAccounts = plaidConnections.flatMap(conn =>
    conn.accounts.map(acc => ({
      key: acc.id,
      institutionName: conn.institution_name ?? 'Bank',
      accountName: acc.official_name ?? acc.name ?? '',
      mask: acc.mask,
      label: [
        `${conn.institution_name ?? 'Bank'} — ${acc.official_name ?? acc.name}`,
        acc.mask ? `(****${acc.mask})` : null,
        acc.current_balance != null ? `${acc.currency_code} ${acc.current_balance.toFixed(2)}` : null,
      ].filter(Boolean).join(' '),
      balance: acc.current_balance,
      currency: acc.currency_code,
    }))
  );
  const selectedPlaidAccount = plaidAccounts.find(a => a.key === selectedPlaidAccountId) ?? null;

  const payAmount = remaining;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[720px] w-full flex flex-col" style={{ maxHeight: 'min(92vh, 820px)' }}>
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              Confirm Payment
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-1">

            {/* Invoice summary */}
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="space-y-0.5">
                  <p className="font-semibold text-sm leading-tight">
                    {invoice.vendor_name || 'Unknown Vendor'}
                  </p>
                  {invoice.invoice_number && (
                    <p className="text-xs text-muted-foreground">#{invoice.invoice_number}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold">{fmt(invoice.total_amount, currency)}</p>
                  <p className="text-xs text-muted-foreground">Invoice Total</p>
                </div>
              </div>
              <Separator className="mb-3" />
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Invoice Date</p>
                  <p className="font-medium">{invoice.invoice_date ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Due Date</p>
                  <p className="font-medium">{invoice.due_date ?? invoice.payment_due_by ?? '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground">Amount Due</p>
                  <p className="font-semibold text-green-700">{fmt(remaining, currency)}</p>
                </div>
              </div>
            </div>

            {/* Paying From | Paying To — side by side */}
            <div className="grid grid-cols-2 gap-4">

              {/* Paying From — Plaid bank accounts */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <Landmark className="w-3.5 h-3.5 text-muted-foreground" />
                  Paying From (Your Bank)
                </Label>
                {isLoadingPlaid ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                  </div>
                ) : plaidAccounts.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-1">
                    No Plaid accounts connected.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <Select value={selectedPlaidAccountId} onValueChange={setSelectedPlaidAccountId}>
                      <SelectTrigger className="text-sm">
                        <SelectValue placeholder="Select your bank account" />
                      </SelectTrigger>
                      <SelectContent>
                        {plaidAccounts.map(acc => (
                          <SelectItem key={acc.key} value={acc.key}>
                            {acc.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {selectedPlaidAccount && (
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <Landmark className="w-4 h-4 text-green-700 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground leading-tight truncate">
                              {selectedPlaidAccount.institutionName} — {selectedPlaidAccount.accountName}
                            </p>
                            {selectedPlaidAccount.mask && (
                              <p className="text-xs text-muted-foreground">····{selectedPlaidAccount.mask}</p>
                            )}
                          </div>
                        </div>
                        {selectedPlaidAccount.balance != null && (
                          <span className="text-sm font-bold text-green-700 shrink-0 tabular-nums">
                            {selectedPlaidAccount.currency} {selectedPlaidAccount.balance.toFixed(2)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Paying To — Vendor bank accounts */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                    Paying To (Vendor Bank)
                  </Label>
                  {showAddBank ? (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => { setShowAddBank(false); setNewBank(EMPTY_NEW_BANK); }}
                    >
                      — Cancel new entry
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                      onClick={() => setShowAddBank(true)}
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  )}
                </div>

                {isLoadingVendorBanks ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                  </div>
                ) : (
                  <>
                    {/* Always show the dropdown when there are saved banks */}
                    {vendorBanks.length > 0 && (
                      <Select value={selectedVendorBankId} onValueChange={setSelectedVendorBankId}>
                        <SelectTrigger className="text-sm">
                          <SelectValue placeholder="— Select saved bank account —" />
                        </SelectTrigger>
                        <SelectContent>
                          {vendorBanks.map(vb => (
                            <SelectItem key={vb.id} value={vb.id}>
                              {vb.account_name}
                              {vb.account_number ? ` ••••${vb.account_number.slice(-4)}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {/* No saved banks and form hidden */}
                    {vendorBanks.length === 0 && !showAddBank && (
                      <p className="text-xs text-muted-foreground italic py-1">
                        No saved bank details yet.
                      </p>
                    )}
                    {/* Hint when form is visible */}
                    {showAddBank && vendorBanks.length === 0 && (
                      <p className="text-xs text-orange-600 py-0.5">
                        Select a vendor bank account or add new details.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Inline add vendor bank form — full width */}
            {showAddBank && (
              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">
                  New Bank Details
                </p>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Account Holder Name *
                  </Label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="e.g. Acme Dental Ltd"
                    value={newBank.account_name}
                    onChange={e => setNewBank(p => ({ ...p, account_name: e.target.value }))}
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      Sort Code
                    </Label>
                    <Input
                      className="h-8 text-sm"
                      placeholder="12-34-56"
                      value={newBank.sort_code}
                      onChange={e => setNewBank(p => ({ ...p, sort_code: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      Account Number *
                    </Label>
                    <Input
                      className="h-8 text-sm"
                      placeholder="12345678"
                      value={newBank.account_number}
                      onChange={e => setNewBank(p => ({ ...p, account_number: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Bank Name
                  </Label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="e.g. BARCLAYS"
                    value={newBank.bank_name}
                    onChange={e => setNewBank(p => ({ ...p, bank_name: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    className="gap-1.5 text-xs"
                    disabled={isSavingBank || !newBank.account_name.trim()}
                    onClick={handleSaveVendorBank}
                  >
                    {isSavingBank ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Save Bank Details
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs"
                    disabled={isSavingBank}
                    onClick={() => { setShowAddBank(false); setNewBank(EMPTY_NEW_BANK); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Record Against | Reference — side by side */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium flex items-center gap-1">
                  <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                  Record Against <span className="text-red-500 ml-0.5">*</span>
                </Label>
                <p className="text-xs text-muted-foreground">Accounting bank account</p>
                {isLoadingBankAccounts ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                  </div>
                ) : bankAccounts.length === 0 ? (
                  <p className="text-xs text-amber-600 py-1">
                    No bank accounts found in Xero. Please add a bank account in Xero → Chart of Accounts → Add Account (Type: Bank).
                  </p>
                ) : (
                  <Select value={selectedXeroBankId} onValueChange={(v) => {
                    setSelectedXeroBankId(v);
                    const acc = bankAccounts.find((a: any) => a.coa_account_id === v);
                    setSelectedXeroBankCode(acc?.coa_account_code || '');
                  }}>
                    <SelectTrigger className={cn('text-sm', !selectedXeroBankId && 'text-muted-foreground')}>
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent>
                      {bankAccounts.map((acc: any) => (
                        <SelectItem key={acc.coa_account_id || acc.id} value={acc.coa_account_id}>
                          {acc.coa_account_code
                            ? `${acc.coa_account_code} — ${acc.coa_account_name}`
                            : acc.coa_account_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Reference / Memo</Label>
                <p className="text-xs text-muted-foreground">Payment reference</p>
                <Input
                  className="text-sm"
                  placeholder="Payment reference"
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                />
              </div>
            </div>

            {/* Total Payment */}
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-green-800 font-medium">Total Payment</span>
              <span className="text-base font-bold text-green-700">{fmt(payAmount, currency)}</span>
            </div>

          </div>

          <DialogFooter className="gap-2 shrink-0 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPaying}
            >
              Cancel
            </Button>
            <Button
              className="gap-2 bg-green-600 hover:bg-green-700 text-white min-w-[140px]"
              disabled={isPaying}
              onClick={handleClickConfirmAndPay}
            >
              {isPaying
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <CheckCircle2 className="w-4 h-4" />}
              {isPaying ? 'Processing…' : 'Confirm & Pay'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation step */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent className="max-w-sm text-center">
          <AlertDialogHeader className="items-center">
            <div className="w-16 h-16 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center mx-auto mb-1">
              <HelpCircle className="w-8 h-8 text-muted-foreground/60" />
            </div>
            <AlertDialogTitle className="text-lg">Confirm Payment</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm text-foreground">
                <p>Amount: <span className="font-bold">{fmt(payAmount, currency)}</span></p>
                <p>Vendor: <span className="font-bold">{invoice.vendor_name || '—'}</span></p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-center gap-3 sm:justify-center">
            <Button
              variant="secondary"
              onClick={() => setConfirmDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white gap-2"
              onClick={handleConfirm}
            >
              <CheckCircle2 className="w-4 h-4" />
              Yes, Pay Now
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
