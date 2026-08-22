/**
 * Client-side helpers for accounting transaction deep links (Version 2.0 parity).
 */

export type AccountingPlatform = 'xero' | 'quickbooks' | 'iplicit';

export const ACCOUNTING_LINK_COLORS: Record<AccountingPlatform, string> = {
  xero: '#1ab4d7',
  quickbooks: '#2ca01c',
  iplicit: '#6366f1',
};

export function accountingLinkClassName(platform: AccountingPlatform | null | undefined): string {
  switch (platform) {
    case 'xero':
      return 'text-[#1ab4d7] hover:text-[#0e8ab5]';
    case 'quickbooks':
      return 'text-[#2ca01c] hover:text-[#1f7a14]';
    case 'iplicit':
      return 'text-indigo-600 hover:text-indigo-700';
    default:
      return 'text-primary hover:underline';
  }
}

export function isValidTransactionLink(link: string | null | undefined): boolean {
  return !!link && link !== '#' && link.startsWith('http');
}
