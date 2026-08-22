import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface XeroTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface XeroAccount {
  AccountID: string;
  Code?: string;
  Name: string;
  Type: string;
  Status: string;
  Description?: string;
  Class?: string;
  BankAccountType?: string;
  CurrencyCode?: string;
  TaxType?: string;
  ReportingCode?: string;
  ReportingCodeName?: string;
  UpdatedDateUTC?: string;
}

interface XeroBankTransaction {
  BankTransactionID?: string;
  Type?: string;
  Contact?: { ContactID?: string; Name?: string };
  LineItems?: any[];
  BankAccount?: { AccountID?: string; Name?: string };
  IsReconciled?: boolean;
  HasAttachments?: boolean;
  Date?: string;
  Status?: string;
  LineAmountTypes?: string;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  UpdatedDateUTC?: string;
  CurrencyCode?: string;
}

interface XeroInvoice {
  InvoiceID?: string;
  InvoiceNumber: string;
  Type: string;
  Reference?: string;
  AmountDue?: number;
  AmountPaid?: number;
  AmountCredited?: number;
  CurrencyRate?: number;
  IsDiscounted?: boolean;
  RepeatingInvoiceID?: string;
  Date?: string;
  DueDate?: string;
  ExpectedPaymentDate?: string;
  PlannedPaymentDate?: string;
  Status?: string;
  LineAmountTypes?: string;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  UpdatedDateUTC?: string;
  CurrencyCode?: string;
  FullyPaidOnDate?: string;
  Contact?: { ContactID?: string; Name?: string };
  LineItems?: Array<{
    LineItemID?: string;
    Description?: string;
    Quantity?: number;
    UnitAmount?: number;
    LineAmount?: number;
  }>;
  Payments?: Array<{
    PaymentID?: string;
    Date?: string;
    Amount?: number;
    Reference?: string;
    CurrencyRate?: number;
  }>;
}

interface XeroCreditNote {
  CreditNoteID?: string;
  CreditNoteNumber: string;
  Type?: string;
  Reference?: string;
  RemainingCredit?: number;
  Contact?: { ContactID?: string; Name?: string };
  Date?: string;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  UpdatedDateUTC?: string;
  CurrencyCode?: string;
  FullyPaidOnDate?: string;
  CurrencyRate?: number;
  Status?: string;
  Allocations?: Array<{
    AllocationID?: string;
    Date?: string;
    Amount?: number;
    Invoice?: { InvoiceID?: string; InvoiceNumber?: string };
  }>;
  Payments?: Array<{
    PaymentID?: string;
    Date?: string;
    Amount?: number;
    Reference?: string;
  }>;
}

interface XeroJournal {
  JournalID?: string;
  JournalNumber?: number;
  JournalDate?: string;
  CreatedDateUTC?: string;
  Reference?: string;
  SourceID?: string;
  SourceType?: string;
  JournalLines?: Array<{
    JournalLineID?: string;
    AccountID?: string;
    AccountCode?: string;
    AccountType?: string;
    AccountName?: string;
    Description?: string;
    NetAmount?: number;
    GrossAmount?: number;
    TaxAmount?: number;
    TaxType?: string;
    TaxName?: string;
  }>;
}

interface XeroOverpayment {
  OverpaymentID?: string;
  Type?: string;
  Contact?: { ContactID?: string; Name?: string };
  Date?: string;
  Status?: string;
  LineAmountTypes?: string;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  UpdatedDateUTC?: string;
  CurrencyCode?: string;
  RemainingCredit?: number;
  Payments?: Array<{
    PaymentID?: string;
    Date?: string;
    Amount?: number;
    Reference?: string;
    CurrencyRate?: number;
    Invoice?: { InvoiceID?: string };
  }>;
}

/**
 * Refresh Xero access token using refresh token
 */
async function refreshXeroToken(
  supabase: any,
  integrationId: string,
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: string } | null> {
  try {
    const tokenUrl = "https://identity.xero.com/connect/token";
    const credentials = btoa(`${clientId}:${clientSecret}`);

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(`Token refresh failed: ${tokenResponse.status} - ${errorText}`);
      return null;
    }

    const tokenData: XeroTokenResponse = await tokenResponse.json();
    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // Update tokens in database
    await supabase
      .from("platform_integrations")
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: tokenExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId);

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenExpiresAt,
    };
  } catch (error) {
    console.error("Error refreshing token:", error);
    return null;
  }
}

/**
 * Get valid access token (refresh if needed)
 */
