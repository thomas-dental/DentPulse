/**
 * Cash Flow — CFO Summary (standalone page).
 *
 * A thin wrapper: the page chrome (layout, title, "Full forecast" link) plus the
 * shared <CfoSummaryContent />, which owns the data + all the KPIs/charts/tables.
 * The same content is rendered as the "CFO Summary" tab on the forecast page.
 */

import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Table2 } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import CfoSummaryContent from '@/components/cashflow/CfoSummaryContent';

export default function CashflowCfoSummary() {
  return (
    <MainLayout userRole="admin">
      <Helmet>
        <title>CFO Summary · Cash Flow Forecast - DentPulse</title>
      </Helmet>

      <div className="space-y-5 animate-fade-in">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold text-foreground">Cash Flow — CFO Summary</h1>
          <Link to="/cashflow/13-week-forecast" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground">
            <Table2 className="h-4 w-4" /> Full forecast
          </Link>
        </div>

        <CfoSummaryContent />
      </div>
    </MainLayout>
  );
}
