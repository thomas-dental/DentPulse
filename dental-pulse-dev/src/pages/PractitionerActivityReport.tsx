/**
 * Practitioner Activity report — the all-practitioners equivalent of
 * fe-dentpulse-live's /provider/activity page (be-dentpulse's
 * DentallyReportController.GetPractitionerActivityReport): a flat, itemized
 * list of completed treatments across every practitioner, filterable by
 * date range, practitioner, treatment, treatment category and payment plan,
 * with a total "Money In" footer — same shape as Dentally's own
 * reports/practitioner_activity report.
 *
 * Unlike the live version, this app supports more than one location per
 * organization, so this page additionally scopes by the global top-nav
 * location filter (same mechanism as Practitioner History) — live has no
 * location filter at all because each org there has exactly one Dentally
 * connection.
 */
import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { ClipboardList } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { ConfigProvider, DatePicker } from 'antd';
import dayjs from 'dayjs';
import { useFilters } from '@/contexts/FilterContext';
import { usePlanAccess } from '@/hooks/usePlanAccess';
import { usePractitionerActivityReport, type PractitionerActivityRow } from '@/hooks/usePractitionerActivityReport';
import { toDateStr, fmtDate, fmtCurrency } from '@/lib/activityReportUtils';
import { type ColumnDef, useTableState, MultiFilterSelect, DataTable } from '@/components/reports/ActivityDataTable';