async function getValidAccessToken(
  supabase: any,
  integration: any,
  platformOrg: any
): Promise<string | null> {
  const tokenExpiry = integration.token_expires_at ? new Date(integration.token_expires_at) : null;
  const now = new Date();
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  // Token is still valid
  if (tokenExpiry && tokenExpiry > fiveMinutesFromNow && integration.access_token) {
    return integration.access_token;
  }

  // Need to refresh token
  if (integration.refresh_token && integration.client_id && integration.client_secret) {
    // Coordinate through the shared platform_integrations.refresh_lock_at mutex
    // (same column as xero-refresh-token + the Node backend) so this sync can't
    // race another refresher and burn the rotating refresh_token → daily
    // disconnect. Atomic acquire; a lock older than 60s is stealable.
    // Two standalone conditional UPDATEs ("free" then "stale") — NOT a single
    // .or(`refresh_lock_at.is.null,refresh_lock_at.lt.${ts}`), which PostgREST
    // mis-parses for timestamp values ("column does not exist"), making
    // acquisition silently always fail.
    const staleBefore = new Date(Date.now() - 60_000).toISOString();
    const nowIso = new Date().toISOString();
    let lockRes = await supabase
      .from("platform_integrations")
      .update({ refresh_lock_at: nowIso })
      .eq("id", integration.id)
      .is("refresh_lock_at", null)
      .select("id");
    if (lockRes.error) console.error("[xero-initial-sync] lock acquire (free) error:", lockRes.error);
    let didAcquire = Array.isArray(lockRes.data) && lockRes.data.length > 0;
    if (!didAcquire) {
      lockRes = await supabase
        .from("platform_integrations")
        .update({ refresh_lock_at: nowIso })
        .eq("id", integration.id)
        .lt("refresh_lock_at", staleBefore)
        .select("id");
      if (lockRes.error) console.error("[xero-initial-sync] lock acquire (stale) error:", lockRes.error);
      didAcquire = Array.isArray(lockRes.data) && lockRes.data.length > 0;
    }

    if (!didAcquire) {
      // Another caller is refreshing — wait, then reuse what they wrote.
      await new Promise((r) => setTimeout(r, 3_000));
      const { data: freshRow } = await supabase
        .from("platform_integrations")
        .select("access_token, token_expires_at")
        .eq("id", integration.id)
        .single();
      const freshExpiry = freshRow?.token_expires_at ? new Date(freshRow.token_expires_at) : null;
      if (freshRow?.access_token && freshExpiry && freshExpiry > fiveMinutesFromNow) {
        return freshRow.access_token;
      }
      return null;
    }

    try {
      // Re-read the latest refresh_token (it may have rotated before we locked).
      const { data: locked } = await supabase
        .from("platform_integrations")
        .select("refresh_token, access_token, token_expires_at")
        .eq("id", integration.id)
        .single();
      const lockedExpiry = locked?.token_expires_at ? new Date(locked.token_expires_at) : null;
      if (locked?.access_token && lockedExpiry && lockedExpiry > fiveMinutesFromNow) {
        return locked.access_token;
      }
      const refreshed = await refreshXeroToken(
        supabase,
        integration.id,
        locked?.refresh_token || integration.refresh_token,
        integration.client_id,
        integration.client_secret
      );
      return refreshed?.accessToken || null;
    } finally {
      await supabase
        .from("platform_integrations")
        .update({ refresh_lock_at: null })
        .eq("id", integration.id);
    }
  }

  return null;
}

/**
 * Sync Chart of Accounts (Accounts)
 */
