/**
 * Sync Summary Page
 * Top-level accordion per connected integration (Dentally / Iplicit).
 * Each integration expands to show its timestamp-grouped sync job records.
 */

import { Fragment, useEffect, useState } from 'react';
import {
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  RefreshCw,
  X,
  FileText,
  Database,
  Calendar,
  Users,
  CreditCard,
  Stethoscope,
  MapPin,
  Clipboard,
  ClipboardList,
  CalendarCheck,
  FolderSync,
  FileCheck,
  Activity,
  Building2,
  Building,
  Package,
  ArrowLeftRight,
  TrendingUp,
  LayoutGrid,
  Table2,
  ChevronDown,
  ChevronRight,
  Wallet,
  Tags,
} from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuth } from '@/hooks/useAuth';
import { useAutoTriggerSync } from '@/hooks/useAutoTriggerSync';
import { SyncJobService, SyncJob, IPLICIT_ENTITY_ALIASES, XERO_ENTITY_ALIASES, QUICKBOOKS_ENTITY_ALIASES } from '@/services/integrations/syncJobService';
import { INTEGRATION_LOGOS } from '@/lib/integrationLogos';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Play } from 'lucide-react';

export function SyncSummary() {
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  const [syncJobs, setSyncJobs]             = useState<SyncJob[]>([]);
  const [isLoading, setIsLoading]           = useState(true);
  const [isRefreshing, setIsRefreshing]     = useState(false);
  const [resumingJobs, setResumingJobs]     = useState<Set<string>>(new Set());
  const [dentallyConnected, setDentallyConnected] = useState(false);
  const [iplicitConnected,  setIplicitConnected]  = useState(false);
  const [xeroConnected,     setXeroConnected]     = useState(false);
  const [quickbooksConnected, setQuickbooksConnected] = useState(false);
  const [dentallyAccounts,  setDentallyAccounts]  = useState<Record<string, string>>({});
  const [isStartingSync, setIsStartingSync]       = useState(false);
  const [viewMode, setViewMode]                   = useState<'table' | 'block'>('table');
  const [expandedGroups, setExpandedGroups]       = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  useAutoTriggerSync();

  // ── Fetch jobs ────────────────────────────────────────────────────────────────

  const fetchSyncJobs = async (showRefreshLoader = false) => {
    if (!organizationId) return;
    if (showRefreshLoader) setIsRefreshing(true);
    try {
      const jobs = await SyncJobService.getSyncJobs(organizationId, 500);
      setSyncJobs(jobs);
    } catch (err) {
      console.error('Error fetching sync jobs:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // ── Check which integrations are connected ────────────────────────────────────

  const checkConnections = async () => {
    if (!organizationId) return;

    // Dentally: fetch all integrations for this org so we can label each sync by account
    const { data: dentally } = await supabase
      .from('integrations')
      .select('id, integration_description, api_key')
      .eq('organization_id', organizationId)
      .eq('integration_name', 'Dentally')
      .is('deleted_at', null);
    setDentallyConnected(!!(dentally && dentally.length > 0));
    const accountMap: Record<string, string> = {};
    (dentally || []).forEach((int: any) => {
      const desc = int.integration_description;
      const isCustomLabel = desc && desc !== 'Cloud-based dental practice management software';
      accountMap[int.id] = isCustomLabel
        ? desc
        : int.api_key ? `${int.api_key.substring(0, 8)}…` : 'Dentally';
    });
    setDentallyAccounts(accountMap);

    // Iplicit: row in platform_integrations with credentials
    const { data: iplicit } = await supabase
      .from('platform_integrations')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('platform_name', 'iplicit')
      .not('client_secret', 'is', null)
      .maybeSingle();
    setIplicitConnected(!!iplicit);

    // Xero: one or more rows in platform_integrations with access_token and is_connected.
    // Use limit(1) instead of maybeSingle() because an org can have multiple Xero
    // integrations (one per tenant) and maybeSingle returns null when >1 matches.
    const { data: xero } = await supabase
      .from('platform_integrations')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('platform_name', 'xero')
      .eq('is_connected', true)
      .not('access_token', 'is', null)
      .limit(1);
    setXeroConnected(Array.isArray(xero) && xero.length > 0);

    // QuickBooks: same shape as Xero (OAuth tokens on platform_integrations).
    const { data: quickbooks } = await supabase
      .from('platform_integrations')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('platform_name', 'quickbooks')
      .eq('is_connected', true)
      .not('access_token', 'is', null)
      .limit(1);
    setQuickbooksConnected(Array.isArray(quickbooks) && quickbooks.length > 0);
  };

  useEffect(() => {
    fetchSyncJobs();
    checkConnections();
    const interval = setInterval(() => fetchSyncJobs(), 5000);
    return () => clearInterval(interval);
  }, [organizationId]);

  // ── Actions ───────────────────────────────────────────────────────────────────

  const handleCancelJob = async (jobId: string) => {
    try {
      const success = await SyncJobService.cancelSyncJob(jobId);
      if (success) {
        toast.success('Sync job cancelled successfully');
        setTimeout(() => fetchSyncJobs(), 500);
      } else {
        toast.error('Failed to cancel sync job');
      }
    } catch (err) {
      console.error('Error cancelling job:', err);
      toast.error('Error cancelling sync job');
    }
  };

  const handleResumeJob = async (job: SyncJob) => {
    if (!organizationId || !user) {
      toast.error('Unable to resume sync', { description: 'Organization or user not found' });
      return;
    }
    if (!job.entity_alias) {
      toast.error('Unable to resume sync', { description: 'Entity information not found' });
      return;
    }

    setResumingJobs(prev => new Set(prev).add(job.id));

    try {
      if (XERO_ENTITY_ALIASES.has(job.entity_alias)) {
        // ── Xero: single-call, no date range ───────────────────────────────
        const result = await SyncJobService.syncXeroEntity(organizationId, job.entity_alias);
        if (result.success) {
          toast.success(`${formatEntityName(job.entity_alias)} sync resumed!`, { description: 'Sync job has been re-queued' });
          setTimeout(() => fetchSyncJobs(), 1000);
        } else {
          toast.error('Failed to resume sync', { description: result.error || 'Unknown error occurred' });
        }
      } else if (QUICKBOOKS_ENTITY_ALIASES.has(job.entity_alias)) {
        // ── QuickBooks: single-call, no date range ──────────────────────────
        const result = await SyncJobService.syncQuickBooksEntity(organizationId, job.entity_alias);
        if (result.success) {
          toast.success(`${formatEntityName(job.entity_alias)} sync resumed!`, { description: 'Sync job has been re-queued' });
          setTimeout(() => fetchSyncJobs(), 1000);
        } else {
          toast.error('Failed to resume sync', { description: result.error || 'Unknown error occurred' });
        }
      } else if (IPLICIT_ENTITY_ALIASES.has(job.entity_alias)) {
        // ── Iplicit: single-call, no date range / pagination ────────────────
        const result = await SyncJobService.syncIplicitEntity(organizationId, job.entity_alias);
        if (result.success) {
          toast.success(`${formatEntityName(job.entity_alias)} sync resumed!`, {
            description: 'Sync job has been re-queued',
          });
          setTimeout(() => fetchSyncJobs(), 1000);
        } else {
          toast.error('Failed to resume sync', { description: result.error || 'Unknown error occurred' });
        }
      } else {
        // ── Dentally: paginated with date range ─────────────────────────────
        const startDate  = job.start_date || new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
        const endDate    = job.end_date   || new Date().toISOString();
        const resumePage = job.current_page > 0 ? job.current_page : 1;

        console.log(`[Resume Sync] Resuming ${job.entity_alias} from page ${resumePage}`);

        const result = await SyncJobService.syncEntity(
          organizationId, job.integration_id, job.entity_alias,
          startDate, endDate, user.id, resumePage
        );
        if (result.success) {
          toast.success(`${formatEntityName(job.entity_alias)} sync resumed!`, {
            description: `Continuing from page ${resumePage}`,
          });
          setTimeout(() => fetchSyncJobs(), 1000);
        } else {
          toast.error('Failed to resume sync', { description: result.error || 'Unknown error occurred' });
        }
      }
    } catch (err: any) {
      console.error('Resume sync error:', err);
      toast.error('Failed to resume sync', { description: err.message || 'Unknown error occurred' });
    } finally {
      setResumingJobs(prev => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  };

  const handleStartDentallySync = async () => {
    if (!organizationId) return;
    setIsStartingSync(true);
    try {
      const result = await SyncJobService.forceFullSync(organizationId);
      if (result.success) {
        toast.success(`Sync started! Created ${result.jobIds.length} sync jobs.`);
        setTimeout(() => fetchSyncJobs(), 1000);
      } else {
        toast.error('Failed to start sync', { description: result.errors[0] || 'Unknown error' });
      }
    } catch (err: any) {
      console.error('Start sync error:', err);
      toast.error('Failed to start sync', { description: err.message || 'Unknown error' });
    } finally {
      setIsStartingSync(false);
    }
  };

  // ── Display helpers ───────────────────────────────────────────────────────────

  const formatEntityName = (alias: string | null): string => {
    if (!alias) return 'Data';
    const nameMap: Record<string, string> = {
      appointments:              'Appointments',
      practitioners:             'Practitioners',
      payment_plans:             'Payment Plans',
      treatment_plans:           'Treatment Plans',
      treatment_plan_items:      'Treatment Plan Items',
      treatment_appointments:    'Treatment Appointments',
      sundries:                  'Sundries',
      treatments:                'Treatments',
      treatment_category:        'Treatment Categories',
      locations:                 'Locations',
      patients:                  'Patients',
      nhs_claims:                'NHS Claims',
      invoices:                  'Invoices',
      accounts:                  'Accounts',
      appointment_cancellation_reasons: 'Appointment Cancellation Reasons',
      iplicit_legal_entities:    'Legal Entities',
      coa_account_groups:        'COA Account Groups',
      iplicit_chart_of_accounts: 'Chart of Accounts',
      iplicit_balance_sheet:     'Balance Sheet',
      iplicit_profit_loss:       'Profit & Loss',
      iplicit_suppliers:         'Suppliers',
      iplicit_products:          'Products',
      iplicit_sales_invoices:    'Sales Invoices',
      iplicit_sales_receipts:              'Sales Receipts',
      iplicit_receipt_allocations:         'Receipt Allocations',
      iplicit_purchase_invoices:           'Purchase Invoices',
      iplicit_purchase_invoice_payments:   'Purchase Invoice Payments',
      iplicit_payment_allocations:         'Payment Allocations',
      xero_chart_of_accounts:    'Chart of Accounts',
      xero_tracking_categories:  'Tracking categories',
      xero_invoices:             'Invoices',
      xero_bank_transactions:    'Bank Transactions',
      xero_credit_notes:         'Credit Notes',
      xero_overpayments:         'Overpayments',
      xero_journals:             'Journals',
      xero_profit_loss:          'Profit & Loss',
      xero_balance_sheet:        'Balance Sheet',
      quickbooks_chart_of_accounts: 'Chart of Accounts',
      quickbooks_vendors:           'Vendors',
      quickbooks_customers:         'Customers',
      quickbooks_items:             'Items',
      quickbooks_invoices:          'Invoices',
      quickbooks_bills:             'Bills',
      quickbooks_journal_entries:   'Journal Entries',
      quickbooks_purchases:         'Purchases',
      quickbooks_payments:          'Payments',
      quickbooks_bill_payments:     'Bill Payments',
      quickbooks_credit_memos:      'Credit Memos',
      quickbooks_vendor_credits:    'Vendor Credits',
      quickbooks_deposits:          'Deposits',
      quickbooks_transfers:         'Transfers',
      quickbooks_profit_loss:       'Profit & Loss',
    };
    return nameMap[alias] || alias;
  };

  const getEntityIcon = (alias: string | null) => {
    const cls = 'w-5 h-5';
    switch (alias) {
      case 'appointments':           return { icon: <Calendar      className={`${cls} text-blue-600`}   />, iconBg: 'bg-blue-500/20'   };
      case 'patients':               return { icon: <Users         className={`${cls} text-green-600`}  />, iconBg: 'bg-green-500/20'  };
      case 'payment_plans':          return { icon: <CreditCard    className={`${cls} text-purple-600`} />, iconBg: 'bg-purple-500/20' };
      case 'treatment_plans':        return { icon: <FileText      className={`${cls} text-orange-600`} />, iconBg: 'bg-orange-500/20' };
      case 'treatment_plan_items':   return { icon: <ClipboardList className={`${cls} text-amber-600`}  />, iconBg: 'bg-amber-500/20'  };
      case 'treatment_appointments': return { icon: <CalendarCheck className={`${cls} text-cyan-600`}   />, iconBg: 'bg-cyan-500/20'   };
      case 'sundries':                return { icon: <Package       className={`${cls} text-lime-600`}   />, iconBg: 'bg-lime-500/20'   };
      case 'treatments':             return { icon: <Stethoscope   className={`${cls} text-pink-600`}   />, iconBg: 'bg-pink-500/20'   };
      case 'practitioners':          return { icon: <Users         className={`${cls} text-indigo-600`} />, iconBg: 'bg-indigo-500/20' };
      case 'locations':              return { icon: <MapPin        className={`${cls} text-red-600`}    />, iconBg: 'bg-red-500/20'    };
      case 'treatment_category':     return { icon: <Clipboard     className={`${cls} text-teal-600`}   />, iconBg: 'bg-teal-500/20'   };
      case 'nhs_claims':             return { icon: <FileCheck     className={`${cls} text-emerald-600`}/>, iconBg: 'bg-emerald-500/20' };
      case 'accounts':               return { icon: <Wallet        className={`${cls} text-yellow-600`} />, iconBg: 'bg-yellow-500/20' };
      case 'iplicit_legal_entities':    return { icon: <Building2   className={`${cls} text-sky-600`}     />, iconBg: 'bg-sky-500/20'     };
      case 'coa_account_groups':        return { icon: <FolderSync  className={`${cls} text-violet-600`}  />, iconBg: 'bg-violet-500/20'  };
      case 'iplicit_chart_of_accounts': return { icon: <Database    className={`${cls} text-indigo-600`}  />, iconBg: 'bg-indigo-500/20'  };
      case 'iplicit_balance_sheet':     return { icon: <FileText    className={`${cls} text-emerald-600`} />, iconBg: 'bg-emerald-500/20' };
      case 'iplicit_profit_loss':       return { icon: <Activity    className={`${cls} text-orange-600`}  />, iconBg: 'bg-orange-500/20'  };
      case 'iplicit_suppliers':         return { icon: <Building    className={`${cls} text-violet-600`}  />, iconBg: 'bg-violet-500/20'  };
      case 'iplicit_products':          return { icon: <Package     className={`${cls} text-teal-600`}    />, iconBg: 'bg-teal-500/20'    };
      case 'iplicit_sales_invoices':    return { icon: <FileText    className={`${cls} text-blue-600`}    />, iconBg: 'bg-blue-500/20'    };
      case 'iplicit_sales_receipts':    return { icon: <FileCheck   className={`${cls} text-green-600`}   />, iconBg: 'bg-green-500/20'   };
      case 'iplicit_receipt_allocations':        return { icon: <Clipboard     className={`${cls} text-indigo-600`} />, iconBg: 'bg-indigo-500/20' };
      case 'iplicit_purchase_invoices':          return { icon: <ClipboardList className={`${cls} text-amber-600`}  />, iconBg: 'bg-amber-500/20'  };
      case 'iplicit_purchase_invoice_payments':  return { icon: <CreditCard    className={`${cls} text-purple-600`} />, iconBg: 'bg-purple-500/20' };
      case 'iplicit_payment_allocations':        return { icon: <ArrowLeftRight className={`${cls} text-rose-600`}   />, iconBg: 'bg-rose-500/20'   };
      case 'xero_chart_of_accounts':    return { icon: <Database       className={`${cls} text-[#13B5EA]`}   />, iconBg: 'bg-[rgba(19,181,234,0.15)]' };
      case 'xero_tracking_categories':  return { icon: <Tags           className={`${cls} text-[#13B5EA]`}   />, iconBg: 'bg-[rgba(19,181,234,0.15)]' };
      case 'xero_invoices':             return { icon: <FileText       className={`${cls} text-[#13B5EA]`}   />, iconBg: 'bg-[rgba(19,181,234,0.15)]' };
      case 'xero_bank_transactions':    return { icon: <Building       className={`${cls} text-[#13B5EA]`}   />, iconBg: 'bg-[rgba(19,181,234,0.15)]' };
      case 'xero_credit_notes':         return { icon: <FileCheck      className={`${cls} text-[#13B5EA]`}   />, iconBg: 'bg-[rgba(19,181,234,0.15)]' };
      case 'xero_overpayments':         return { icon: <ArrowLeftRight className={`${cls} text-[#13B5EA]`}   />, iconBg: 'bg-[rgba(19,181,234,0.15)]' };
      case 'xero_journals':             return { icon: <ClipboardList  className={`${cls} text-[#13B5EA]`}   />, iconBg: 'bg-[rgba(19,181,234,0.15)]' };
      case 'xero_profit_loss':          return { icon: <TrendingUp     className={`${cls} text-[#13B5EA]`}   />, iconBg: 'bg-[rgba(19,181,234,0.15)]' };
      case 'xero_balance_sheet':        return { icon: <FileText       className={`${cls} text-[#13B5EA]`}   />, iconBg: 'bg-[rgba(19,181,234,0.15)]' };
      case 'quickbooks_chart_of_accounts': return { icon: <Database       className={`${cls} text-[#2CA01C]`} />, iconBg: 'bg-[rgba(44,160,28,0.15)]' };
      case 'quickbooks_vendors':           return { icon: <Building       className={`${cls} text-[#2CA01C]`} />, iconBg: 'bg-[rgba(44,160,28,0.15)]' };
      case 'quickbooks_customers':         return { icon: <Users          className={`${cls} text-[#2CA01C]`} />, iconBg: 'bg-[rgba(44,160,28,0.15)]' };
      case 'quickbooks_items':             return { icon: <Package        className={`${cls} text-[#2CA01C]`} />, iconBg: 'bg-[rgba(44,160,28,0.15)]' };
      case 'quickbooks_invoices':          return { icon: <FileText       className={`${cls} text-[#2CA01C]`} />, iconBg: 'bg-[rgba(44,160,28,0.15)]' };
      case 'quickbooks_bills':             return { icon: <FileCheck      className={`${cls} text-[#2CA01C]`} />, iconBg: 'bg-[rgba(44,160,28,0.15)]' };
      case 'quickbooks_journal_entries':   return { icon: <ClipboardList  className={`${cls} text-[#2CA01C]`} />, iconBg: 'bg-[rgba(44,160,28,0.15)]' };
      case 'quickbooks_purchases':         return { icon: <Package        className={`${cls} text-[#2CA01C]`} />, iconBg: 'bg-[rgba(44,160,28,0.15)]' };
      case 'quickbooks_payments':          return { icon: <CreditCard     className={`${cls} text-[#2CA01C]`} />, iconBg: 'bg-[rgba(44,160,28,0.15)]' };
      case 'quickbooks_bill_payments':     return { icon: <CreditCard     className={`${cls} text-[#2CA01C]`} />, iconBg: 'bg-[rgba(44,160,28,0.15)]' };
      case 'quickbooks_credit_memos':      return { icon: <FileCheck      className={`${cls} text-[#2CA01C]`} />, iconBg: 'bg-[rgba(44,160,28,0.15)]' };
      case 'quickbooks_vendor_credits':    return { icon: <ArrowLeftRight className={`${cls} text-[#2CA01C]`} />, iconBg: 'bg-[rgba(44,160,28,0.15)]' };
      case 'quickbooks_deposits':          return { icon: <Building       className={`${cls} text-[#2CA01C]`} />, iconBg: 'bg-[rgba(44,160,28,0.15)]' };
      case 'quickbooks_transfers':         return { icon: <ArrowLeftRight className={`${cls} text-[#2CA01C]`} />, iconBg: 'bg-[rgba(44,160,28,0.15)]' };
      case 'quickbooks_profit_loss':       return { icon: <TrendingUp     className={`${cls} text-[#2CA01C]`} />, iconBg: 'bg-[rgba(44,160,28,0.15)]' };
      default:                       return { icon: <FolderSync    className={`${cls} text-gray-600`}   />, iconBg: 'bg-gray-500/20'   };
    }
  };

  const getStatusIcon = (status: SyncJob['status']) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'failed':    return <XCircle     className="w-5 h-5 text-red-600" />;
      case 'running':   return <Loader2     className="w-5 h-5 text-blue-600 animate-spin" />;
      case 'queued':    return <Clock       className="w-5 h-5 text-yellow-600" />;
      case 'cancelled': return <XCircle     className="w-5 h-5 text-gray-600" />;
      default:          return <AlertCircle className="w-5 h-5 text-gray-600" />;
    }
  };

  // Get status badge classes (custom colors per status)
  const getStatusBadgeClasses = (status: SyncJob['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-700 border-green-200 hover:bg-green-100';
      case 'failed':
        return 'bg-red-100 text-red-700 border-red-200 hover:bg-red-100';
      case 'running':
        return 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100';
      case 'queued':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200 hover:bg-yellow-100';
      case 'cancelled':
        return 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100';
    }
  };

  // ── Job grouping ──────────────────────────────────────────────────────────────

  const groupJobsByTimestamp = (jobs: SyncJob[]) => {
    const groups: Record<string, SyncJob[]> = {};
    jobs.forEach(job => {
      const d = new Date(job.created_at);
      d.setSeconds(0, 0);
      const key = d.toISOString();
      if (!groups[key]) groups[key] = [];
      groups[key].push(job);
    });
    return Object.entries(groups)
      .map(([timestamp, jobs]) => ({
        timestamp,
        jobs: jobs.sort((a, b) => (a.entity_alias ?? '').localeCompare(b.entity_alias ?? '')),
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  };

  // ── Split jobs by integration ─────────────────────────────────────────────────

  // Show only the most recent sync runs (timestamp groups) per integration
  const MAX_SYNC_HISTORY = 7;
  const limitToRecentSyncs = (jobs: SyncJob[]) =>
    groupJobsByTimestamp(jobs).slice(0, MAX_SYNC_HISTORY).flatMap(g => g.jobs);

  // Hide internal implementation aliases from the UI
  const HIDDEN_ALIASES = new Set(['appointments_current_month']);
  const dentallyJobs = limitToRecentSyncs(syncJobs.filter(j => !IPLICIT_ENTITY_ALIASES.has(j.entity_alias ?? '') && !XERO_ENTITY_ALIASES.has(j.entity_alias ?? '') && !QUICKBOOKS_ENTITY_ALIASES.has(j.entity_alias ?? '') && !HIDDEN_ALIASES.has(j.entity_alias ?? '')));
  const iplicitJobs  = limitToRecentSyncs(syncJobs.filter(j =>  IPLICIT_ENTITY_ALIASES.has(j.entity_alias ?? '')));
  const xeroJobs     = limitToRecentSyncs(syncJobs.filter(j =>  XERO_ENTITY_ALIASES.has(j.entity_alias ?? '')));
  const quickbooksJobs = limitToRecentSyncs(syncJobs.filter(j => QUICKBOOKS_ENTITY_ALIASES.has(j.entity_alias ?? '')));

  // ── Job group row (inner accordion item) ──────────────────────────────────────

  const renderJobGroup = (
    group: { timestamp: string; jobs: SyncJob[] },
    accountMap?: Record<string, string>
  ) => {
    const groupDate    = new Date(group.timestamp);
    const hasRunning   = group.jobs.some(j => j.status === 'running' || j.status === 'queued');
    const hasFailed    = group.jobs.some(j => j.status === 'failed');
    const allCompleted = group.jobs.every(j => j.status === 'completed');
    const accountLabel = accountMap && Object.keys(accountMap).length > 1
      ? accountMap[group.jobs[0]?.integration_id]
      : null;

    const startDates = group.jobs.map(j => j.start_date).filter(Boolean) as string[];
    const endDates   = group.jobs.map(j => j.end_date).filter(Boolean) as string[];
    const groupStart = startDates.length > 0 ? new Date(startDates.reduce((a, b) => a < b ? a : b)) : null;
    const groupEnd   = endDates.length   > 0 ? new Date(endDates.reduce((a, b)   => a > b ? a : b)) : null;

    return (
      <AccordionItem
        key={group.timestamp}
        value={group.timestamp}
        className="border rounded-lg bg-card overflow-hidden hover:shadow-sm transition-shadow"
      >
        <AccordionTrigger className="px-5 py-3.5 hover:no-underline hover:bg-muted/40 transition-colors">
          <div className="flex items-center justify-between w-full pr-3">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0">
                {hasRunning    ? <Loader2      className="w-5 h-5 text-blue-600 animate-spin" />
                : hasFailed    ? <XCircle      className="w-5 h-5 text-red-600" />
                : allCompleted ? <CheckCircle  className="w-5 h-5 text-green-600" />
                :                <Clock        className="w-5 h-5 text-gray-600" />}
              </div>
              <div className="text-left">
                <div className="font-medium text-sm flex items-center gap-2">
                  {groupDate.toLocaleString('en-US', {
                    weekday: 'short', year: 'numeric', month: 'short',
                    day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                  {accountLabel && (
                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50 max-w-[220px] truncate">
                      {accountLabel}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                  <span>{formatDistanceToNow(groupDate, { addSuffix: true })}</span>
                  <span>•</span>
                  {(() => {
                    const distinctCount = new Set(group.jobs.map(j => j.entity_alias)).size;
                    return <span>{distinctCount} {distinctCount === 1 ? 'entity' : 'entities'}</span>;
                  })()}
                  {groupStart && groupEnd && (
                    <>
                      <span>•</span>
                      <Calendar className="w-3 h-3" />
                      <span>
                        {groupStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {' — '}
                        {groupEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-5 mr-2 text-sm">
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Status</div>
                <div className="font-medium">
                  {hasRunning    ? <span className="text-blue-600">In Progress</span>
                  : hasFailed    ? <span className="text-red-600">Failed</span>
                  : allCompleted ? <span className="text-green-600">Completed</span>
                  :                <span className="text-gray-600">Mixed</span>}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Records</div>
                <div className="font-medium">
                  {group.jobs.reduce((sum, j) => sum + j.records_processed, 0).toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </AccordionTrigger>

        <AccordionContent className="px-5 pb-4 pt-2">
          {viewMode === 'table' ? (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Entity</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Processed</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Failed</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Pages</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Completed</th>
                    <th className="px-4 py-2.5 font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(
                    group.jobs.reduce((acc, job) => {
                      if (!acc[job.entity_alias]) acc[job.entity_alias] = [];
                      acc[job.entity_alias].push(job);
                      return acc;
                    }, {} as Record<string, typeof group.jobs>)
                  ).map(([alias, entityJobs], idx, arr) => {
                    const totalProcessed  = entityJobs.reduce((s, j) => s + j.records_processed, 0);
                    const totalFailed     = entityJobs.reduce((s, j) => s + j.records_failed, 0);
                    const totalCurrent    = entityJobs.reduce((s, j) => s + j.current_page, 0);
                    const totalPages      = entityJobs.every(j => j.total_pages)
                      ? entityJobs.reduce((s, j) => s + (j.total_pages || 0), 0) : null;
                    const runningJob      = entityJobs.find(j => j.status === 'running');
                    const hasActive       = entityJobs.some(j => j.status === 'running' || j.status === 'queued');
                    const hasFailedJob    = entityJobs.some(j => j.status === 'cancelled' || j.status === 'failed');
                    const allDone         = entityJobs.every(j => j.status === 'completed');
                    const overallStatus   = runningJob ? 'running'
                      : entityJobs.some(j => j.status === 'queued') ? 'queued'
                      : hasFailedJob ? 'failed'
                      : allDone ? 'completed' : 'mixed';
                    const latestCompleted = entityJobs
                      .filter(j => j.completed_at)
                      .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())[0];
                    const firstFailed = entityJobs.find(j => j.status === 'cancelled' || j.status === 'failed');
                    const { icon, iconBg } = getEntityIcon(alias);

                    return (
                      <tr key={alias} className={cn('border-b last:border-0 hover:bg-muted/30 transition-colors', idx % 2 === 0 ? '' : 'bg-muted/10')}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className={cn('p-1.5 rounded-lg flex-shrink-0', iconBg)}>{icon}</div>
                            <span className="font-medium">{formatEntityName(alias)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            {getStatusIcon(overallStatus)}
                            <Badge variant="outline" className={cn('text-xs', getStatusBadgeClasses(overallStatus))}>
                              {overallStatus}
                            </Badge>
                          </div>
                          {runningJob && (
                            <div className="mt-1 w-32">
                              <Progress value={runningJob.progress_percentage} className="h-1" />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-green-600">
                          {totalProcessed.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-red-600">
                          {totalFailed.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {totalCurrent}{totalPages ? `/${totalPages}` : ''}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {latestCompleted?.completed_at
                            ? formatDistanceToNow(new Date(latestCompleted.completed_at), { addSuffix: true })
                            : '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          {hasActive && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                              onClick={() => entityJobs
                                .filter(j => j.status === 'running' || j.status === 'queued')
                                .forEach(j => handleCancelJob(j.id))}>
                              <X className="w-3.5 h-3.5 mr-1" /> Cancel
                            </Button>
                          )}
                          {hasFailedJob && !hasActive && firstFailed && (
                            <Button variant="outline" size="sm" className="h-7 px-2 text-xs"
                              onClick={() => handleResumeJob(firstFailed)}
                              disabled={entityJobs.some(j => resumingJobs.has(j.id))}>
                              {entityJobs.some(j => resumingJobs.has(j.id))
                                ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                : <Play className="w-3.5 h-3.5 mr-1" />}
                              Resume
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(
              group.jobs.reduce((acc, job) => {
                if (!acc[job.entity_alias]) acc[job.entity_alias] = [];
                acc[job.entity_alias].push(job);
                return acc;
              }, {} as Record<string, typeof group.jobs>)
            ).map(([alias, entityJobs]) => {
              const totalProcessed  = entityJobs.reduce((s, j) => s + j.records_processed, 0);
              const totalFailed     = entityJobs.reduce((s, j) => s + j.records_failed, 0);
              const totalCurrent    = entityJobs.reduce((s, j) => s + j.current_page, 0);
              const totalPages      = entityJobs.every(j => j.total_pages)
                ? entityJobs.reduce((s, j) => s + (j.total_pages || 0), 0) : null;
              const runningJob      = entityJobs.find(j => j.status === 'running');
              const hasActive       = entityJobs.some(j => j.status === 'running' || j.status === 'queued');
              const hasFailedJob    = entityJobs.some(j => j.status === 'cancelled' || j.status === 'failed');
              const allDone         = entityJobs.every(j => j.status === 'completed');
              const overallStatus   = runningJob ? 'running'
                : entityJobs.some(j => j.status === 'queued') ? 'queued'
                : hasFailedJob ? 'failed'
                : allDone ? 'completed' : 'mixed';
              const latestCompleted = entityJobs
                .filter(j => j.completed_at)
                .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())[0];
              const firstFailed = entityJobs.find(j => j.status === 'cancelled' || j.status === 'failed');

              return (
                <Card key={alias} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4 space-y-3">

                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1">
                        <div className={cn('p-2.5 rounded-xl mt-0.5', getEntityIcon(alias).iconBg)}>
                          {getEntityIcon(alias).icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-sm flex items-center gap-2 mb-1">
                            {formatEntityName(alias)}
                            <span>{getStatusIcon(overallStatus)}</span>
                          </h3>
                          <Badge variant="outline" className={cn("text-xs", getStatusBadgeClasses(overallStatus))}>
                            {overallStatus}
                          </Badge>
                        </div>
                      </div>

                      {/* Actions */}
                      {hasActive && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                          onClick={() => entityJobs
                            .filter(j => j.status === 'running' || j.status === 'queued')
                            .forEach(j => handleCancelJob(j.id))}>
                          <X className="w-3.5 h-3.5 mr-1" /> Cancel
                        </Button>
                      )}
                      {hasFailedJob && !hasActive && firstFailed && (
                        <Button
                          variant="outline" size="sm" className="h-7 px-2 text-xs"
                          onClick={() => handleResumeJob(firstFailed)}
                          disabled={entityJobs.some(j => resumingJobs.has(j.id))}
                        >
                          {entityJobs.some(j => resumingJobs.has(j.id))
                            ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                            : <Play className="w-3.5 h-3.5 mr-1" />}
                          Resume
                        </Button>
                      )}
                    </div>

                    {/* Progress bar for running chunk */}
                    {runningJob && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Page {runningJob.current_page}{runningJob.total_pages && ` of ${runningJob.total_pages}`}</span>
                          <span>{runningJob.progress_percentage}%</span>
                        </div>
                        <Progress value={runningJob.progress_percentage} className="h-1.5" />
                      </div>
                    )}

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-3 text-sm border-t pt-3">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                        <div>
                          <div className="text-xs text-muted-foreground">Processed</div>
                          <div className="font-semibold text-green-600 text-sm">{totalProcessed.toLocaleString()}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
                        <div>
                          <div className="text-xs text-muted-foreground">Failed</div>
                          <div className="font-semibold text-red-600 text-sm">{totalFailed.toLocaleString()}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <div>
                          <div className="text-xs text-muted-foreground">Pages</div>
                          <div className="font-semibold text-sm">
                            {totalCurrent}{totalPages ? `/${totalPages}` : ''}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Error */}
                    {entityJobs.some(j => j.error_message) && (
                      <div className="bg-destructive/10 border border-destructive/20 rounded p-2.5">
                        <p className="text-xs text-destructive font-medium mb-0.5">Error:</p>
                        <p className="text-xs text-destructive/80">
                          {entityJobs.find(j => j.error_message)?.error_message}
                        </p>
                      </div>
                    )}

                    {/* Completion time */}
                    {latestCompleted?.completed_at && (
                      <div className="text-xs text-muted-foreground">
                        Completed {formatDistanceToNow(new Date(latestCompleted.completed_at), { addSuffix: true })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          )}
        </AccordionContent>
      </AccordionItem>
    );
  };

  // ── Sync groups table (outer accordion → table rows) ─────────────────────────

  const renderGroupsTable = (jobs: SyncJob[], accountMap?: Record<string, string>) => {
    const groups = groupJobsByTimestamp(jobs);
    const showAccount = !!accountMap && Object.keys(accountMap).length > 1;
    const colSpan = showAccount ? 8 : 7;
    return (
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="w-8 px-3 py-2.5"></th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Date</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Time</th>
              {showAccount && (
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Account</th>
              )}
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Entities</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Period</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Records</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group, idx) => {
              const groupDate    = new Date(group.timestamp);
              const hasRunning   = group.jobs.some(j => j.status === 'running' || j.status === 'queued');
              const hasFailed    = group.jobs.some(j => j.status === 'failed');
              const allCompleted = group.jobs.every(j => j.status === 'completed');
              const overallStatus = hasRunning ? 'running' : hasFailed ? 'failed' : allCompleted ? 'completed' : 'mixed';

              const startDates = group.jobs.map(j => j.start_date).filter(Boolean) as string[];
              const endDates   = group.jobs.map(j => j.end_date).filter(Boolean) as string[];
              const groupStart = startDates.length > 0 ? new Date(startDates.reduce((a, b) => a < b ? a : b)) : null;
              const groupEnd   = endDates.length > 0   ? new Date(endDates.reduce((a, b) => a > b ? a : b))   : null;
              const distinctEntities = new Set(group.jobs.map(j => j.entity_alias)).size;
              const totalRecords     = group.jobs.reduce((s, j) => s + j.records_processed, 0);
              const isExpanded       = expandedGroups.has(group.timestamp);

              return (
                <Fragment key={group.timestamp}>
                  <tr
                    className={cn(
                      'border-b cursor-pointer hover:bg-muted/40 transition-colors',
                      isExpanded ? 'bg-muted/20' : idx % 2 === 1 ? 'bg-muted/10' : ''
                    )}
                    onClick={() => toggleGroup(group.timestamp)}
                  >
                    <td className="px-3 py-3 text-muted-foreground">
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4" />
                        : <ChevronRight className="w-4 h-4" />}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {groupDate.toLocaleString('en-US', {
                        weekday: 'short', year: 'numeric', month: 'short',
                        day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {formatDistanceToNow(groupDate, { addSuffix: true })}
                    </td>
                    {showAccount && (
                      <td className="px-4 py-3">
                        {(() => {
                          const intId = group.jobs[0]?.integration_id;
                          const label = intId ? accountMap![intId] : null;
                          return label ? (
                            <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50 max-w-[220px] truncate">
                              {label}
                            </Badge>
                          ) : <span className="text-muted-foreground text-xs">—</span>;
                        })()}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {distinctEntities}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {groupStart && groupEnd ? (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 flex-shrink-0" />
                          {groupStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {' — '}
                          {groupEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {getStatusIcon(overallStatus)}
                        <Badge variant="outline" className={cn('text-xs', getStatusBadgeClasses(overallStatus))}>
                          {hasRunning ? 'In Progress' : hasFailed ? 'Failed' : allCompleted ? 'Completed' : 'Mixed'}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {totalRecords.toLocaleString()}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${group.timestamp}-detail`} className="bg-muted/5">
                      <td colSpan={colSpan} className="px-4 py-3">
                        {/* Entity-level table nested inside */}
                        <div className="overflow-x-auto rounded-lg border">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-muted/50 border-b">
                                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Entity</th>
                                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                                <th className="text-right px-4 py-2 font-medium text-muted-foreground">Processed</th>
                                <th className="text-right px-4 py-2 font-medium text-muted-foreground">Failed</th>
                                <th className="text-right px-4 py-2 font-medium text-muted-foreground">Pages</th>
                                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Completed</th>
                                <th className="px-4 py-2"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(
                                group.jobs.reduce((acc, job) => {
                                  if (!acc[job.entity_alias]) acc[job.entity_alias] = [];
                                  acc[job.entity_alias].push(job);
                                  return acc;
                                }, {} as Record<string, typeof group.jobs>)
                              ).map(([alias, entityJobs], eIdx) => {
                                const totalProcessed = entityJobs.reduce((s, j) => s + j.records_processed, 0);
                                const totalFailed    = entityJobs.reduce((s, j) => s + j.records_failed, 0);
                                const totalCurrent   = entityJobs.reduce((s, j) => s + j.current_page, 0);
                                const totalPages     = entityJobs.every(j => j.total_pages)
                                  ? entityJobs.reduce((s, j) => s + (j.total_pages || 0), 0) : null;
                                const runningJob     = entityJobs.find(j => j.status === 'running');
                                const hasActive      = entityJobs.some(j => j.status === 'running' || j.status === 'queued');
                                const hasFailedJob   = entityJobs.some(j => j.status === 'cancelled' || j.status === 'failed');
                                const allDone        = entityJobs.every(j => j.status === 'completed');
                                const eStatus        = runningJob ? 'running'
                                  : entityJobs.some(j => j.status === 'queued') ? 'queued'
                                  : hasFailedJob ? 'failed'
                                  : allDone ? 'completed' : 'mixed';
                                const latestCompleted = entityJobs
                                  .filter(j => j.completed_at)
                                  .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())[0];
                                const firstFailed = entityJobs.find(j => j.status === 'cancelled' || j.status === 'failed');
                                const { icon, iconBg } = getEntityIcon(alias);

                                return (
                                  <tr key={alias} className={cn('border-b last:border-0 hover:bg-muted/30 transition-colors', eIdx % 2 === 1 ? 'bg-muted/10' : '')}>
                                    <td className="px-4 py-2">
                                      <div className="flex items-center gap-2">
                                        <div className={cn('p-1.5 rounded-lg flex-shrink-0', iconBg)}>{icon}</div>
                                        <span className="font-medium">{formatEntityName(alias)}</span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-2">
                                      <div className="flex items-center gap-1.5">
                                        {getStatusIcon(eStatus)}
                                        <Badge variant="outline" className={cn('text-xs', getStatusBadgeClasses(eStatus))}>
                                          {eStatus}
                                        </Badge>
                                      </div>
                                      {runningJob && (
                                        <div className="mt-1 w-28">
                                          <Progress value={runningJob.progress_percentage} className="h-1" />
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-4 py-2 text-right font-semibold text-green-600">{totalProcessed.toLocaleString()}</td>
                                    <td className="px-4 py-2 text-right font-semibold text-red-600">{totalFailed.toLocaleString()}</td>
                                    <td className="px-4 py-2 text-right text-muted-foreground">{totalCurrent}{totalPages ? `/${totalPages}` : ''}</td>
                                    <td className="px-4 py-2 text-xs text-muted-foreground">
                                      {latestCompleted?.completed_at
                                        ? formatDistanceToNow(new Date(latestCompleted.completed_at), { addSuffix: true })
                                        : '—'}
                                    </td>
                                    <td className="px-4 py-2">
                                      {hasActive && (
                                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                                          onClick={e => { e.stopPropagation(); entityJobs.filter(j => j.status === 'running' || j.status === 'queued').forEach(j => handleCancelJob(j.id)); }}>
                                          <X className="w-3.5 h-3.5 mr-1" /> Cancel
                                        </Button>
                                      )}
                                      {hasFailedJob && !hasActive && firstFailed && (
                                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs"
                                          onClick={e => { e.stopPropagation(); handleResumeJob(firstFailed); }}
                                          disabled={entityJobs.some(j => resumingJobs.has(j.id))}>
                                          {entityJobs.some(j => resumingJobs.has(j.id))
                                            ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                            : <Play className="w-3.5 h-3.5 mr-1" />}
                                          Resume
                                        </Button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // ── Integration accordion trigger ─────────────────────────────────────────────

  const renderIntegrationTrigger = (
    title: string,
    jobs: SyncJob[],
    integration: 'dentally' | 'iplicit' | 'xero' | 'quickbooks'
  ) => {
    const completed  = jobs.filter(j => j.status === 'completed').length;
    const active     = jobs.filter(j => j.status === 'running' || j.status === 'queued').length;
    const failed     = jobs.filter(j => j.status === 'failed').length;
    const records    = jobs.reduce((sum, j) => sum + j.records_processed, 0);
    const syncCount  = groupJobsByTimestamp(jobs).length;

    const badgeCls = integration === 'dentally'
      ? 'bg-blue-100 text-blue-700 border-blue-200'
      : integration === 'xero'
      ? 'bg-[rgba(19,181,234,0.15)] text-[#0e8ab5] border-[rgba(19,181,234,0.3)]'
      : integration === 'quickbooks'
      ? 'bg-[rgba(44,160,28,0.15)] text-[#1f7a14] border-[rgba(44,160,28,0.3)]'
      : 'bg-indigo-100 text-indigo-700 border-indigo-200';

    const logoEl = integration === 'dentally' ? (
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center flex-shrink-0 shadow-sm text-xl">
        🦷
      </div>
    ) : integration === 'xero' ? (
      <div className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 shadow-sm p-1.5">
        <img src={INTEGRATION_LOGOS.xero} alt="Xero" className="w-full h-full object-contain" />
      </div>
    ) : integration === 'quickbooks' ? (
      <div className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 shadow-sm p-1.5">
        <img src={INTEGRATION_LOGOS.quickbooks} alt="QuickBooks" className="w-full h-full object-contain" />
      </div>
    ) : (
      <div className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 shadow-sm p-1">
        <img src={INTEGRATION_LOGOS.iplicit} alt="Iplicit" className="w-full h-full object-contain" />
      </div>
    );

    return (
      <div className="flex items-center justify-between w-full pr-4">
        {/* Left: logo + name + badge */}
        <div className="flex items-center gap-3">
          {logoEl}
          <span className="text-lg font-semibold">{title}</span>
          <Badge variant="secondary" className={cn('text-xs font-medium', badgeCls)}>
            {syncCount} {syncCount === 1 ? 'sync' : 'syncs'}
          </Badge>
        </div>

        {/* Right: quick stats */}
        <div className="flex items-center gap-4 text-sm mr-2">
          <span className="flex items-center gap-1 text-green-600 font-medium">
            <CheckCircle className="w-3.5 h-3.5" /> {completed}
          </span>
          <span className="flex items-center gap-1 text-blue-600 font-medium">
            <Activity className="w-3.5 h-3.5" /> {active} active
          </span>
          <span className="flex items-center gap-1 text-red-600 font-medium">
            <XCircle className="w-3.5 h-3.5" /> {failed} failed
          </span>
          <span className="flex items-center gap-1 text-purple-600 font-medium">
            <Database className="w-3.5 h-3.5" /> {records.toLocaleString()} records
          </span>
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const noIntegrations = !dentallyConnected && !iplicitConnected && !xeroConnected && !quickbooksConnected;

  return (
    <MainLayout>
      <Helmet>
        <title>Data Sync Status</title>
        <meta name="description" content="Monitor and manage your data synchronization jobs." />
      </Helmet>

      <div className="space-y-6 pt-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-1">Sync Summary</h1>
            <p className="text-muted-foreground">Monitor and manage your data synchronization jobs</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center border rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('table')}
                className={cn(
                  'p-2 transition-colors',
                  viewMode === 'table'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-muted-foreground'
                )}
                title="Table view"
              >
                <Table2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('block')}
                className={cn(
                  'p-2 transition-colors',
                  viewMode === 'block'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-muted-foreground'
                )}
                title="Block view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
            <Button
              variant="outline" size="sm"
              onClick={() => fetchSyncJobs(true)}
              disabled={isRefreshing}
            >
              <RefreshCw className={cn('w-4 h-4 mr-2', isRefreshing && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : noIntegrations ? (
          <Card>
            <CardContent className="text-center py-12">
              <p className="text-muted-foreground">No integrations connected yet</p>
            </CardContent>
          </Card>
        ) : (
          /* Outer accordion — one item per connected integration */
          <Accordion type="multiple" defaultValue={['dentally', 'iplicit', 'xero', 'quickbooks']} className="space-y-4">

            {/* ── Dentally ── */}
            {dentallyConnected && (
              <AccordionItem
                value="dentally"
                className="border rounded-xl bg-card overflow-hidden shadow-sm"
              >
                <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/30 transition-colors">
                  {renderIntegrationTrigger('Dentally', dentallyJobs, 'dentally')}
                </AccordionTrigger>

                <AccordionContent className="px-6 pb-6 pt-1">
                  {dentallyJobs.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-6">
                      <p className="text-sm text-muted-foreground">
                        No Dentally sync jobs yet
                      </p>
                    </div>
                  ) : viewMode === 'table' ? renderGroupsTable(dentallyJobs, dentallyAccounts) : (
                    <Accordion type="single" collapsible className="space-y-2">
                      {groupJobsByTimestamp(dentallyJobs).map(group => renderJobGroup(group, dentallyAccounts))}
                    </Accordion>
                  )}
                </AccordionContent>
              </AccordionItem>
            )}

            {/* ── Iplicit ── */}
            {iplicitConnected && (
              <AccordionItem
                value="iplicit"
                className="border rounded-xl bg-card overflow-hidden shadow-sm"
              >
                <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/30 transition-colors">
                  {renderIntegrationTrigger('Iplicit', iplicitJobs, 'iplicit')}
                </AccordionTrigger>

                <AccordionContent className="px-6 pb-6 pt-1">
                  {iplicitJobs.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No Iplicit sync jobs yet
                    </p>
                  ) : viewMode === 'table' ? renderGroupsTable(iplicitJobs) : (
                    <Accordion type="single" collapsible className="space-y-2">
                      {groupJobsByTimestamp(iplicitJobs).map(group => renderJobGroup(group))}
                    </Accordion>
                  )}
                </AccordionContent>
              </AccordionItem>
            )}

            {/* ── Xero ── */}
            {xeroConnected && (
              <AccordionItem
                value="xero"
                className="border rounded-xl bg-card overflow-hidden shadow-sm"
              >
                <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/30 transition-colors">
                  {renderIntegrationTrigger('Xero', xeroJobs, 'xero')}
                </AccordionTrigger>

                <AccordionContent className="px-6 pb-6 pt-1">
                  {xeroJobs.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No Xero sync jobs yet
                    </p>
                  ) : viewMode === 'table' ? renderGroupsTable(xeroJobs) : (
                    <Accordion type="single" collapsible className="space-y-2">
                      {groupJobsByTimestamp(xeroJobs).map(group => renderJobGroup(group))}
                    </Accordion>
                  )}
                </AccordionContent>
              </AccordionItem>
            )}

            {/* ── QuickBooks ── */}
            {quickbooksConnected && (
              <AccordionItem
                value="quickbooks"
                className="border rounded-xl bg-card overflow-hidden shadow-sm"
              >
                <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/30 transition-colors">
                  {renderIntegrationTrigger('QuickBooks', quickbooksJobs, 'quickbooks')}
                </AccordionTrigger>

                <AccordionContent className="px-6 pb-6 pt-1">
                  {quickbooksJobs.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No QuickBooks sync jobs yet
                    </p>
                  ) : viewMode === 'table' ? renderGroupsTable(quickbooksJobs) : (
                    <Accordion type="single" collapsible className="space-y-2">
                      {groupJobsByTimestamp(quickbooksJobs).map(group => renderJobGroup(group))}
                    </Accordion>
                  )}
                </AccordionContent>
              </AccordionItem>
            )}

          </Accordion>
        )}
      </div>
    </MainLayout>
  );
}