export default function PractitionerActivityReport() {
  const { planTier } = usePlanAccess();
  const { dateRange } = useFilters();
  const [from, setFrom] = useState(toDateStr(dateRange.startDate));
  const [to, setTo] = useState(toDateStr(dateRange.endDate));
  const ts = useTableState();

  const [practitioners, setPractitioners] = useState<string[]>([]);
  const [treatments, setTreatments] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [paymentPlans, setPaymentPlans] = useState<string[]>([]);

  useEffect(() => {
    setFrom(toDateStr(dateRange.startDate));
    setTo(toDateStr(dateRange.endDate));
  }, [dateRange.startDate, dateRange.endDate]);

  const { data: rows = [], isLoading } = usePractitionerActivityReport(from, to);

  const practitionerOptions = useMemo(
    () => [...new Set(rows.map(r => r.practitioner))].sort((a, b) => a.localeCompare(b)),
    [rows]);
  const treatmentOptions = useMemo(
    () => [...new Set(rows.map(r => r.treatment))].sort((a, b) => a.localeCompare(b)),
    [rows]);
  const categoryOptions = useMemo(
    () => [...new Set(rows.map(r => r.category))].sort((a, b) => a.localeCompare(b)),
    [rows]);
  const paymentPlanOptions = useMemo(
    () => [...new Set(rows.map(r => r.paymentPlan))].sort((a, b) => a.localeCompare(b)),
    [rows]);

  const filtered = useMemo(() => rows.filter(r =>
    (practitioners.length === 0 || practitioners.includes(r.practitioner)) &&
    (treatments.length === 0 || treatments.includes(r.treatment)) &&
    (categories.length === 0 || categories.includes(r.category)) &&
    (paymentPlans.length === 0 || paymentPlans.includes(r.paymentPlan))
  ), [rows, practitioners, treatments, categories, paymentPlans]);

  // Reconciliation totals - deliberately mirror the four figures Dentally's own
  // practitioner_activity report prints in its footer ("N found", "N Patients",
  // "H hours", total price) so a mismatch can be localised at a glance instead
  // of guessed at: equal rows + unequal money means a price problem on rows we
  // already hold; fewer rows means treatments are missing from DentPulse.
  const stats = useMemo(() => {
    const patients = new Set<string>();
    let minutes = 0;
    let money = 0;
    for (const r of filtered) {
      patients.add(r.patientId != null ? String(r.patientId) : r.patient);
      minutes += r.duration;
      money += r.price;
    }
    return { rows: filtered.length, patients: patients.size, hours: minutes / 60, money };
  }, [filtered]);

  const columns: ColumnDef<PractitionerActivityRow>[] = [
    { key: 'completedAt', label: 'Completed On', sortable: true, render: r => <span className="whitespace-nowrap">{fmtDate(r.completedAt)}</span>, sortVal: r => r.completedAt, csv: r => fmtDate(r.completedAt) },
    {
      key: 'patient',
      label: 'Patient',
      sortable: true,
      render: r => r.patientId != null
        ? (
            <a
              href={`https://app.dentally.co/patients/${r.patientId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {r.patient}
            </a>
          )
        : r.patient,
      sortVal: r => r.patient,
      csv: r => r.patient,
    },
    { key: 'treatment', label: 'Treatment', sortable: true, render: r => r.treatment, sortVal: r => r.treatment, csv: r => r.treatment },
    { key: 'practitioner', label: 'Practitioner', sortable: true, render: r => <span className="whitespace-nowrap">{r.practitioner}</span>, sortVal: r => r.practitioner, csv: r => r.practitioner },
    { key: 'paymentPlan', label: 'Payment Plan', sortable: true, render: r => r.paymentPlan, sortVal: r => r.paymentPlan, csv: r => r.paymentPlan },
    { key: 'paymentMethod', label: 'Payment Method', sortable: true, render: r => <span className="whitespace-nowrap">{r.paymentMethod}</span>, sortVal: r => r.paymentMethod, csv: r => r.paymentMethod },
    { key: 'duration', label: 'Duration', sortable: true, align: 'right', render: r => r.duration, sortVal: r => r.duration, csv: r => r.duration },
    {
      key: 'price',
      label: 'Price',
      sortable: true,
      align: 'right',
      render: r => {
        const canLinkAccount = r.price > 0 && !!r.patientUuid && !!r.accountUuid;
        if (!canLinkAccount) return <span className="font-medium">{fmtCurrency(r.price)}</span>;
        const filterAccounts = encodeURIComponent(`["${r.accountUuid}"]`);
        const href = `https://app.dentally.co/patients/${r.patientUuid}/account/${r.accountUuid}?activeTab=payments&filterAccounts=${filterAccounts}`;
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline"
            title="Open patient account (Payments) in Dentally"
          >
            {fmtCurrency(r.price)}
          </a>
        );
      },
      sortVal: r => r.price,
      csv: r => r.price,
    },
    { key: 'invoicedOn', label: 'Invoiced On', sortable: true, render: r => <span className="whitespace-nowrap">{r.invoicedOn ? fmtDate(r.invoicedOn) : '—'}</span>, sortVal: r => r.invoicedOn, csv: r => (r.invoicedOn ? fmtDate(r.invoicedOn) : '') },
    { key: 'paidOn', label: 'Paid On', render: r => <span className="whitespace-nowrap">{r.paidOn ? fmtDate(r.paidOn) : '—'}</span>, csv: r => (r.paidOn ? fmtDate(r.paidOn) : '') },
    { key: 'status', label: 'Status', sortable: true, render: r => r.status, sortVal: r => r.status, csv: r => r.status },
  ];

  return (
    <MainLayout userRole="admin" aiContext={{ page: 'practitioner-activity-report' }} locked={planTier === 'basic'}>
      <Helmet><title>Practitioner Activity</title></Helmet>

      <div className="space-y-5 pt-6">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Practitioner Activity</h1>
            <p className="text-muted-foreground">Completed treatments across every practitioner for the location selected above</p>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span>
                  <span className="text-muted-foreground mr-2">Total Money In:</span>
                  <span className="font-bold text-lg">{fmtCurrency(stats.money)}</span>
                </span>
                <span>
                  <span className="text-muted-foreground mr-2">Rows:</span>
                  <span className="font-semibold">{stats.rows.toLocaleString('en-GB')}</span>
                </span>
                <span>
                  <span className="text-muted-foreground mr-2">Patients:</span>
                  <span className="font-semibold">{stats.patients.toLocaleString('en-GB')}</span>
                </span>
                <span>
                  <span className="text-muted-foreground mr-2">Hours:</span>
                  <span className="font-semibold">{stats.hours.toFixed(1)}</span>
                </span>
              </div>
              <ConfigProvider
                theme={{
                  token: {
                    colorPrimary: 'hsl(244, 48%, 25%)',
                    colorPrimaryBg: '#e6f4ff',
                    colorPrimaryBgHover: '#bae0ff',
                  },
                }}
              >
                <DatePicker.RangePicker
                  value={[from ? dayjs(from) : null, to ? dayjs(to) : null]}
                  onChange={(dates) => {
                    if (dates && dates[0] && dates[1]) {
                      setFrom(dates[0].format('YYYY-MM-DD'));
                      setTo(dates[1].format('YYYY-MM-DD'));
                    }
                  }}
                  format="DD-MM-YYYY"
                  allowClear={false}
                  className="h-9 w-[260px]"
                />
              </ConfigProvider>
            </div>

            <DataTable
              rows={filtered}
              columns={columns}
              searchText={ts.search}
              searchFields={r => `${r.patient} ${r.treatment} ${r.category} ${r.practitioner} ${r.paymentPlan}`}
              ts={ts}
              isLoading={isLoading}
              emptyText="No completed treatments for this period / search."
              exportName={`practitioner_activity_${from}_to_${to}`}
              filtersSlot={
                <>
                  <MultiFilterSelect label="Practitioner" values={practitioners} onChange={setPractitioners} options={practitionerOptions} />
                  <MultiFilterSelect label="Treatment" values={treatments} onChange={setTreatments} options={treatmentOptions} />
                  <MultiFilterSelect label="Category" values={categories} onChange={setCategories} options={categoryOptions} />
                  <MultiFilterSelect label="Payment Plan" values={paymentPlans} onChange={setPaymentPlans} options={paymentPlanOptions} />
                </>
              }
            />
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