async function syncAccounts(
  supabase: any,
  accessToken: string,
  realmId: string,
  organizationId: string,
  platformIntegrationId: string,
  platformIntegrationOrgId: string
): Promise<number> {
  try {
    const response = await fetch("https://api.xero.com/api.xro/2.0/Accounts", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Xero-tenant-id": realmId,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch accounts: ${response.status} - ${errorText}`);
      return 0;
    }

    const data = await response.json();
    const accounts: XeroAccount[] = data.Accounts || [];

    if (accounts.length === 0) {
      return 0;
    }

    // Upsert accounts
    const accountsToUpsert = accounts.map((acc) => ({
      organization_id: organizationId,
      platform_integration_id: platformIntegrationId,
      platform_integration_organization_id: platformIntegrationOrgId,
      platform_name: "xero",
      coa_account_id: acc.AccountID,
      coa_account_code: acc.Code || null,
      coa_account_name: acc.Name,
      coa_account_type: acc.Type,
      coa_account_sub_type: acc.Type,
      coa_classification: acc.Class || null,
      coa_description: acc.Description || null,
      coa_tax_type: acc.TaxType || null,
      coa_bank_account_type: acc.BankAccountType || null,
      coa_reporting_code: acc.ReportingCode || null,
      coa_reporting_name: acc.ReportingCodeName || null,
      coa_is_active: acc.Status?.toLowerCase() === "active",
      coa_sync_token: acc.AccountID,
      coa_updated_date_utc: acc.UpdatedDateUTC ? new Date(acc.UpdatedDateUTC).toISOString() : null,
      updated_at: new Date().toISOString(),
    }));

    // Use upsert with conflict resolution
    const { error } = await supabase
      .from("platform_integration_chart_of_accounts")
      .upsert(accountsToUpsert, {
        onConflict: "organization_id,platform_integration_id,coa_account_id",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error("Error upserting accounts:", error);
      return 0;
    }

    console.log(`Synced ${accounts.length} accounts`);
    return accounts.length;
  } catch (error) {
    console.error("Error syncing accounts:", error);
    return 0;
  }
}

/**
 * Sync Bank Transactions
 */
async function syncBankTransactions(
  supabase: any,
  accessToken: string,
  realmId: string,
  organizationId: string,
  platformIntegrationId: string,
  platformIntegrationOrgId: string,
  startDate?: string
): Promise<number> {
  try {
    let page = 1;
    let totalSynced = 0;
    const ifModifiedSince = startDate ? `?IfModifiedSince=${startDate}` : "";

    do {
      const response = await fetch(
        `https://api.xero.com/api.xro/2.0/BankTransactions${ifModifiedSince}&page=${page}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Xero-tenant-id": realmId,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to fetch bank transactions: ${response.status} - ${errorText}`);
        break;
      }

      const data = await response.json();
      const transactions: XeroBankTransaction[] = data.BankTransactions || [];

      if (transactions.length === 0) {
        break;
      }

      // Upsert bank transactions
      const transactionsToUpsert = transactions.map((txn) => ({
        organization_id: organizationId,
        platform_integration_id: platformIntegrationId,
        platform_integration_organization_id: platformIntegrationOrgId,
        bank_transaction_id: txn.BankTransactionID || null,
        bank_account_id: txn.BankAccount?.AccountID || null,
        bank_account_name: txn.BankAccount?.Name || null,
        type: txn.Type || null,
        is_reconciled: txn.IsReconciled || false,
        has_attachments: txn.HasAttachments || false,
        contact_id: txn.Contact?.ContactID || null,
        contact_name: txn.Contact?.Name || null,
        transaction_date: txn.Date ? new Date(txn.Date).toISOString().split("T")[0] : null,
        status: txn.Status || null,
        line_amount_types: txn.LineAmountTypes || null,
        sub_total: txn.SubTotal || 0,
        total_tax: txn.TotalTax || 0,
        total: txn.Total || 0,
        currency_code: txn.CurrencyCode || null,
        updated_date_utc: txn.UpdatedDateUTC ? new Date(txn.UpdatedDateUTC).toISOString() : null,
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from("xero_bank_transactions")
        .upsert(transactionsToUpsert, {
          onConflict: "organization_id,platform_integration_organization_id,bank_transaction_id",
          ignoreDuplicates: false,
        });

      if (error) {
        console.error("Error upserting bank transactions:", error);
        break;
      }

      totalSynced += transactions.length;
      page++;

      // Rate limiting - wait 200ms between pages
      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (true);

    console.log(`Synced ${totalSynced} bank transactions`);
    return totalSynced;
  } catch (error) {
    console.error("Error syncing bank transactions:", error);
    return 0;
  }
}

/**
 * Sync Invoices
 */
async function syncInvoices(
  supabase: any,
  accessToken: string,
  realmId: string,
  organizationId: string,
  platformIntegrationId: string,
  platformIntegrationOrgId: string,
  startDate?: string
): Promise<number> {
  try {
    let page = 1;
    let totalSynced = 0;
    const ifModifiedSince = startDate ? `?IfModifiedSince=${startDate}` : "";

    do {
      const response = await fetch(
        `https://api.xero.com/api.xro/2.0/Invoices${ifModifiedSince}&page=${page}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Xero-tenant-id": realmId,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to fetch invoices: ${response.status} - ${errorText}`);
        break;
      }

      const data = await response.json();
      const invoices: XeroInvoice[] = data.Invoices || [];

      if (invoices.length === 0) {
        break;
      }

      // Map Xero status to accounts_payable_invoice status
      const mapXeroStatus = (xeroStatus: string | undefined): string => {
        if (!xeroStatus) return "pending_review";
        switch (xeroStatus.toUpperCase()) {
          case "DRAFT": return "pending_review";
          case "SUBMITTED": return "pending_approval";
          case "AUTHORISED": return "approved";
          case "PAID": return "paid";
          case "VOIDED": return "rejected";
          default: return "pending_review";
        }
      };

      // Upsert into accounts_payable_invoice and accounts_payable_invoice_line_item
      for (const invoice of invoices) {
        const invoiceId = invoice.InvoiceID || "";

        const apInvoiceRow = {
          organization_id: organizationId,
          platform_integration_id: platformIntegrationId,
          platform_integration_organization_id: platformIntegrationOrgId,
          xero_invoice_id: invoiceId,
          invoice_number: invoice.InvoiceNumber,
          customer_name: invoice.Contact?.Name || null,
          vendor_name: null,
          invoice_date: invoice.Date ? new Date(invoice.Date).toISOString().split("T")[0] : null,
          due_date: invoice.DueDate ? new Date(invoice.DueDate).toISOString().split("T")[0] : null,
          currency: invoice.CurrencyCode || "GBP",
          subtotal: invoice.SubTotal ?? null,
          tax: invoice.TotalTax ?? null,
          total_amount: invoice.Total ?? null,
          amount_due: invoice.AmountDue ?? null,
          amount: invoice.AmountPaid ?? null,
          status: mapXeroStatus(invoice.Status),
          xero_status: invoice.Status || null,
          is_from_xero: true,
          updated_at: new Date().toISOString(),
        };

        const { data: insertedInvoice, error: invoiceError } = await supabase
          .from("accounts_payable_invoice")
          .upsert(apInvoiceRow, {
            onConflict: "organization_id,platform_integration_organization_id,xero_invoice_id",
            ignoreDuplicates: false,
          })
          .select("id")
          .single();

        if (invoiceError) {
          console.error("Error upserting invoice into accounts_payable_invoice:", invoiceError);
          continue;
        }

        const apInvoiceUuid = insertedInvoice?.id;

        // Replace line items: delete existing then insert (idempotent sync)
        if (apInvoiceUuid) {
          await supabase
            .from("accounts_payable_invoice_line_item")
            .delete()
            .eq("accounts_payable_invoice_id", apInvoiceUuid);

          if (invoice.LineItems && invoice.LineItems.length > 0) {
            const lineItemsToInsert = invoice.LineItems.map((item) => ({
              accounts_payable_invoice_id: apInvoiceUuid,
              description: item.Description || null,
              quantity: item.Quantity ?? null,
              unit_price: item.UnitAmount ?? null,
              line_total: item.LineAmount ?? null,
              updated_at: new Date().toISOString(),
            }));

            await supabase.from("accounts_payable_invoice_line_item").insert(lineItemsToInsert);
          }
        }

        // Upsert xero_payments (with optional link to accounts_payable_invoice)
        if (invoice.Payments && invoice.Payments.length > 0) {
          const paymentsToUpsert = invoice.Payments.map((payment) => ({
            organization_id: organizationId,
            platform_integration_id: platformIntegrationId,
            platform_integration_organization_id: platformIntegrationOrgId,
            payment_id: payment.PaymentID || null,
            invoice_id: invoiceId,
            accounts_payable_invoice_id: apInvoiceUuid || null,
            payment_date: payment.Date ? new Date(payment.Date).toISOString().split("T")[0] : null,
            amount: payment.Amount || null,
            reference: payment.Reference || null,
            currency_rate: payment.CurrencyRate || null,
            transaction_type: "InvoicePayment",
            updated_at: new Date().toISOString(),
          }));

          await supabase.from("platform_payments").upsert(paymentsToUpsert, {
            onConflict: "organization_id,platform_integration_organization_id,payment_id",
            ignoreDuplicates: false,
          });
        }
      }

      totalSynced += invoices.length;
      page++;

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (true);

    console.log(`Synced ${totalSynced} invoices`);
    return totalSynced;
  } catch (error) {
    console.error("Error syncing invoices:", error);
    return 0;
  }
}

/**
 * Sync Credit Notes
 */
async function syncCreditNotes(
  supabase: any,
  accessToken: string,
  realmId: string,
  organizationId: string,
  platformIntegrationId: string,
  platformIntegrationOrgId: string,
  startDate?: string
): Promise<number> {
  try {
    let page = 1;
    let totalSynced = 0;
    const ifModifiedSince = startDate ? `?IfModifiedSince=${startDate}` : "";

    do {
      const response = await fetch(
        `https://api.xero.com/api.xro/2.0/CreditNotes${ifModifiedSince}&page=${page}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Xero-tenant-id": realmId,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to fetch credit notes: ${response.status} - ${errorText}`);
        break;
      }

      const data = await response.json();
      const creditNotes: XeroCreditNote[] = data.CreditNotes || [];

      if (creditNotes.length === 0) {
        break;
      }

      for (const creditNote of creditNotes) {
        const creditNoteId = creditNote.CreditNoteID || "";

        // Upsert credit note
        const { data: insertedCreditNote, error: creditNoteError } = await supabase
          .from("platform_credit_notes")
          .upsert(
            {
              organization_id: organizationId,
              platform_integration_id: platformIntegrationId,
              platform_integration_organization_id: platformIntegrationOrgId,
              credit_note_id: creditNoteId,
              credit_note_number: creditNote.CreditNoteNumber,
              account_type: creditNote.Type || "",
              credit_note_reference: creditNote.Reference || null,
              fully_paid_on_date: creditNote.FullyPaidOnDate
                ? new Date(creditNote.FullyPaidOnDate).toISOString().split("T")[0]
                : null,
              credit_note_date: creditNote.Date ? new Date(creditNote.Date).toISOString().split("T")[0] : null,
              sub_total: creditNote.SubTotal || 0,
              total_tax: creditNote.TotalTax || 0,
              total: creditNote.Total || 0,
              remaining_credit: creditNote.RemainingCredit || 0,
              currency_rate: creditNote.CurrencyRate || 0,
              currency_code: creditNote.CurrencyCode || null,
              payment_id: creditNote.Payments?.[0]?.PaymentID || null,
              payment_date: creditNote.Payments?.[0]?.Date
                ? new Date(creditNote.Payments[0].Date).toISOString().split("T")[0]
                : null,
              payment_amount: creditNote.Payments?.[0]?.Amount || 0,
              payment_reference: creditNote.Payments?.[0]?.Reference || null,
              allocation_id: creditNote.Allocations?.[0]?.AllocationID || null,
              allocation_amount: creditNote.Allocations?.[0]?.Amount || 0,
              allocation_date: creditNote.Allocations?.[0]?.Date
                ? new Date(creditNote.Allocations[0].Date).toISOString().split("T")[0]
                : null,
              invoice_id: creditNote.Allocations?.[0]?.Invoice?.InvoiceID || null,
              invoice_number: creditNote.Allocations?.[0]?.Invoice?.InvoiceNumber || null,
              contact_id: creditNote.Contact?.ContactID || null,
              contact_name: creditNote.Contact?.Name || null,
              status: creditNote.Status || null,
              updated_date_utc: creditNote.UpdatedDateUTC ? new Date(creditNote.UpdatedDateUTC).toISOString() : null,
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "organization_id,platform_integration_organization_id,credit_note_id",
              ignoreDuplicates: false,
            }
          )
          .select("id")
          .single();

        if (creditNoteError) {
          console.error("Error upserting credit note:", creditNoteError);
          continue;
        }

        const creditNoteUuid = insertedCreditNote?.id;

        // Upsert allocations
        if (creditNote.Allocations && creditNote.Allocations.length > 0 && creditNoteUuid) {
          const allocationsToUpsert = creditNote.Allocations.map((allocation) => ({
            organization_id: organizationId,
            platform_integration_id: platformIntegrationId,
            platform_integration_organization_id: platformIntegrationOrgId,
            credit_note_id: creditNoteUuid,
              platform_credit_note_id: creditNoteId,
            allocation_id: allocation.AllocationID || null,
            allocation_amount: allocation.Amount || 0,
            allocation_date: allocation.Date ? new Date(allocation.Date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
            invoice_id: allocation.Invoice?.InvoiceID || null,
            invoice_number: allocation.Invoice?.InvoiceNumber || null,
            updated_at: new Date().toISOString(),
          }));

          await supabase.from("platform_credit_note_allocations").upsert(allocationsToUpsert, {
            onConflict: "organization_id,platform_integration_organization_id,platform_credit_note_id,allocation_id",
            ignoreDuplicates: false,
          });
        }

        // Upsert payments
        if (creditNote.Payments && creditNote.Payments.length > 0) {
          const paymentsToUpsert = creditNote.Payments.map((payment) => ({
            organization_id: organizationId,
            platform_integration_id: platformIntegrationId,
            platform_integration_organization_id: platformIntegrationOrgId,
            payment_id: payment.PaymentID || null,
            invoice_id: creditNoteId,
            payment_date: payment.Date ? new Date(payment.Date).toISOString().split("T")[0] : null,
            amount: payment.Amount || null,
            reference: payment.Reference || null,
            currency_rate: null,
            transaction_type: "CreditNotePayment",
            updated_at: new Date().toISOString(),
          }));

          await supabase.from("platform_payments").upsert(paymentsToUpsert, {
            onConflict: "organization_id,platform_integration_organization_id,payment_id",
            ignoreDuplicates: false,
          });
        }
      }

      totalSynced += creditNotes.length;
      page++;

      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (true);

    console.log(`Synced ${totalSynced} credit notes`);
    return totalSynced;
  } catch (error) {
    console.error("Error syncing credit notes:", error);
    return 0;
  }
}

/**
 * Sync Journals
 */
async function syncJournals(
  supabase: any,
  accessToken: string,
  realmId: string,
  organizationId: string,
  platformIntegrationId: string,
  platformIntegrationOrgId: string,
  startDate?: string
): Promise<number> {
  try {
    let offset: number | null = null;
    let totalSynced = 0;
    const ifModifiedSince = startDate ? `?IfModifiedSince=${startDate}` : "";

    do {
      const url = offset !== null
        ? `https://api.xero.com/api.xro/2.0/Journals${ifModifiedSince}&offset=${offset}`
        : `https://api.xero.com/api.xro/2.0/Journals${ifModifiedSince}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Xero-tenant-id": realmId,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to fetch journals: ${response.status} - ${errorText}`);
        break;
      }

      const data = await response.json();
      const journals: XeroJournal[] = data.Journals || [];

      if (journals.length === 0) {
        break;
      }

      for (const journal of journals) {
        const journalId = journal.JournalID || "";

        // Determine source type description
        let sourceTypeDesc = "";
        switch (journal.SourceType) {
          case "ACCREC":
            sourceTypeDesc = "Invoice";
            break;
          case "ACCPAY":
            sourceTypeDesc = "Bill";
            break;
          case "ACCRECCREDIT":
            sourceTypeDesc = "CreditNote";
            break;
          case "ACCPAYCREDIT":
            sourceTypeDesc = "BillCreditNote";
            break;
          case "ACCRECPAYMENT":
            sourceTypeDesc = "InvoicePayment";
            break;
          case "ACCPAYPAYMENT":
            sourceTypeDesc = "BillPayment";
            break;
          case "ARCREDITPAYMENT":
            sourceTypeDesc = "CreditNotePayment";
            break;
          case "MANJOURNAL":
            sourceTypeDesc = "ManualJournal";
            break;
          case "CASHREC":
            sourceTypeDesc = "CashReceived";
            break;
          case "CASHPAID":
            sourceTypeDesc = "CashPaid";
            break;
          case "TRANSFER":
            sourceTypeDesc = "Transfer";
            break;
        }

        // Upsert journal
        const { data: insertedJournal, error: journalError } = await supabase
          .from("platform_journals")
          .upsert(
            {
              organization_id: organizationId,
              platform_integration_id: platformIntegrationId,
              platform_integration_organization_id: platformIntegrationOrgId,
              journal_id: journalId,
              journal_number: journal.JournalNumber || 0,
              journal_date: journal.JournalDate ? new Date(journal.JournalDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
              platform_created_date_utc: journal.CreatedDateUTC
                ? new Date(journal.CreatedDateUTC).toISOString()
                : new Date().toISOString(),
              reference: journal.Reference || null,
              source_id: journal.SourceID || null,
              source_type: journal.SourceType || "",
              source_type_desc: sourceTypeDesc,
              total_amount: 0,
              due_amount: 0,
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "organization_id,platform_integration_organization_id,journal_id",
              ignoreDuplicates: false,
            }
          )
          .select("id")
          .single();

        if (journalError) {
          console.error("Error upserting journal:", journalError);
          continue;
        }

        const journalUuid = insertedJournal?.id;

        // Upsert journal details
        if (journal.JournalLines && journal.JournalLines.length > 0 && journalUuid) {
          const journalDetailsToUpsert = journal.JournalLines.map((line) => {
            // Use first non-empty description if current is empty
            const description = line.Description || journal.JournalLines?.find((l) => l.Description)?.Description || null;

            return {
              organization_id: organizationId,
              platform_integration_id: platformIntegrationId,
              platform_integration_organization_id: platformIntegrationOrgId,
              journal_id: journalUuid,
              platform_journal_id: journalId,
              journal_line_id: line.JournalLineID || null,
              source_id: journal.SourceID || null,
              account_id: line.AccountID || null,
              account_code: line.AccountCode || null,
              account_type: line.AccountType || null,
              account_name: line.AccountName || null,
              description: description,
              net_amount: line.NetAmount || null,
              gross_amount: line.GrossAmount || null,
              tax_amount: line.TaxAmount || null,
              tax_type: line.TaxType || null,
              tax_name: line.TaxName || null,
              journal_date: journal.JournalDate
                ? new Date(journal.JournalDate).toISOString().split("T")[0]
                : new Date().toISOString().split("T")[0],
              updated_at: new Date().toISOString(),
            };
          });

          await supabase.from("platform_journal_details").upsert(journalDetailsToUpsert, {
            onConflict: "organization_id,platform_integration_organization_id,platform_journal_id,journal_line_id",
            ignoreDuplicates: false,
          });
        }

        // Update offset for next page
        if (journal.JournalNumber) {
          offset = Math.max(offset || 0, journal.JournalNumber);
        }
      }

      totalSynced += journals.length;

      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (true);

    console.log(`Synced ${totalSynced} journals`);
    return totalSynced;
  } catch (error) {
    console.error("Error syncing journals:", error);
    return 0;
  }
}

/**
 * Sync OverPayments
 */
async function syncOverPayments(
  supabase: any,
  accessToken: string,
  realmId: string,
  organizationId: string,
  platformIntegrationId: string,
  platformIntegrationOrgId: string,
  startDate?: string
): Promise<number> {
  try {
    let page = 1;
    let totalSynced = 0;
    const ifModifiedSince = startDate ? `?IfModifiedSince=${startDate}` : "";

    do {
      const response = await fetch(
        `https://api.xero.com/api.xro/2.0/Overpayments${ifModifiedSince}&page=${page}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Xero-tenant-id": realmId,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to fetch overpayments: ${response.status} - ${errorText}`);
        break;
      }

      const data = await response.json();
      const overpayments: XeroOverpayment[] = data.Overpayments || [];

      if (overpayments.length === 0) {
        break;
      }

      const overpaymentsToUpsert = overpayments.map((overpayment) => ({
        organization_id: organizationId,
        platform_integration_id: platformIntegrationId,
        platform_integration_organization_id: platformIntegrationOrgId,
        overpayment_id: overpayment.OverpaymentID || null,
        account_type: overpayment.Type || null,
        remaining_credit: overpayment.RemainingCredit || 0,
        sub_total: overpayment.SubTotal || 0,
        total_tax: overpayment.TotalTax || 0,
        total: overpayment.Total || 0,
        currency_code: overpayment.CurrencyCode || null,
        contact_id: overpayment.Contact?.ContactID || null,
        contact_name: overpayment.Contact?.Name || null,
        overpayment_date: overpayment.Date ? new Date(overpayment.Date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
        status: overpayment.Status || null,
        line_amount_types: overpayment.LineAmountTypes || null,
        updated_date_utc: overpayment.UpdatedDateUTC
          ? new Date(overpayment.UpdatedDateUTC).toISOString()
          : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      await supabase.from("platform_overpayments").upsert(overpaymentsToUpsert, {
        onConflict: "organization_id,platform_integration_organization_id,overpayment_id",
        ignoreDuplicates: false,
      });

      // Upsert payments for overpayments
      for (const overpayment of overpayments) {
        if (overpayment.Payments && overpayment.Payments.length > 0) {
          const paymentsToUpsert = overpayment.Payments.map((payment) => ({
            organization_id: organizationId,
            platform_integration_id: platformIntegrationId,
            platform_integration_organization_id: platformIntegrationOrgId,
            payment_id: payment.PaymentID || null,
            invoice_id: payment.Invoice?.InvoiceID || overpayment.OverpaymentID || null,
            payment_date: payment.Date ? new Date(payment.Date).toISOString().split("T")[0] : null,
            amount: payment.Amount || null,
            reference: payment.Reference || null,
            currency_rate: payment.CurrencyRate || null,
            transaction_type: "OverPayment",
            updated_at: new Date().toISOString(),
          }));

          await supabase.from("platform_payments").upsert(paymentsToUpsert, {
            onConflict: "organization_id,platform_integration_organization_id,payment_id",
            ignoreDuplicates: false,
          });
        }
      }

      totalSynced += overpayments.length;
      page++;

      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (true);

    console.log(`Synced ${totalSynced} overpayments`);
    return totalSynced;
  } catch (error) {
    console.error("Error syncing overpayments:", error);
    return 0;
  }
}

/**
 * Main sync function - InitialEntitySyncAsync equivalent
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if this is a service role key call (from another Edge Function)
    const token = authHeader.replace("Bearer ", "");
    const isServiceRoleCall = token === supabaseServiceKey || req.headers.get("apikey") === supabaseServiceKey;
    
    let user = null;
    if (!isServiceRoleCall) {
      // Verify the user's JWT for regular user calls
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !authUser) {
        console.error("Auth error:", authError);
        return new Response(
          JSON.stringify({ error: "Invalid authentication" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      user = authUser;
    } else {
      console.log("Service role call detected - skipping user auth check");
    }

    // Get request body
    const body = await req.json();
    const { organizationId, platformIntegrationOrgId, startDate, isNewConnection } = body;

    if (!organizationId || !platformIntegrationOrgId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: organizationId, platformIntegrationOrgId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch platform integration organization and integration
    const { data: platformOrg, error: orgError } = await supabase
      .from("platform_integration_organizations")
      .select("*, platform_integrations(*)")
      .eq("id", platformIntegrationOrgId)
      .eq("organization_id", organizationId)
      .single();

    if (orgError || !platformOrg) {
      console.error("Error fetching platform org:", orgError);
      return new Response(
        JSON.stringify({ error: "Platform integration organization not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const integration = platformOrg.platform_integrations;
    if (!integration) {
      return new Response(
        JSON.stringify({ error: "Platform integration not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get valid access token
    const accessToken = await getValidAccessToken(supabase, integration, platformOrg);
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: "Failed to get valid access token. Please reconnect Xero." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const realmId = platformOrg.platform_org_id;

    // Calculate start date (default: 6 months before current year start, or provided startDate)
    let syncStartDate: string | undefined;
    if (startDate) {
      syncStartDate = startDate;
    } else {
      const now = new Date();
      const currentYearStart = new Date(now.getFullYear(), 0, 1);
      const sixMonthsBefore = new Date(currentYearStart);
      sixMonthsBefore.setMonth(sixMonthsBefore.getMonth() - 6);
      syncStartDate = sixMonthsBefore.toISOString().split("T")[0];
    }

    console.log(`Starting Xero initial sync for org: ${organizationId}, realm: ${realmId}, startDate: ${syncStartDate}`);

    // 1. Sync Accounts (Chart of Accounts)
    console.log("Step 1: Syncing Accounts...");
    const accountsCount = await syncAccounts(
      supabase,
      accessToken,
      realmId,
      organizationId,
      integration.id,
      platformIntegrationOrgId
    );

    // 2. Sync Bank Transactions
    console.log("Step 2: Syncing Bank Transactions...");
    const bankTransactionsCount = await syncBankTransactions(
      supabase,
      accessToken,
      realmId,
      organizationId,
      integration.id,
      platformIntegrationOrgId,
      syncStartDate
    );

    // 3. Sync Invoices
    console.log("Step 3: Syncing Invoices...");
    const invoicesCount = await syncInvoices(
      supabase,
      accessToken,
      realmId,
      organizationId,
      integration.id,
      platformIntegrationOrgId,
      syncStartDate
    );

    // 4. Sync Credit Notes
    console.log("Step 4: Syncing Credit Notes...");
    const creditNotesCount = await syncCreditNotes(
      supabase,
      accessToken,
      realmId,
      organizationId,
      integration.id,
      platformIntegrationOrgId,
      syncStartDate
    );

    // 5. Sync Journals
    console.log("Step 5: Syncing Journals...");
    const journalsCount = await syncJournals(
      supabase,
      accessToken,
      realmId,
      organizationId,
      integration.id,
      platformIntegrationOrgId,
      syncStartDate
    );

    // 6. Sync OverPayments
    console.log("Step 6: Syncing OverPayments...");
    const overpaymentsCount = await syncOverPayments(
      supabase,
      accessToken,
      realmId,
      organizationId,
      integration.id,
      platformIntegrationOrgId,
      syncStartDate
    );

    // Update last_synced_at
    await supabase
      .from("platform_integrations")
      .update({
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", integration.id);

    const summary = {
      success: true,
      message: "Xero entities synced successfully",
      synced: {
        accounts: accountsCount,
        bankTransactions: bankTransactionsCount,
        invoices: invoicesCount,
        creditNotes: creditNotesCount,
        journals: journalsCount,
        overpayments: overpaymentsCount,
      },
      total: accountsCount + bankTransactionsCount + invoicesCount + creditNotesCount + journalsCount + overpaymentsCount,
    };

    console.log("Sync completed:", summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in xero-initial-sync function:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
