import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Tooltip as UITooltip,
  TooltipContent as UITooltipContent,
  TooltipProvider as UITooltipProvider,
  TooltipTrigger as UITooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import { Link, useParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  ArrowLeft,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
  Clock,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMembershipUploadData } from '@/hooks/useMembershipUploadData';
import { useMembershipPerformance } from '@/hooks/useMembershipPerformance';
import { useTreatments } from '@/hooks/useTreatments';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? NaN : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCompact(amount: number): string {
  if (amount >= 1_000_000) return `£${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `£${(amount / 1_000).toFixed(1)}k`;
  return formatCurrency(amount);
}

function formatMinutes(mins: number): string {
  if (mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface TreatmentBreakdownRow {
  treatment: string;
  category: string;
  type: string;
  volPerMonth: number;
  membershipRev: number;
  privateRev: number;
  capturePct: number;
  captureWarning: boolean;
  avgTime: string;
  benchmark: string;
  margin: 'Healthy' | 'Monitor' | 'Concern';
  benchmarkMin: number;
  overrunMin: number;
}

interface Recommendation {
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  savings: string;
  savingsNum: number;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  if (type === 'Included') {
    return (
      <span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400">
        Included
      </span>
    );
  }
  return (
    <span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
      {type}
    </span>
  );
}

function CaptureBadge({ pct, warning }: { pct: number; warning?: boolean }) {
  if (warning) {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-600">
        <AlertTriangle className="w-3.5 h-3.5" />
        {pct}%
      </span>
    );
  }
  const color =
    pct >= 85 ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400' :
    pct >= 70 ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' :
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400';
  return (
    <span className={cn('inline-flex px-2 py-0.5 rounded text-xs font-semibold', color)}>
      {pct}%
    </span>
  );
}

function MarginBadge({ margin }: { margin: 'Healthy' | 'Monitor' | 'Concern' }) {
  const config = {
    Healthy: 'text-emerald-600 dark:text-emerald-400',
    Monitor: 'text-amber-600 dark:text-amber-400',
    Concern: 'text-red-600 dark:text-red-400',
  };
  return <span className={cn('text-sm font-semibold', config[margin])}>{margin}</span>;
}

function ImpactBadge({ impact }: { impact: 'high' | 'medium' | 'low' }) {
  const config = {
    high: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
    low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  };
  return (
    <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-semibold', config[impact])}>
      {impact} impact
    </span>
  );
}

function ChartTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-lg px-3 py-2 shadow-md text-sm">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-muted-foreground">
          <span style={{ color: p.color }} className="font-medium">{p.name}: </span>
          {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MembershipPlanDetail() {
  const { planSlug } = useParams<{ planSlug: string }>();
  const {
    planSummary: uploadPlanSummary,
    members: uploadedMembers,
    isLoading: isUploadLoading,
  } = useMembershipUploadData();
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberPage, setMemberPage] = useState(1);
  const MEMBERS_PAGE_SIZE = 10;
  const { treatments: dbTreatments } = useTreatments();
  const {
    planOverviews,
    treatmentConsumption: allTreatmentConsumption,
    isLoading: isPerfLoading,
  } = useMembershipPerformance();

  const slug = decodeURIComponent(planSlug || '').toLowerCase();

  // Match uploaded plan by slug (fee_category lowercased with dashes)
  const uploadedPlan = useMemo(() => {
    return uploadPlanSummary.find(
      ps => ps.fee_category.toLowerCase().replace(/\s+/g, '-') === slug
    ) ?? null;
  }, [uploadPlanSummary, slug]);

  // Resolve the mapped DB plan from the Membership Performance plan overview —
  // same source the parent page's "Treatment Consumption by Plan" table uses.
  const mappedDbPlan = useMemo(() => {
    if (!uploadedPlan?.mapped_plan_id) return null;
    const p = planOverviews.find(po => po.planId === uploadedPlan.mapped_plan_id);
    if (!p) return null;
    return {
      id: p.planId,
      name: p.planName,
      monthlyFee: p.monthlyFee,
      examAppointmentsIncluded: 0,
      hygieneAppointmentsIncluded: 0,
      members: p.members,
    };
  }, [planOverviews, uploadedPlan?.mapped_plan_id]);

  const mappedPlanMemberCount = mappedDbPlan?.members ?? 0;
  const isMappedLoading = isPerfLoading;

  // Filter treatment consumption to just this plan — same logic as the parent
  // page's bottom table when a specific plan is selected in its dropdown.
  const planTreatmentConsumption = useMemo(() => {
    if (!mappedDbPlan) return [];
    return allTreatmentConsumption.filter(
      tc => tc.plan === mappedDbPlan.name && tc.treatmentCount > 0,
    );
  }, [allTreatmentConsumption, mappedDbPlan]);

  // Build treatment lookup by name for joining with treatmentConsumption
  const treatmentLookup = useMemo(() => {
    const map = new Map<string, (typeof dbTreatments)[0]>();
    for (const t of dbTreatments) {
      if (t.treatment_name) map.set(t.treatment_name, t);
    }
    return map;
  }, [dbTreatments]);

  const planTreatmentData = useMemo(() => {
    return planTreatmentConsumption
      .filter(tc => tc.treatmentCount > 0)
      .sort((a, b) => b.treatmentCount - a.treatmentCount);
  }, [planTreatmentConsumption]);

  // Build treatment breakdown rows from plan's treatments in DB
  const treatmentBreakdown: TreatmentBreakdownRow[] = useMemo(() => {
    return planTreatmentData.map(tc => {
      const info = treatmentLookup.get(tc.treatment);
      const privatePrice = asNumber(info?.private_price) || asNumber(info?.price);
      const membershipRevTotal = Math.round(tc.revenuePerUnit * tc.treatmentCount);
      const privateRevTotal = Math.round(privatePrice * tc.treatmentCount);
      const capturePct = privateRevTotal > 0 ? Math.round((membershipRevTotal / privateRevTotal) * 100) : 0;
      const captureWarning = capturePct === 0 && privateRevTotal > 0;

      // Determine type: Included if revenue is 0, otherwise calculate discount %
      let type = 'Included';
      if (tc.revenuePerUnit > 0 && privatePrice > 0) {
        const discountPct = Math.round((1 - tc.revenuePerUnit / privatePrice) * 100);
        type = discountPct > 0 ? `${discountPct}% off` : 'Full price';
      } else if (tc.revenuePerUnit > 0) {
        type = 'Charged';
      }

      // Timing
      const durationMin = asNumber(info?.duration_minutes);
      const avgTimeMin = asNumber(info?.average_time_minutes) || durationMin;

      // Margin: map hook's 'Watch' → UI's 'Monitor'
      const margin: TreatmentBreakdownRow['margin'] =
        tc.marginImpact === 'Concern' ? 'Concern' :
        tc.marginImpact === 'Watch' ? 'Monitor' : 'Healthy';

      return {
        treatment: tc.treatment,
        category: tc.categoryName || 'Other',
        type,
        volPerMonth: tc.treatmentCount,
        membershipRev: membershipRevTotal,
        privateRev: privateRevTotal,
        capturePct,
        captureWarning,
        avgTime: avgTimeMin > 0 ? `${avgTimeMin}m` : '-',
        benchmark: durationMin > 0 ? `${durationMin}m` : '-',
        margin,
        benchmarkMin: durationMin,
        overrunMin: Math.max(0, avgTimeMin - durationMin),
      };
    });
  }, [planTreatmentData, treatmentLookup]);

  // Revenue chart data — only treatments with revenue or private equivalent
  const revenueChartData = useMemo(() => {
    return treatmentBreakdown
      .filter(t => t.membershipRev > 0 || t.privateRev > 0)
      .slice(0, 10)
      .map(t => ({
        treatment: t.treatment.length > 14 ? t.treatment.substring(0, 12) + '...' : t.treatment,
        membershipRev: t.membershipRev,
        revenueGap: Math.max(0, t.privateRev - t.membershipRev),
      }));
  }, [treatmentBreakdown]);

  // Chair time data — only treatments with benchmark time
  const chairTimeData = useMemo(() => {
    return treatmentBreakdown
      .filter(t => t.benchmarkMin > 0 && t.volPerMonth > 0)
      .slice(0, 10)
      .map(t => ({
        treatment: t.treatment.length > 14 ? t.treatment.substring(0, 12) + '...' : t.treatment,
        benchmark: t.benchmarkMin,
        overrun: t.overrunMin,
      }));
  }, [treatmentBreakdown]);

  // Dynamic recommendations based on real data
  const recommendations: Recommendation[] = useMemo(() => {
    const recs: Recommendation[] = [];
    const members = uploadedPlan?.members ?? 0;

    for (const t of treatmentBreakdown) {
      // Time overrun recommendations
      if (t.overrunMin > 0 && t.volPerMonth >= 3) {
        const savedMins = t.overrunMin * t.volPerMonth;
        const savedCost = Math.round(savedMins * (300 / 60));
        recs.push({
          title: `Reduce ${t.treatment} overrun time`,
          description: `${t.treatment} averages ${t.avgTime} vs ${t.benchmark} benchmark. Reducing overrun saves ${savedMins} mins/month (${(savedMins / 60).toFixed(1)} chair hours).`,
          impact: savedCost > 1000 ? 'high' : savedCost > 300 ? 'medium' : 'low',
          savings: `+£${savedCost.toLocaleString()}`,
          savingsNum: savedCost,
        });
      }

      // High-volume included treatments (> 2x per member)
      if (t.type === 'Included' && members > 0 && t.volPerMonth > members * 2 && t.privateRev > 0) {
        const avgUsage = (t.volPerMonth / members).toFixed(1);
        const savingsEstimate = Math.round(t.privateRev * 0.2);
        recs.push({
          title: `Cap ${t.treatment} to 2x/year`,
          description: `Current usage is ${avgUsage}x/member. Capping to 2x saves approximately £${savingsEstimate.toLocaleString()}/month in costs.`,
          impact: savingsEstimate > 1000 ? 'high' : savingsEstimate > 300 ? 'medium' : 'low',
          savings: `+£${savingsEstimate.toLocaleString()}`,
          savingsNum: savingsEstimate,
        });
      }

      // Concern margin treatments
      if (t.margin === 'Concern' && t.membershipRev > 0 && t.volPerMonth >= 3) {
        const gapPerUnit = t.privateRev > 0 ? Math.round((t.privateRev - t.membershipRev) / t.volPerMonth) : 0;
        if (gapPerUnit > 0) {
          const savingsEstimate = Math.round(gapPerUnit * 0.5 * t.volPerMonth);
          recs.push({
            title: `Review ${t.treatment} discount`,
            description: `Revenue gap of £${gapPerUnit}/unit. Reducing discount by 5% recovers approximately £${savingsEstimate.toLocaleString()}/month.`,
            impact: savingsEstimate > 500 ? 'medium' : 'low',
            savings: `+£${savingsEstimate.toLocaleString()}`,
            savingsNum: savingsEstimate,
          });
        }
      }
    }

    return recs
      .sort((a, b) => b.savingsNum - a.savingsNum)
      .slice(0, 5);
  }, [treatmentBreakdown, uploadedPlan?.members]);

  // Computed KPI values
  const totalMembershipRev = treatmentBreakdown.reduce((s, t) => s + t.membershipRev, 0);
  const totalPrivateRev = treatmentBreakdown.reduce((s, t) => s + t.privateRev, 0);
  const revenueCapturePct = totalPrivateRev > 0 ? Math.round((totalMembershipRev / totalPrivateRev) * 100) : 0;

  const totalRevenueLeakage = Math.max(0, totalPrivateRev - totalMembershipRev);

  // Weight by volume for accurate total
  const totalBenchmarkMin = treatmentBreakdown.reduce((s, t) => s + t.benchmarkMin * t.volPerMonth, 0);
  const totalActualMin = treatmentBreakdown.reduce((s, t) => s + (t.benchmarkMin + t.overrunMin) * t.volPerMonth, 0);
  const totalOverrunMin = Math.max(0, totalActualMin - totalBenchmarkMin);
  const overrunCost = Math.round(totalOverrunMin * (300 / 60));

  const totalSavings = recommendations.reduce((s, r) => s + r.savingsNum, 0);

  const planName = uploadedPlan?.fee_category ?? slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const members = uploadedPlan?.members ?? 0;
  const subscriptionRevenue = uploadedPlan ? Math.round(uploadedPlan.total_net_due) : 0;
  const costs = totalMembershipRev > 0 ? totalMembershipRev : 0; // treatment cost from TPI prices
  const netPosition = subscriptionRevenue - costs;

  const planMembers = useMemo(() => {
    if (!uploadedPlan) return [];
    const groupKey = uploadedPlan.fee_category.toLowerCase();
    const mappedId = uploadedPlan.mapped_plan_id ?? null;
    const isUnmappedBucket = !mappedId && groupKey === 'unmapped';
    return uploadedMembers.filter((m) => {
      if (mappedId) return m.mapped_plan_id === mappedId;
      if (isUnmappedBucket) return !m.mapped_plan_id;
      return m.mapped_plan_name && m.mapped_plan_name.toLowerCase() === groupKey;
    });
  }, [uploadedMembers, uploadedPlan]);

  const planPatientIds = useMemo(
    () => Array.from(new Set(planMembers.map((m) => m.patient_id).filter((x): x is string => !!x))),
    [planMembers],
  );

  const { data: patientNameMap = {} } = useQuery({
    queryKey: ['plan-member-patient-names', planPatientIds],
    enabled: planPatientIds.length > 0,
    queryFn: async () => {
      const map: Record<string, { first: string | null; last: string | null; title: string | null }> = {};
      const chunkSize = 500;
      for (let i = 0; i < planPatientIds.length; i += chunkSize) {
        const chunk = planPatientIds.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from('patients')
          .select('pt_id, pt_first_name, pt_last_name, pt_title')
          .in('pt_id', chunk);
        if (error) throw error;
        (data ?? []).forEach((p: any) => {
          map[p.pt_id] = { first: p.pt_first_name, last: p.pt_last_name, title: p.pt_title };
        });
      }
      return map;
    },
  });

  const filteredPlanMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return planMembers;
    return planMembers.filter((m) => {
      const hay = [m.title, m.initial, m.surname, m.treating_dentist, m.dob]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [planMembers, memberSearch]);

  const planMembersTotalPages = Math.max(
    1,
    Math.ceil(filteredPlanMembers.length / MEMBERS_PAGE_SIZE),
  );
  const planMembersPage = Math.min(memberPage, planMembersTotalPages);
  const pagedPlanMembers = filteredPlanMembers.slice(
    (planMembersPage - 1) * MEMBERS_PAGE_SIZE,
    planMembersPage * MEMBERS_PAGE_SIZE,
  );

  const summaryCards = [
    { label: 'MEMBERS', value: members.toLocaleString(), sub: uploadedPlan ? `${uploadedPlan.avg_discount}% avg discount` : '-', subIcon: Clock },
    { label: 'SUBSCRIPTION REVENUE', value: formatCurrency(subscriptionRevenue), sub: `${members} members • uploaded` },
    { label: 'REVENUE CAPTURE', value: `${revenueCapturePct}%`, sub: 'vs private pricing', highlight: 'teal' as const },
    { label: 'NET POSITION', value: `${netPosition >= 0 ? '+' : '-'}${formatCurrency(Math.abs(netPosition))}`, sub: '/month', highlight: (netPosition >= 0 ? 'teal' : 'red') as const },
    { label: 'TIME OVERRUN', value: formatMinutes(totalOverrunMin), sub: 'wasted/month', highlight: 'red' as const },
  ];

  // Build AI context for chatbot — single-plan detail
  const aiTreatmentRows = (treatmentBreakdown || []).slice(0, 60).map(t => ({
    treatment: t.treatment,
    category: t.category,
    type: t.type,
    volumePerMonth: t.volPerMonth,
    membershipRevenue: t.membershipRev,
    privateRevenue: t.privateRev,
    capturePercent: t.capturePct,
    avgTimeMinutes: t.benchmarkMin + t.overrunMin,
    benchmarkMinutes: t.benchmarkMin,
    overrunMinutes: t.overrunMin,
    margin: t.margin,
  }));
  const topTreatmentsByVolume = [...aiTreatmentRows].sort((a, b) => b.volumePerMonth - a.volumePerMonth).slice(0, 10);
  const topTreatmentsByLeakage = [...aiTreatmentRows]
    .map(t => ({ ...t, leakage: Math.max(0, t.privateRevenue - t.membershipRevenue) }))
    .sort((a, b) => b.leakage - a.leakage)
    .slice(0, 10);

  const aiContextData = {
    page: 'membership-plan-detail',
    planId: mappedDbPlan?.id ?? slug,
    planName,
    planSlug: slug,
    selectedLocationName: 'All Locations',
    summary: {
      members,
      subscriptionRevenue,
      treatmentMembershipRevenue: totalMembershipRev,
      treatmentPrivateRevenue: totalPrivateRev,
      revenueCapturePercent: revenueCapturePct,
      revenueLeakage: totalRevenueLeakage,
      netPosition,
      totalBenchmarkMinutes: totalBenchmarkMin,
      totalActualMinutes: totalActualMin,
      totalOverrunMinutes: totalOverrunMin,
      overrunCost,
      monthlyFee: mappedDbPlan?.monthlyFee ?? null,
      mappedDbPlanMembers: mappedPlanMemberCount,
      isMappedToDbPlan: !!uploadedPlan?.mapped_plan_id,
    },
    treatmentCount: treatmentBreakdown?.length ?? 0,
    treatments: aiTreatmentRows,
    topTreatmentsByVolume,
    topTreatmentsByLeakage,
    recommendations: (recommendations || []).slice(0, 10).map(r => ({
      title: r.title,
      description: r.description,
      impact: r.impact,
      savingsPerMonth: r.savingsNum,
    })),
    totalPotentialSavings: totalSavings,
  };

  if (isMappedLoading || isUploadLoading) {
    return (
      <MainLayout userRole="admin" aiContext={aiContextData}>
        <Helmet><title>Membership Plan | DentPulse</title></Helmet>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  if (!uploadedPlan) {
    return (
      <MainLayout userRole="admin" aiContext={aiContextData}>
        <Helmet><title>Membership Plan | DentPulse</title></Helmet>
        <div className="space-y-6 pt-6">
          <div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
              <Link to="/treatments/insights" className="hover:text-foreground">Treatment</Link>
              <span>/</span>
              <Link to="/treatments/membership" className="hover:text-foreground">Membership</Link>
              <span>/</span>
              <span className="text-foreground font-medium">{slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
            </div>
          </div>
          <Card>
            <CardContent className="py-16 text-center">
              <p className="text-muted-foreground">No uploaded data found for this plan.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Upload membership data on the <Link to="/treatments/membership" className="text-primary underline">Membership</Link> page first.
              </p>
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout userRole="admin" aiContext={aiContextData}>
      <Helmet><title>{planName} | Membership | DentPulse</title></Helmet>

      <div className="space-y-6 pt-6">
        {/* Breadcrumb + Header */}
        <div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
            <Link to="/treatments/insights" className="hover:text-foreground">Treatment</Link>
            <span>/</span>
            <Link to="/treatments/membership" className="hover:text-foreground">Membership</Link>
            <span>/</span>
            <span className="text-foreground font-medium">{planName}</span>
          </div>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">{planName}</h1>
              <p className="text-muted-foreground">Treatment performance, revenue leakage & improvement opportunities</p>
              {mappedDbPlan && (
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Monthly fee: <span className="font-medium text-foreground">{formatCurrency(mappedDbPlan.monthlyFee)}</span></span>
                  <span>Exams included: <span className="font-medium text-foreground">{mappedDbPlan.examAppointmentsIncluded}</span></span>
                  <span>Hygiene included: <span className="font-medium text-foreground">{mappedDbPlan.hygieneAppointmentsIncluded}</span></span>
                  <span>DB plan members: <span className="font-medium text-foreground">{mappedPlanMemberCount}</span></span>
                </div>
              )}
              {!uploadedPlan?.mapped_plan_id && (
                <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  This fee category is not mapped to a DB plan — re-import and select a plan in the mapping step to load details.
                </div>
              )}
            </div>
            <Link
              to="/treatments/membership"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Plans
            </Link>
          </div>
        </div>

        {/* Summary KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {summaryCards.map((card) => {
            const isMembersCard = card.label === 'MEMBERS';
            return (
              <Card
                key={card.label}
                className={cn(
                  'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800',
                  isMembersCard && 'cursor-pointer transition hover:border-primary hover:shadow-sm',
                )}
                onClick={isMembersCard ? () => {
                  setMemberSearch('');
                  setMemberPage(1);
                  setIsMembersOpen(true);
                } : undefined}
              >
                <CardContent className="pt-4 pb-3">
                  <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">{card.label}</span>
                  <div className={cn(
                    'text-2xl font-bold mt-1',
                    card.highlight === 'teal' ? 'text-teal-600 dark:text-teal-400' :
                    card.highlight === 'red' ? 'text-red-600 dark:text-red-400' : 'text-foreground',
                  )}>
                    {card.value}
                  </div>
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    {card.subIcon && <card.subIcon className="w-3 h-3" />}
                    {card.sub}
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Dialog open={isMembersOpen} onOpenChange={setIsMembersOpen}>
          <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>{planName} — Members ({planMembers.length})</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Members currently on this plan for the selected month & location.
              </p>
            </DialogHeader>
            <div className="flex-1 overflow-auto">
              <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
                <Input
                  placeholder="Search member, DoB, dentist…"
                  value={memberSearch}
                  onChange={(e) => { setMemberSearch(e.target.value); setMemberPage(1); }}
                  className="h-8 w-64"
                />
                <div className="ml-auto text-sm text-muted-foreground">
                  {filteredPlanMembers.length} of {planMembers.length} member{planMembers.length === 1 ? '' : 's'}
                </div>
              </div>
              <div className="border rounded-md overflow-hidden">
                <Table className="border-collapse [&_th]:border [&_td]:border [&_th]:border-border [&_td]:border-border">
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>DoB</TableHead>
                      <TableHead className="text-right">Age</TableHead>
                      <TableHead className="text-right">Pay Grp Size</TableHead>
                      <TableHead>Treating Dentist</TableHead>
                      <TableHead>Fee Category</TableHead>
                      <TableHead className="text-right">Discount %</TableHead>
                      <TableHead className="text-right">Net Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedPlanMembers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">
                          {planMembers.length === 0 ? 'No members on this plan yet.' : 'No members match the search.'}
                        </TableCell>
                      </TableRow>
                    ) : pagedPlanMembers.map((m) => {
                      const initialLetter = m.initial ? `${m.initial.charAt(0).toUpperCase()}.` : '';
                      const memberLabel = [m.title, initialLetter, m.surname].filter(Boolean).join(' ') || m.surname;
                      const pt = m.patient_id ? patientNameMap[m.patient_id] : null;
                      const fullName = pt
                        ? [pt.title ?? m.title, pt.first, pt.last ?? m.surname].filter(Boolean).join(' ')
                        : memberLabel;
                      const formatDob = (d: string | null) => {
                        if (!d) return '—';
                        const dt = new Date(d);
                        if (isNaN(dt.getTime())) return d;
                        return `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`;
                      };
                      let age: number | null = null;
                      if (m.dob) {
                        const d = new Date(m.dob);
                        if (!isNaN(d.getTime())) {
                          const now = new Date();
                          age = now.getFullYear() - d.getFullYear();
                          const mDiff = now.getMonth() - d.getMonth();
                          if (mDiff < 0 || (mDiff === 0 && now.getDate() < d.getDate())) age -= 1;
                        }
                      }
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="font-medium">
                            <UITooltipProvider delayDuration={150}>
                              <UITooltip>
                                <UITooltipTrigger asChild>
                                  <span className="cursor-default">{memberLabel}</span>
                                </UITooltipTrigger>
                                <UITooltipContent side="top">{fullName}</UITooltipContent>
                              </UITooltip>
                            </UITooltipProvider>
                          </TableCell>
                          <TableCell>{formatDob(m.dob)}</TableCell>
                          <TableCell className="text-right">{age ?? '—'}</TableCell>
                          <TableCell className="text-right">{m.pay_grp_size ?? '—'}</TableCell>
                          <TableCell>{m.treating_dentist ?? '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{m.fee_category}</Badge>
                          </TableCell>
                          <TableCell className="text-right">{m.discount_percent}%</TableCell>
                          <TableCell className="text-right">£{m.net_due.toFixed(2)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {filteredPlanMembers.length > MEMBERS_PAGE_SIZE && (
                <div className="flex items-center justify-between mt-2 text-sm text-muted-foreground px-1">
                  <span>
                    Showing {(planMembersPage - 1) * MEMBERS_PAGE_SIZE + 1}–{Math.min(planMembersPage * MEMBERS_PAGE_SIZE, filteredPlanMembers.length)} of {filteredPlanMembers.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      disabled={planMembersPage <= 1}
                      onClick={() => setMemberPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <span className="px-2 text-xs">Page {planMembersPage} / {planMembersTotalPages}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      disabled={planMembersPage >= planMembersTotalPages}
                      onClick={() => setMemberPage((p) => Math.min(planMembersTotalPages, p + 1))}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsMembersOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Membership Revenue vs Private Potential */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold">Membership Revenue vs Private Potential</CardTitle>
            <p className="text-sm text-muted-foreground">How much revenue each treatment generates under this plan vs what it would earn privately</p>
          </CardHeader>
          <CardContent>
            {revenueChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={revenueChartData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="treatment"
                    axisLine={false}
                    tickLine={false}
                    fontSize={11}
                    angle={-35}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    fontSize={12}
                    tickFormatter={(v: number) => formatCompact(v)}
                  />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                    formatter={(value: string) => <span className="text-muted-foreground">{value}</span>}
                  />
                  <Bar dataKey="membershipRev" name="Membership Revenue" fill="#1e3a5f" radius={[2, 2, 0, 0]} barSize={28} />
                  <Bar dataKey="revenueGap" name="Revenue Gap" fill="#ef4444" radius={[2, 2, 0, 0]} barSize={28} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                No revenue comparison data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Treatment Performance Breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold">Treatment Performance Breakdown</CardTitle>
            <p className="text-sm text-muted-foreground">Per-treatment revenue collected, private equivalent, capture rate, time and margin</p>
          </CardHeader>
          <CardContent className="px-0">
            {treatmentBreakdown.length > 0 ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Treatment</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Vol / Month</TableHead>
                      <TableHead className="text-right">Membership Rev</TableHead>
                      <TableHead className="text-right">Private Rev</TableHead>
                      <TableHead className="text-center">Capture %</TableHead>
                      <TableHead className="text-right">Avg Time</TableHead>
                      <TableHead className="text-right">Benchmark</TableHead>
                      <TableHead className="text-right pr-6">Margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {treatmentBreakdown.map((row) => (
                      <TableRow key={row.treatment}>
                        <TableCell className="pl-6 font-medium">{row.treatment}</TableCell>
                        <TableCell className="text-muted-foreground">{row.category}</TableCell>
                        <TableCell className="text-right">{row.volPerMonth}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.membershipRev)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.privateRev)}</TableCell>
                        <TableCell className="text-center">
                          <CaptureBadge pct={row.capturePct} warning={row.captureWarning} />
                        </TableCell>
                        <TableCell className="text-right">{row.avgTime}</TableCell>
                        <TableCell className="text-right">{row.benchmark}</TableCell>
                        <TableCell className="text-right pr-6"><MarginBadge margin={row.margin} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between px-6 pt-4 text-sm text-muted-foreground border-t mt-2">
                  <span>Revenue leakage: <span className="text-red-600 font-semibold">{formatCurrency(totalRevenueLeakage)}/month</span> vs private pricing</span>
                  <span>Subscription income offsets: <span className="font-semibold text-foreground">{formatCurrency(subscriptionRevenue)}/month</span></span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                No treatment data available for this plan
              </div>
            )}
          </CardContent>
        </Card>

        {/* Chair Time Analysis */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold">Chair Time Analysis</CardTitle>
            <p className="text-sm text-muted-foreground">Actual time vs benchmark — overruns directly reduce profitability</p>
          </CardHeader>
          <CardContent>
            {chairTimeData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chairTimeData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="treatment"
                      axisLine={false}
                      tickLine={false}
                      fontSize={11}
                      angle={-35}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      fontSize={12}
                      tickFormatter={(v: number) => `${v}m`}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) => [`${value}m`, name]}
                      contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                      formatter={(value: string) => <span className="text-muted-foreground">{value}</span>}
                    />
                    <Bar dataKey="benchmark" name="Benchmark" stackId="stack" fill="#1e3a5f" radius={[0, 0, 0, 0]} barSize={32} />
                    <Bar dataKey="overrun" name="Overrun" stackId="stack" fill="#14b8a6" radius={[2, 2, 0, 0]} barSize={32} />
                  </BarChart>
                </ResponsiveContainer>

                {/* Summary stats */}
                <div className="grid grid-cols-3 gap-6 mt-4 pt-4 border-t">
                  <div>
                    <span className="text-sm text-muted-foreground">Total Chair Time / Month</span>
                    <div className="text-xl font-bold">{formatMinutes(totalActualMin)}</div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Benchmark Total</span>
                    <div className="text-xl font-bold">{formatMinutes(totalBenchmarkMin)}</div>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Overrun Cost (@ £300/hr)</span>
                    <div className="text-xl font-bold text-red-600">{formatCurrency(overrunCost)}</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                No chair time data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Improvement Recommendations */}
        {recommendations.length > 0 && (
          <div>
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Improvement Recommendations</h2>
              <p className="text-sm text-muted-foreground">{recommendations.length} actions identified — potential savings of {formatCurrency(totalSavings)}/month</p>
            </div>
            <div className="space-y-3">
              {recommendations.map((rec, i) => (
                <div key={i} className="rounded-lg border p-4 flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <Lightbulb className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">{rec.title}</span>
                        <ImpactBadge impact={rec.impact} />
                      </div>
                      <p className="text-sm text-muted-foreground">{rec.description}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <span className="text-lg font-bold text-teal-600">{rec.savings}</span>
                    <div className="text-xs text-muted-foreground">/month</div>
                  </div>
                </div>
              ))}

              {/* Total potential */}
              <div className="rounded-lg border border-teal-200 bg-teal-50 dark:bg-teal-950/20 dark:border-teal-800 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-teal-600 shrink-0" />
                  <div>
                    <span className="font-semibold">Total potential improvement</span>
                    <p className="text-sm text-muted-foreground">If all recommendations are implemented</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold text-teal-600">+{formatCurrency(totalSavings)}/mo</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
