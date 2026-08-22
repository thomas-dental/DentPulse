import { useMemo } from 'react';
import { usePermissions } from './usePermissions';
import type { ActionType } from '@/lib/permissionRegistry';

export type APTab = 'capture' | 'invoices' | 'index' | 'queue' | 'suppliers' | 'analytics';

export type APAction =
  | 'upload_invoice'
  | 'review_invoice'
  | 'approve_invoice'
  | 'share_invoice'
  | 'export_invoices'
  | 'create_folder'
  | 'edit_folder'
  | 'delete_folder'
  | 'extract_email'
  | 'view_invoice_detail';

const MODULE = 'accounts_payable';

/**
 * Maps AP tabs to permission registry cards + actions.
 * Tab is accessible if user has 'view' on the mapped card.
 */
const TAB_CARD_MAP: Record<APTab, string> = {
  capture:   'email_inbox',
  invoices:  'invoices',
  index:     'invoices',
  queue:     'invoice_review',
  suppliers: 'suppliers',
  analytics: 'analytics',
};

/**
 * Maps AP actions to permission registry card + action_type.
 */
const ACTION_MAP: Record<APAction, { card: string; action: ActionType }> = {
  upload_invoice:      { card: 'invoices', action: 'add' },
  review_invoice:      { card: 'invoice_review', action: 'action' },
  approve_invoice:     { card: 'invoice_review', action: 'action' },
  share_invoice:       { card: 'invoice_review', action: 'action' },
  export_invoices:     { card: 'invoices', action: 'export' },
  create_folder:       { card: 'folders', action: 'add' },
  edit_folder:         { card: 'folders', action: 'update' },
  delete_folder:       { card: 'folders', action: 'delete' },
  extract_email:       { card: 'email_inbox', action: 'action' },
  view_invoice_detail: { card: 'invoices', action: 'view' },
};

const TAB_ORDER: APTab[] = ['capture', 'invoices', 'index', 'queue', 'suppliers', 'analytics'];

export function useAccountsPayablePermissions() {
  const { can, isOwner, loading } = usePermissions();

  const permissions = useMemo(() => {
    const canAccessTab = (tab: APTab): boolean => {
      if (isOwner) return true;
      const card = TAB_CARD_MAP[tab];
      return can(MODULE, 'view', card);
    };

    const canPerformAction = (action: APAction): boolean => {
      if (isOwner) return true;
      const mapping = ACTION_MAP[action];
      return can(MODULE, mapping.action, mapping.card);
    };

    const allowedTabs = TAB_ORDER.filter((tab) => canAccessTab(tab));
    const defaultTab = allowedTabs[0] || 'invoices';

    return {
      role: isOwner ? 'owner' : 'custom',
      canAccessTab,
      canPerformAction,
      allowedTabs,
      defaultTab,
      isReadOnly: !isOwner && !can(MODULE, 'add', 'invoices'),
    };
  }, [can, isOwner]);

  return { ...permissions, loading };
}
