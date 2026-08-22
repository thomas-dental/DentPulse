/**
 * useAccountsPayableInvoices Hook
 * Handles invoice upload, extraction via OpenAI, and database operations
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { extractFromPdfOrImage, InvoiceExtractionResult } from '@/services/openAIService';

// ============================================
// TYPES
// ============================================

export interface AccountsPayableInvoice {
  id: string;
  user_id: string | null;
  organization_id: string;
  location_id: string | null;
  folder_id: string | null;
  vendor_name: string | null;
  customer_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total_amount: number | null;
  amount_due: number | null;
  amount: number | null;
  total_no_vat: number | null;
  total_gbp: number | null;
  account: string | null;
  account_number: string | null;
  purchase_order: string | null;
  order_number: string | null;
  patient: string | null;
  date_delivered: string | null;
  payment_due_by: string | null;
  brand_id: string | null;
  vendor_address: string | null;
  vendor_phone: string | null;
  vendor_email: string | null;
  billed_to: string | null;
  charged: number | null;
  customer_reference: string | null;
  supply_address: string | null;
  supply_point_id: string | null;
  previous_balance: number | null;
  payments_received: number | null;
  balance_brought_forward: number | null;
  account_balance: number | null;
  vat_no: string | null;
  pdf_path: string | null;
  invoice_pdf_url: string | null;
  raw_json: any;
  raw_text: string | null;
  status: 'pending_review' | 'pending_approval' | 'approved' | 'paid' | 'exception' | 'rejected' | 'processing';
  confidence_score: number | null;
  is_approved_by_approver: number | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  source: 'email' | 'manual' | null;
  shared_at: string | null;
  paid_at: string | null;
  bank_account_id: string | null;
  platform_status: string | null;
  platform_invoice_id: string | null;
  platform_name: string | null;
  line_items?: AccountsPayableLineItem[];
}

export interface AccountsPayableLineItem {
  id: string;
  accounts_payable_invoice_id: string;
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  tax_amount: number | null;
  line_total: number | null;
  item: string | null;
  location: string | null;
  platform_account_id: string | null; // Reference to chart of accounts
  raw_item_json: any;
  created_at: string;
  updated_at: string;
  // Approval fields
  approval_status: 'pending' | 'approved' | 'rejected' | null;
  approver_id: string | null;
  assigned_at: string | null;
  approver_amount: number | null;
  approver_percentage: number | null;
  approved_at: string | null;
  approval_notes: string | null;
}

export interface InvoiceUploadResult {
  success: boolean;
  invoice?: AccountsPayableInvoice;
  error?: string;
}

// ============================================
// HOOK OPTIONS
// ============================================

interface UseAccountsPayableInvoicesOptions {
  locationId?: string | null; // Filter by location (from global FilterContext)
  startDate?: Date | null; // Filter by start date (from global FilterContext)
  endDate?: Date | null; // Filter by end date (from global FilterContext)
}

// ============================================
// HOOK
// ============================================

export function useAccountsPayableInvoices(options: UseAccountsPayableInvoicesOptions = {}) {
  const { locationId, startDate, endDate } = options;
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  // Get organization ID from profile or user_roles
  useEffect(() => {
    const getOrganizationId = async () => {
      if (profile?.current_organization_id) {
        setOrganizationId(profile.current_organization_id);
        return;
      }

      if (user?.id) {
        const { data: userRole } = await supabase
          .from('user_roles')
          .select('organization_id')
          .eq('user_id', user.id)
          .limit(1)
          .single();

        if (userRole?.organization_id) {
          setOrganizationId(userRole.organization_id);
        }
      }
    };

    getOrganizationId();
  }, [user, profile]);

  // ============================================
  // QUERIES
  // ============================================

  // Format dates for query key
  const startDateStr = startDate ? startDate.toISOString().split('T')[0] : null;
  const endDateStr = endDate ? endDate.toISOString().split('T')[0] : null;

  // Fetch all invoices for the organization (filtered by location and date if selected)
  const {
    data: invoices,
    isLoading: isLoadingInvoices,
    error: invoicesError,
    refetch: refetchInvoices,
  } = useQuery({
    queryKey: ['account-payable-attechments-invoices', organizationId, locationId, startDateStr, endDateStr],
    queryFn: async () => {
      if (!organizationId) return [];

      let query = (supabase as any)
        .from('accounts_payable_invoice')
        .select(`
          *,
          line_items:accounts_payable_invoice_line_item(*)
        `)
        .eq('organization_id', organizationId);

      // Filter by location if selected in global header
      if (locationId) {
        query = query.eq('location_id', locationId);
      }

      // Filter by date range if selected in global header
      // Using created_at for filtering (when invoice was uploaded/created in system)
      if (startDate && endDate) {
        query = query.gte('created_at', startDateStr);
        query = query.lte('created_at', endDateStr);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      // Sort line items by created_at for consistent ordering across modals
      if (data) {
        data.forEach((invoice: any) => {
          if (invoice.line_items) {
            invoice.line_items.sort((a: any, b: any) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          }
        });
      }

      return data as AccountsPayableInvoice[];
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Fetch single invoice by ID
  const fetchInvoiceById = async (invoiceId: string): Promise<AccountsPayableInvoice | null> => {
    const { data, error } = await (supabase as any)
      .from('accounts_payable_invoice')
      .select(`
        *,
        line_items:accounts_payable_invoice_line_item(*)
      `)
      .eq('id', invoiceId)
      .single();

    if (error) {
      console.error('Error fetching invoice:', error);
      return null;
    }

    // Sort line items by created_at for consistent ordering across modals
    if (data?.line_items) {
      data.line_items.sort((a: any, b: any) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    }

    return data;
  };

  // ============================================
  // MUTATIONS
  // ============================================

  // Upload PDF to Supabase Storage
  const uploadPdfToStorage = async (file: File, orgId: string): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${orgId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `invoices/${fileName}`;

    console.log('[PDF Upload] Starting upload:', { filePath, fileSize: file.size, fileType: file.type });

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('account-payable-attechments')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('[PDF Upload] Storage upload error:', uploadError);
      // Continue without storage - PDF path will be null
      return '';
    }

    console.log('[PDF Upload] Upload successful:', uploadData);

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('account-payable-attechments')
      .getPublicUrl(filePath);

    console.log('[PDF Upload] Public URL:', urlData?.publicUrl);

    return urlData?.publicUrl || filePath;
  };

  // Validate that a chart of account exists in the database
  const validateChartOfAccount = async (coaId: string | null): Promise<string | null> => {
    if (!coaId) return null;

    const { data: coaExists } = await (supabase as any)
      .from('platform_integration_chart_of_accounts')
      .select('id')
      .eq('id', coaId)
      .maybeSingle();

    if (coaExists) {
      return coaId;
    }

    console.warn('[Invoice Rules] Chart of account does not exist:', coaId);
    return null;
  };

  // Check for matching rule based on vendor email
  const findMatchingRule = async (vendorEmail: string | null, vendorName: string | null): Promise<{
    folderId: string | null;
    chartOfAccountId: string | null;
  } | null> => {
    if (!organizationId) return null;

    // Try to match by email first
    if (vendorEmail) {
      const { data: ruleByEmail } = await (supabase as any)
        .from('accounts_payable_invoice_rules_mapping')
        .select('folder_id, chart_of_account_id')
        .eq('organization_id', organizationId)
        .eq('email', vendorEmail)
        .eq('is_active', true)
        .maybeSingle();

      if (ruleByEmail) {
        console.log('[Invoice Rules] Found rule by email:', vendorEmail, ruleByEmail);
        // Validate COA exists before returning
        const validatedCoaId = await validateChartOfAccount(ruleByEmail.chart_of_account_id);
        return {
          folderId: ruleByEmail.folder_id,
          chartOfAccountId: validatedCoaId,
        };
      }
    }

    // Try to match by vendor name (partial match)
    if (vendorName) {
      const { data: ruleByName } = await (supabase as any)
        .from('accounts_payable_invoice_rules_mapping')
        .select('folder_id, chart_of_account_id, email')
        .eq('organization_id', organizationId)
        .eq('is_active', true);

      // Check if any rule's email contains the vendor name or vice versa
      const matchingRule = (ruleByName || []).find((rule: any) => {
        const ruleEmail = rule.email?.toLowerCase() || '';
        const name = vendorName.toLowerCase();
        return ruleEmail.includes(name) || name.includes(ruleEmail.split('@')[0]);
      });

      if (matchingRule) {
        console.log('[Invoice Rules] Found rule by vendor name:', vendorName, matchingRule);
        // Validate COA exists before returning
        const validatedCoaId = await validateChartOfAccount(matchingRule.chart_of_account_id);
        return {
          folderId: matchingRule.folder_id,
          chartOfAccountId: validatedCoaId,
        };
      }
    }

    return null;
  };

  // Process and save invoice
  const processAndSaveInvoice = async (
    file: File,
    extractionResult: InvoiceExtractionResult
  ): Promise<AccountsPayableInvoice> => {
    if (!organizationId) {
      throw new Error('Organization ID is required');
    }

    const { parsed, raw_text, confidence_scores } = extractionResult;

    // Upload PDF to storage (optional - continues if fails)
    let pdfPath = '';
    try {
      console.log('[Invoice] Uploading PDF to storage...');
      pdfPath = await uploadPdfToStorage(file, organizationId);
      console.log('[Invoice] PDF upload result:', pdfPath ? 'SUCCESS' : 'FAILED', pdfPath);
    } catch (err) {
      console.warn('[Invoice] PDF upload to storage failed, continuing without storage:', err);
    }

    // Check for matching rule to auto-assign folder and COA
    const matchedRule = await findMatchingRule(
      parsed.vendor_email || parsed.supplier_email || null,
      parsed.vendor_name || parsed.supplier_name || null
    );
    console.log('[Invoice Rules] Matched rule:', matchedRule);

    // Calculate overall confidence score
    const overallConfidence = confidence_scores?.overall ||
      Math.round(
        Object.values(parsed.confidence_scores || {})
          .filter((v): v is number => typeof v === 'number')
          .reduce((sum, val, _, arr) => sum + val / arr.length, 0)
      ) || 0;

    // Prepare invoice data (includes location_id from global filter)
    const invoiceData = {
      organization_id: organizationId,
      user_id: user?.id || null,
      location_id: locationId || null, // Save current selected location from header filter
      folder_id: matchedRule?.folderId || null,
      vendor_name: parsed.vendor_name || null,
      customer_name: parsed.customer_name || null,
      invoice_number: parsed.invoice_number || null,
      invoice_date: parsed.invoice_date || null,
      due_date: parsed.due_date || null,
      currency: parsed.currency || 'GBP',
      subtotal: parsed.subtotal || null,
      tax: parsed.tax || null,
      total_amount: parsed.total_amount || null,
      amount_due: parsed.amount_due || null,
      amount: parsed.amount || null,
      total_no_vat: parsed.total_no_vat || null,
      total_gbp: parsed.total_gbp || null,
      account: parsed.account || null,
      account_number: parsed.account_number || null,
      purchase_order: parsed.purchase_order || null,
      order_number: parsed.order_number || null,
      patient: parsed.patient || null,
      date_delivered: parsed.date_delivered || null,
      payment_due_by: parsed.payment_due_by || null,
      brand_id: parsed.brand_id || null,
      vendor_address: parsed.vendor_address || null,
      vendor_phone: parsed.vendor_phone || null,
      vendor_email: parsed.vendor_email || null,
      billed_to: parsed.billed_to || null,
      charged: typeof parsed.charged === 'boolean' ? (parsed.charged ? 1 : 0) : null,
      customer_reference: parsed.customer_reference || null,
      supply_address: parsed.supply_address || null,
      supply_point_id: parsed.supply_point_id || null,
      previous_balance: parsed.previous_balance || null,
      payments_received: parsed.payments_received || null,
      balance_brought_forward: parsed.balance_brought_forward || null,
      account_balance: parsed.account_balance || null,
      vat_no: parsed.vat_no || null,
      pdf_path: pdfPath || null,
      raw_json: parsed,
      raw_text: raw_text || null,
      status: 'pending_review' as const,
      confidence_score: overallConfidence,
      created_by: user?.id || null,
      source: 'manual' as const, // Mark as manually uploaded
    };

    // Insert invoice
    const { data: insertedInvoice, error: insertError } = await (supabase as any)
      .from('accounts_payable_invoice')
      .insert(invoiceData)
      .select()
      .single();

    if (insertError) {
      console.error('Invoice insert error:', insertError);
      throw new Error(`Failed to save invoice: ${insertError.message}`);
    }

    // Insert line items if present
    if (parsed.items && parsed.items.length > 0) {
      const lineItemsData = parsed.items.map((item) => ({
        accounts_payable_invoice_id: insertedInvoice.id,
        description: item.description || null,
        quantity: item.quantity || null,
        unit_price: item.unit_price || null,
        line_total: item.line_total || null,
        item: item.item || null,
        location: item.location || null,
        platform_account_id: matchedRule?.chartOfAccountId || null, // Apply COA from rule
        raw_item_json: item,
        created_by: user?.id || null,
      }));

      const { error: lineItemsError } = await (supabase as any)
        .from('accounts_payable_invoice_line_item')
        .insert(lineItemsData);

      if (lineItemsError) {
        console.error('Line items insert error:', lineItemsError);
        // Don't throw - invoice was saved successfully
      }
    }

    return insertedInvoice;
  };

  // Main upload mutation - uses FRONTEND extraction (no backend API)
  // PDF → openAIService.ts → GPT-4o Vision → extract data → save to Supabase
  const uploadInvoiceMutation = useMutation({
    mutationFn: async (file: File): Promise<InvoiceUploadResult> => {
      try {
        console.log('[Invoice Upload] Starting frontend extraction:', file.name);

        // Step 1: Extract invoice data using OpenAI (frontend service)
        const extractionResult: InvoiceExtractionResult = await extractFromPdfOrImage(file);
        console.log('[Invoice Upload] Extraction complete:', {
          vendor: extractionResult.parsed.vendor_name,
          invoiceNumber: extractionResult.parsed.invoice_number,
          total: extractionResult.parsed.total_amount,
          itemsCount: extractionResult.parsed.items?.length || 0,
        });

        const extracted = extractionResult.parsed;
        const rawText = extractionResult.raw_text;

        // Calculate confidence score
        const confidenceScores = extracted.confidence_scores || {};
        const scores = Object.values(confidenceScores).filter((v): v is number => typeof v === 'number');
        const overallConfidence = scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0;

        // Step 2: Upload PDF to backend server (AP-Invoices folder)
        console.log('[Invoice Upload] Uploading PDF to backend server...');
        let pdfPath: string | null = null;
        try {
          const formData = new FormData();
          formData.append('file', file);

          const storePdfResponse = await fetch('https://dent-enterprise-api.dentpulse.com/api/inbound-email-webhook/store-pdf', {
            method: 'POST',
            body: formData,
          });

          if (storePdfResponse.ok) {
            const storePdfResult = await storePdfResponse.json();
            if (storePdfResult.status === 'success') {
              pdfPath = storePdfResult.pdfPath;
              console.log('[Invoice Upload] PDF stored on backend:', pdfPath);
            }
          } else {
            console.warn('[Invoice Upload] Failed to store PDF on backend, continuing without PDF path');
          }
        } catch (pdfUploadError) {
          console.warn('[Invoice Upload] PDF upload error, continuing without PDF path:', pdfUploadError);
        }

        // Step 3: Create invoice record in Supabase
        console.log('[Invoice Upload] Creating invoice in database...');
        const { data: invoice, error: invoiceError } = await (supabase as any)
          .from('accounts_payable_invoice')
          .insert({
            organization_id: organizationId || null,
            user_id: user?.id || null,
            location_id: locationId || null,
            vendor_name: extracted.vendor_name || 'Unknown Supplier',
            customer_name: extracted.customer_name || null,
            invoice_number: extracted.invoice_number || null,
            invoice_date: extracted.invoice_date || null,
            due_date: extracted.due_date || null,
            currency: extracted.currency || 'GBP',
            subtotal: extracted.subtotal || null,
            tax: extracted.tax || null,
            total_amount: extracted.total_amount || null,
            account: extracted.account || null,
            purchase_order: extracted.purchase_order || null,
            amount_due: extracted.amount_due || null,
            account_number: extracted.account_number || null,
            order_number: extracted.order_number || null,
            patient: extracted.patient || null,
            date_delivered: extracted.date_delivered || null,
            payment_due_by: extracted.payment_due_by || null,
            amount: extracted.amount || null,
            total_no_vat: extracted.total_no_vat || null,
            total_gbp: extracted.total_gbp || null,
            brand_id: extracted.brand_id || null,
            vendor_address: extracted.vendor_address || null,
            vendor_phone: extracted.vendor_phone || null,
            vendor_email: extracted.vendor_email || null,
            billed_to: extracted.billed_to || null,
            charged: typeof extracted.charged === 'boolean' ? (extracted.charged ? 1 : 0) : null,
            customer_reference: extracted.customer_reference || null,
            supply_address: extracted.supply_address || null,
            supply_point_id: extracted.supply_point_id || null,
            previous_balance: extracted.previous_balance || null,
            payments_received: extracted.payments_received || null,
            balance_brought_forward: extracted.balance_brought_forward || null,
            account_balance: extracted.account_balance || null,
            vat_no: extracted.vat_no || null,
            pdf_path: pdfPath,
            raw_json: extracted || null,
            raw_text: rawText || null,
            confidence_score: overallConfidence,
            status: 'pending_review',
            source: 'manual',
            created_by: user?.id ? String(user.id) : null,
          })
          .select()
          .single();

        if (invoiceError) {
          console.error('[Invoice Upload] Failed to create invoice:', invoiceError);
          throw new Error(`Failed to create invoice: ${invoiceError.message}`);
        }

        console.log('[Invoice Upload] Invoice created:', invoice.id);

        // Step 4: Insert line items if present
        if (extracted.items && extracted.items.length > 0) {
          const lineItemsData = extracted.items.map((item) => ({
            accounts_payable_invoice_id: invoice.id,
            description: item.description || null,
            quantity: item.quantity || null,
            unit_price: item.unit_price || null,
            line_total: item.line_total || null,
            item: item.item || null,
            location: item.location || null,
            raw_item_json: item,
            created_by: user?.id ? String(user.id) : null,
          }));

          const { error: lineItemsError } = await (supabase as any)
            .from('accounts_payable_invoice_line_item')
            .insert(lineItemsData);

          if (lineItemsError) {
            console.error('[Invoice Upload] Error inserting line items:', lineItemsError);
          } else {
            console.log('[Invoice Upload] Line items saved:', lineItemsData.length);
          }
        }

        // Fetch the full invoice with line items
        const { data: fullInvoice, error: fetchError } = await (supabase as any)
          .from('accounts_payable_invoice')
          .select(`
            *,
            line_items:accounts_payable_invoice_line_item(*)
          `)
          .eq('id', invoice.id)
          .single();

        if (fetchError) throw fetchError;

        // Sort line items by created_at for consistent ordering across modals
        if (fullInvoice?.line_items) {
          fullInvoice.line_items.sort((a: any, b: any) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        }

        return { success: true, invoice: fullInvoice };
      } catch (error: any) {
        console.error('[Invoice Upload] Error:', error);
        return { success: false, error: error.message };
      }
    },
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['account-payable-attechments-invoices'] });
      }
    },
  });

  // Upload multiple files
  const uploadMultipleInvoices = async (files: File[]): Promise<InvoiceUploadResult[]> => {
    const results: InvoiceUploadResult[] = [];

    for (const file of files) {
      const result = await uploadInvoiceMutation.mutateAsync(file);
      results.push(result);
    }

    return results;
  };

  // Update invoice status
  const updateInvoiceStatusMutation = useMutation({
    mutationFn: async ({
      invoiceId,
      status,
    }: {
      invoiceId: string;
      status: AccountsPayableInvoice['status'];
    }) => {
      const { data, error } = await (supabase as any)
        .from('accounts_payable_invoice')
        .update({
          status,
          updated_by: user?.id || null,
        })
        .eq('id', invoiceId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-payable-attechments-invoices'] });
    },
  });

  // Update invoice data (after manual review/edit)
  const updateInvoiceMutation = useMutation({
    mutationFn: async ({
      invoiceId,
      updates,
    }: {
      invoiceId: string;
      updates: Partial<AccountsPayableInvoice>;
    }) => {
      const { data, error } = await (supabase as any)
        .from('accounts_payable_invoice')
        .update({
          ...updates,
          updated_by: user?.id || null,
        })
        .eq('id', invoiceId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-payable-attechments-invoices'] });
    },
  });

  // Delete invoice
  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      // Line items will be deleted automatically due to CASCADE
      const { error } = await (supabase as any)
        .from('accounts_payable_invoice')
        .delete()
        .eq('id', invoiceId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-payable-attechments-invoices'] });
    },
  });

  // ============================================
  // RETURN
  // ============================================

  return {
    // Data
    invoices: invoices || [],
    isLoading: isLoadingInvoices,
    error: invoicesError,
    organizationId,

    // Queries
    fetchInvoiceById,
    refetchInvoices,

    // Mutations
    uploadInvoice: uploadInvoiceMutation.mutateAsync,
    uploadMultipleInvoices,
    updateInvoiceStatus: updateInvoiceStatusMutation.mutateAsync,
    updateInvoice: updateInvoiceMutation.mutateAsync,
    deleteInvoice: deleteInvoiceMutation.mutateAsync,

    // Mutation states
    isUploading: uploadInvoiceMutation.isPending,
    isUpdating: updateInvoiceStatusMutation.isPending || updateInvoiceMutation.isPending,
    isDeleting: deleteInvoiceMutation.isPending,
    uploadError: uploadInvoiceMutation.error,
  };
}
