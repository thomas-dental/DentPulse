import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildDentallyInvoiceUrl,
  buildDentallyPatientUrl,
  type DentallyInvoiceLinkInput,
} from '@/lib/dentallyDeepLinks';

const linkClass = 'font-semibold text-primary hover:underline inline-flex items-center gap-1';

export function DentallyPatientLink({
  dentallyPatientUuid,
  children,
  className,
  title = 'Open patient in Dentally',
}: {
  dentallyPatientUuid: string | null | undefined;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const href = buildDentallyPatientUrl(dentallyPatientUuid);
  if (!href) {
    return <span className={className}>{children}</span>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(linkClass, 'group', className)}
      title={title}
    >
      {children}
      <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
    </a>
  );
}

export function DentallyInvoiceLink({
  label,
  dentallyPatientUuid,
  accountUuid,
  invoiceUuid,
  className,
  missingTitle = 'Re-sync invoices to enable Dentally link',
}: {
  label: ReactNode;
  dentallyPatientUuid?: string | null;
  accountUuid?: string | null;
  invoiceUuid?: string | null;
  className?: string;
  missingTitle?: string;
} & DentallyInvoiceLinkInput) {
  const href = buildDentallyInvoiceUrl({
    dentallyPatientUuid,
    accountUuid,
    invoiceUuid,
  });

  if (!href) {
    return (
      <span className={className} title={missingTitle}>
        {label}
      </span>
    );
  }

  const isDirectInvoice = Boolean(invoiceUuid);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(linkClass, 'group', className)}
      title={
        isDirectInvoice ? 'Open invoice in Dentally' : 'Open patient account (Payments) in Dentally'
      }
    >
      {label}
      <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
    </a>
  );
}
