import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Check, AlertTriangle, ChevronDown, FileText, Upload, Info, Download, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEbitdaValuation } from '@/hooks/useEbitdaValuation';
import { useAllProvidersNetProduction } from '@/hooks/useAllProvidersNetProduction';
import { useFilters } from '@/contexts/FilterContext';

import { useDueDiligenceDocuments, DOCUMENT_TAGS, type DocumentTag } from '@/hooks/useDueDiligenceDocuments';
import { useAIBuyerQuestions } from '@/hooks/useAIBuyerQuestions';

function InfoTip({ description, calculation, light }: { description: string; calculation: string; light?: boolean }) {
  return (
    <UITooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button className={cn('flex-shrink-0 transition-colors ml-1 align-middle', light ? 'text-white/40 hover:text-white/80' : 'text-muted-foreground/50 hover:text-primary')} type="button">
          <Info className="w-3 h-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="w-[300px] p-3 shadow-lg border bg-popover z-[100]">
        <p className="text-[11px] font-medium text-popover-foreground mb-1.5 whitespace-normal break-words">{description}</p>
        <p className="text-[10px] text-muted-foreground font-mono leading-relaxed whitespace-normal break-words">{calculation}</p>
      </TooltipContent>
    </UITooltip>
  );
}

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

const formatCompact = formatCurrency;

interface ChecklistItem {
  id: string;
  text: string;
  evidence: string;
  checked: boolean;
}

interface ChecklistSection {
  id: string;
  title: string;
  color: string;
  letter: string;
  items: ChecklistItem[];
  open: boolean;
}

export function DueDiligenceContent() {
  const { valuation: d, isLoading } = useEbitdaValuation();
  const { dateRange, selectedLocationId } = useFilters();
  const providerProduction = useAllProvidersNetProduction(null, dateRange.startDate, dateRange.endDate, selectedLocationId);

  // Document Vault state
  const [selectedTag, setSelectedTag] = useState<DocumentTag | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { documents, tagCounts, isUploading, uploadDocument, deleteDocument, isDeleting, downloadDocument } = useDueDiligenceDocuments(selectedTag);
  const { questions: aiQuestions, isLoading: questionsLoading, error: questionsError, generateQuestions } = useAIBuyerQuestions();
  const questionsRequested = useRef(false);

  const handleTagClick = (tagValue: DocumentTag) => {
    setSelectedTag(prev => prev === tagValue ? null : tagValue);
  };

  const handleFileUpload = useCallback((file: File) => {
    const tag = selectedTag || 'xero-export';
    uploadDocument({ file, tag });
  }, [selectedTag, uploadDocument]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Checklist state
  const [sections, setSections] = useState<ChecklistSection[]>([
    {
      id: 'financial', title: 'Financial', color: 'bg-warning', letter: 'A', open: true,
      items: [
        { id: 'f1', text: 'EBITDA Adjustments — owner salary add-back', evidence: 'Evidence needed: payroll run', checked: false },
        { id: 'f2', text: 'Lab integrity reallocation', evidence: 'Evidence needed: associate contracts + lab invoices', checked: false },
        { id: 'f3', text: 'NHS Revenue validation', evidence: 'Evidence needed: monthly NHS statements + UDA reconciliation', checked: false },
        { id: 'f4', text: 'Cash Conversion — bank statements', evidence: 'Verified via bank statements', checked: true },
      ],
    },
    {
      id: 'clinical', title: 'Clinical', color: 'bg-success', letter: 'B', open: true,
      items: [
        { id: 'c1', text: 'Associate dependency — top provider contracts + notice periods', evidence: 'Evidence needed: signed employment contracts', checked: false },
        { id: 'c2', text: 'Chair utilisation — appointment logs', evidence: 'Verified via PMS', checked: true },
        { id: 'c3', text: 'Treatment mix — PMS reports', evidence: 'Verified via PMS reports', checked: true },
      ],
    },
    {
      id: 'nhs', title: 'NHS Sentinel', color: 'bg-danger', letter: 'C', open: true,
      items: [
        { id: 'n1', text: 'UDA delivery vs target — HIGH RISK', evidence: 'Clawback at risk. NHS reconciliation required immediately.', checked: false },
        { id: 'n2', text: 'Clawback provision — needs reconciliation', evidence: 'Contact NHS England for year-end statement', checked: false },
        { id: 'n3', text: 'Year-end NHS statement', evidence: 'Evidence needed: official NHS statement', checked: false },
      ],
    },
  ]);

  const toggleCheck = (sectionId: string, itemId: string) => {
    setSections(prev => prev.map(s =>
      s.id === sectionId ? { ...s, items: s.items.map(i => i.id === itemId ? { ...i, checked: !i.checked } : i) } : s
    ));
  };

  const toggleSection = (sectionId: string) => {
    setSections(prev => prev.map(s =>
      s.id === sectionId ? { ...s, open: !s.open } : s
    ));
  };

  const ddData = useMemo(() => {
    if (!d) return null;

    const totalItems = sections.reduce((s, sec) => s + sec.items.length, 0);
    const checkedItems = sections.reduce((s, sec) => s + sec.items.filter(i => i.checked).length, 0);
    const completePct = Math.round(checkedItems / totalItems * 100);

    // Critical issues from data
    const criticalIssues: Array<{ severity: 'red' | 'amber'; title: string; description: string }> = [];

    // NHS clawback
    const nhsDrivers = d.sustainability.items.filter(i => i.label.toLowerCase().includes('nhs') || i.label.toLowerCase().includes('uda'));
    if (nhsDrivers.length > 0) {
      const clawback = nhsDrivers.reduce((s, i) => s + Math.abs(i.value), 0);
      criticalIssues.push({
        severity: 'red',
        title: `NHS Clawback Exposure ${formatCompact(clawback)} — Not validated`,
        description: 'UDA delivery triggers clawback. Buyer will require year-end NHS statement and reconciliation.',
      });
    }

    // Lab cost
    const labItems = d.normalisationItems.filter(i => i.label.toLowerCase().includes('lab'));
    if (labItems.length > 0) {
      criticalIssues.push({
        severity: 'red',
        title: `Lab Cost Misallocation ${formatCompact(labItems.reduce((s, i) => s + Math.abs(i.value), 0))} — Not documented`,
        description: 'Associate contracts and lab invoices not provided. Buyer will challenge this add-back in full.',
      });
    }

    // Associate dependency
    const depFactor = d.multiple.waterfall.find(f => f.label.toLowerCase().includes('assoc'));
    if (depFactor && depFactor.value <= -0.3) {
      criticalIssues.push({
        severity: 'amber',
        title: 'Top Associate — high revenue concentration, at risk',
        description: `Significant revenue on short notice. Buyer will request escrow or price chip.`,
      });
    }

    // Cash conversion
    const cashConvScore = d.quality.scores.find(s => s.label === 'Cash Conversion')?.value ?? 70;
    if (cashConvScore < 70) {
      criticalIssues.push({
        severity: 'amber',
        title: `Cash Conversion ${(d.qualityInputs.paidInvoiceRate * 100).toFixed(0)}% — Below benchmark`,
        description: 'Below 90% benchmark. Buyer will investigate and request debtor aging report.',
      });
    }

    // Associate stickiness — real provider data sorted by revenue
    const providers = (providerProduction.data?.providers ?? [])
      .slice()
      .sort((a, b) => b.total - a.total);
    const totalProviderRevenue = providers.reduce((s, p) => s + p.total, 0);
    const associates = providers.slice(0, 5).map((p) => {
      const pct = totalProviderRevenue > 0 ? Math.round(p.total / totalProviderRevenue * 100) : 0;
      const score = pct > 30 ? 25 : pct > 20 ? 45 : pct > 15 ? 65 : pct > 10 ? 80 : 95;
      const status = score >= 80 ? 'green' as const : score >= 60 ? 'amber' as const : 'red' as const;
      return {
        name: p.providerName,
        revenue: p.total,
        pct,
        notice: '—',
        covenant: false,
        score,
        status,
      };
    });

    // Buyer questions — populated by AI via edge function
    const buyerQuestions = aiQuestions.length > 0
      ? aiQuestions.map(q => q.startsWith('"') ? q : `"${q}"`)
      : [];

    // If resolved
    const resolvedEbitda = d.sustainableEBITDA + nhsDrivers.reduce((s, i) => s + Math.abs(i.value), 0);
    const resolvedMult = Math.min(8.0, d.multiple.finalMultiple + 0.9);
    const resolvedEV = resolvedEbitda * resolvedMult;

    // Scan summary for tooltips
    const scanSummary = {
      nhsFound: nhsDrivers.length > 0,
      nhsClawback: nhsDrivers.reduce((s, i) => s + Math.abs(i.value), 0),
      labFound: labItems.length > 0,
      labAmount: labItems.reduce((s, i) => s + Math.abs(i.value), 0),
      assocPenalty: depFactor?.value ?? 0,
      cashConvPct: (d.qualityInputs.paidInvoiceRate * 100),
    };

    return {
      completePct, totalItems, checkedItems,
      criticalCount: criticalIssues.filter(i => i.severity === 'red').length + criticalIssues.filter(i => i.severity === 'amber').length,
      criticalIssues, associates, buyerQuestions,
      resolved: { ebitda: resolvedEbitda, multiple: resolvedMult, ev: resolvedEV, uplift: resolvedEV - d.enterpriseValue },
      scanSummary,
    };
  }, [d, sections, providerProduction.data, aiQuestions]);

  // Auto-generate AI buyer questions when valuation data is ready
  useEffect(() => {
    if (d && !questionsRequested.current) {
      questionsRequested.current = true;
      const providers = (providerProduction.data?.providers ?? []).sort((a, b) => b.total - a.total);
      const totalProviderRevenue = providers.reduce((s, p) => s + p.total, 0);
      const topProvider = providers[0];
      generateQuestions({
        totalRevenue: d.totalRevenue,
        sustainableEBITDA: d.sustainableEBITDA,
        reportedEBITDA: d.reportedEBITDA,
        enterpriseValue: d.enterpriseValue,
        multiple: d.multiple.finalMultiple,
        qualityScore: d.quality.finalScore,
        staffCosts: d.staffCosts,
        labFees: d.labFees,
        overheads: d.overheads,
        paidInvoiceRate: (d.qualityInputs.paidInvoiceRate * 100).toFixed(0) + '%',
        privateRevenuePct: d.qualityInputs.privateRevenuePct.toFixed(0) + '%',
        avgUtilisationPct: d.qualityInputs.avgUtilisationPct.toFixed(0) + '%',
        udaDeliveryPct: d.qualityInputs.udaDeliveryPct != null ? d.qualityInputs.udaDeliveryPct.toFixed(0) + '%' : 'No NHS contract',
        topProviderName: topProvider?.providerName ?? 'Unknown',
        topProviderRevenuePct: totalProviderRevenue > 0 && topProvider
          ? Math.round(topProvider.total / totalProviderRevenue * 100) + '%' : '0%',
        normalisationAddBacks: d.normalisationItems.map(i => ({ label: i.label, value: i.value })),
        sustainabilityHaircuts: d.sustainability.items.map(i => ({ label: i.label, value: i.value })),
        waterfallPenalties: d.multiple.waterfall.filter(f => f.value < 0).map(f => ({ label: f.label, penalty: f.value })),
      });
    }
  }, [d, providerProduction.data, generateQuestions]);

  if (isLoading || !d || !ddData) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48 mb-2" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-60 w-full rounded-lg" />
      </div>
    );
  }

  return (
      <div className="space-y-3.5">

        {/* Page Header */}
        <div>
          <h1 className="text-xl font-bold text-foreground">Due Diligence Engine&trade;</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Checklist, critical issues and buyer question preparation</p>
        </div>

        {/* Status Header */}
        <Card className="bg-foreground text-white p-5">
          <div className="grid grid-cols-[1fr_auto] gap-4 items-center">
            <div>
              <div className="text-[9.5px] font-bold uppercase tracking-widest text-white/50 mb-1.5">
                Due Diligence Readiness
                <InfoTip light description="Overall progress through the due diligence checklist — percentage of evidence items that have been verified." calculation={`${ddData.checkedItems} / ${ddData.totalItems} items = ${ddData.completePct}%`} />
              </div>
              <div className="flex items-center gap-3">
                <div className="text-[22px] font-bold">🟠 In Progress</div>
                <span className="text-[10px] font-bold bg-amber-500/30 text-amber-300 px-2 py-0.5 rounded">{ddData.completePct}% Complete</span>
              </div>
              <div className="mt-2.5 h-1.5 bg-white/10 rounded-full overflow-hidden w-80">
                <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${ddData.completePct}%` }} />
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-white/40 mb-1">Critical Issues
                <InfoTip light description="Number of issues auto-detected from your data that a buyer will flag during due diligence." calculation={`${ddData.criticalIssues.filter(i => i.severity === 'red').length} red + ${ddData.criticalIssues.filter(i => i.severity === 'amber').length} amber = ${ddData.criticalCount} issues detected.`} />
              </div>
              <div className="text-[36px] font-bold text-red-400">{ddData.criticalCount}</div>
            </div>
          </div>
        </Card>

        {/* Critical Issues */}
        <Card className="p-4">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Critical Issues — Auto-Generated from Data
            <InfoTip description="Issues automatically detected from your financial data, PMS data, and EBITDA model — these are what a buyer's advisors will flag." calculation={`Scanned: NHS clawback (${ddData.scanSummary.nhsFound ? formatCompact(ddData.scanSummary.nhsClawback) : 'clear'}), lab add-backs (${ddData.scanSummary.labFound ? formatCompact(ddData.scanSummary.labAmount) : 'clear'}), associate penalty (${ddData.scanSummary.assocPenalty < -0.2 ? ddData.scanSummary.assocPenalty + 'x' : 'ok'}), cash conversion (${ddData.scanSummary.cashConvPct.toFixed(0)}%).`} />
          </div>
          <div className="space-y-1.5">
            {ddData.criticalIssues.map((issue, i) => (
              <div key={i} className={cn('flex items-start gap-2.5 p-2.5 rounded-md', issue.severity === 'red' ? 'bg-danger/5' : 'bg-warning/5')}>
                <span className="text-base flex-shrink-0 leading-none mt-0.5">{issue.severity === 'red' ? '🔴' : '🟠'}</span>
                <div>
                  <div className={cn('text-[12.5px] font-semibold', issue.severity === 'red' ? 'text-danger' : 'text-warning')}>{issue.title}</div>
                  <div className={cn('text-[11px] mt-0.5', issue.severity === 'red' ? 'text-danger/80' : 'text-warning/80')}>{issue.description}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Checklists */}
        <Card className="p-4">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Due Diligence Checklist</div>
          <div className="space-y-4">
            {sections.map(section => {
              const checkedCount = section.items.filter(i => i.checked).length;
              return (
                <div key={section.id}>
                  <div className="flex justify-between items-center py-2 border-b-2 cursor-pointer select-none" onClick={() => toggleSection(section.id)}>
                    <span className="text-[12.5px] font-semibold flex items-center gap-2">
                      <span className={cn('w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center', section.color)}>{section.letter}</span>
                      {section.title}
                    </span>
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      {checkedCount}/{section.items.length} complete
                      <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', section.open && 'rotate-180')} />
                    </span>
                  </div>
                  {section.open && (
                    <div className="mt-1">
                      {section.items.map(item => (
                        <div
                          key={item.id}
                          className={cn(
                            'flex items-start gap-2.5 py-2 border-b last:border-b-0',
                            section.id === 'nhs' && !item.checked && 'bg-danger/5 rounded-md px-2 mb-1'
                          )}
                        >
                          <button
                            onClick={() => toggleCheck(section.id, item.id)}
                            className={cn(
                              'w-4 h-4 rounded border-[1.5px] flex-shrink-0 flex items-center justify-center mt-0.5 cursor-pointer transition-colors',
                              item.checked ? 'bg-success border-success text-white' : 'border-muted-foreground/30 bg-background hover:border-primary'
                            )}
                          >
                            {item.checked && <Check className="w-2.5 h-2.5" />}
                          </button>
                          <div>
                            <div className={cn('text-xs', section.id === 'nhs' && !item.checked && 'text-danger font-semibold')}>{item.text}</div>
                            <div className={cn('text-[10.5px] mt-0.5', section.id === 'nhs' && !item.checked ? 'text-danger/70' : 'text-muted-foreground')}>{item.evidence}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Associate Stickiness */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
              Associate Stickiness Module
              <InfoTip description="Risk assessment for each key associate — based on revenue concentration, notice period, and restrictive covenant status." calculation={`Top ${ddData.associates.length} providers by revenue. Total provider revenue: ${formatCompact(ddData.associates.reduce((s, a) => s + a.revenue, 0))}. Score: >30% = 25, >20% = 45, >15% = 65, >10% = 80, else 95.`} />
            </div>
            <span className="text-[9px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">PMS + Contracts</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b-2">
                  <th className="py-1.5 px-2 text-left text-muted-foreground font-semibold">Associate</th>
                  <th className="py-1.5 px-2 text-right text-muted-foreground font-semibold">Revenue</th>
                  <th className="py-1.5 px-2 text-center text-muted-foreground font-semibold">Notice</th>
                  <th className="py-1.5 px-2 text-center text-muted-foreground font-semibold">Covenant</th>
                  <th className="py-1.5 px-2 text-center text-muted-foreground font-semibold">Score</th>
                  <th className="py-1.5 px-2 text-center text-muted-foreground font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {ddData.associates.map((assoc, i) => (
                  <tr key={i} className={cn('border-b', assoc.status === 'red' && 'bg-danger/5')}>
                    <td className="py-2 px-2 font-medium">{assoc.name}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(assoc.revenue)} <span className="text-muted-foreground">({assoc.pct}%)</span></td>
                    <td className={cn('py-2 px-2 text-center', assoc.status === 'red' && 'text-danger font-bold')}>{assoc.notice}{assoc.status === 'red' && ' ⚠'}</td>
                    <td className="py-2 px-2 text-center">{assoc.covenant ? <span className="text-success">✓ Yes</span> : <span className="text-danger">✗ No</span>}</td>
                    <td className={cn('py-2 px-2 text-center font-bold',
                      assoc.score >= 80 ? 'text-success' : assoc.score >= 60 ? 'text-warning' : 'text-danger'
                    )}>{assoc.score}/100</td>
                    <td className="py-2 px-2 text-center text-sm">{assoc.status === 'green' ? '🟢' : assoc.status === 'red' ? '🔴' : '🟡'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ddData.associates.length > 0 && ddData.associates[0].pct > 15 && (
            <div className="mt-2.5 p-2.5 bg-warning/5 border border-warning/20 rounded-md text-[11.5px] text-warning leading-relaxed">
              <strong>DentPulse insight:</strong> Top associate ({ddData.associates[0].name}) generates {ddData.associates[0].pct}% of revenue ({formatCompact(ddData.associates[0].revenue)}). High concentration increases key-person risk. Buyer will likely request a retention escrow or price chip.
            </div>
          )}
        </Card>

        {/* Buyer Questions + Resolution */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">Auto-Generated Buyer Questions</div>
                <span className="text-[9px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">DentPulse AI</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  questionsRequested.current = false;
                  const providers = (providerProduction.data?.providers ?? []).sort((a, b) => b.total - a.total);
                  const totalProviderRevenue = providers.reduce((s, p) => s + p.total, 0);
                  const topProvider = providers[0];
                  generateQuestions({
                    totalRevenue: d.totalRevenue,
                    sustainableEBITDA: d.sustainableEBITDA,
                    reportedEBITDA: d.reportedEBITDA,
                    enterpriseValue: d.enterpriseValue,
                    multiple: d.multiple.finalMultiple,
                    qualityScore: d.quality.finalScore,
                    paidInvoiceRate: (d.qualityInputs.paidInvoiceRate * 100).toFixed(0) + '%',
                    privateRevenuePct: d.qualityInputs.privateRevenuePct.toFixed(0) + '%',
                    avgUtilisationPct: d.qualityInputs.avgUtilisationPct.toFixed(0) + '%',
                    udaDeliveryPct: d.qualityInputs.udaDeliveryPct != null ? d.qualityInputs.udaDeliveryPct.toFixed(0) + '%' : 'No NHS contract',
                    topProviderName: topProvider?.providerName ?? 'Unknown',
                    topProviderRevenuePct: totalProviderRevenue > 0 && topProvider
                      ? Math.round(topProvider.total / totalProviderRevenue * 100) + '%' : '0%',
                    normalisationAddBacks: d.normalisationItems.map(i => ({ label: i.label, value: i.value })),
                    sustainabilityHaircuts: d.sustainability.items.map(i => ({ label: i.label, value: i.value })),
                    waterfallPenalties: d.multiple.waterfall.filter(f => f.value < 0).map(f => ({ label: f.label, penalty: f.value })),
                  });
                }}
                disabled={questionsLoading}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn('w-3 h-3', questionsLoading && 'animate-spin')} />
                {aiQuestions.length > 0 ? 'Refresh' : 'Generate'}
              </button>
            </div>
            <div className="space-y-1.5">
              {questionsLoading && aiQuestions.length === 0 && (
                <>
                  <Skeleton className="h-10 w-full rounded-md" />
                  <Skeleton className="h-10 w-full rounded-md" />
                  <Skeleton className="h-10 w-full rounded-md" />
                  <Skeleton className="h-10 w-full rounded-md" />
                </>
              )}
              {ddData.buyerQuestions.map((q, i) => (
                <div key={i} className="p-2.5 bg-muted rounded-md border-l-[3px] border-foreground text-xs text-foreground leading-relaxed italic">{q}</div>
              ))}
              {questionsError && (
                <div className="text-[11px] text-muted-foreground/60 italic mt-1">{questionsError}</div>
              )}
            </div>
          </Card>

          <div className="space-y-3.5">
            <Card className="p-4 border-success">
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-success mb-3">
                If All Critical Issues Resolved
                <InfoTip description="Projected valuation if all critical due diligence issues are fully resolved and evidenced before sale." calculation={`Resolved EBITDA = ${formatCompact(d.sustainableEBITDA)} + ${formatCompact(ddData.scanSummary.nhsClawback)} = ${formatCompact(ddData.resolved.ebitda)}. Multiple = ${d.multiple.finalMultiple.toFixed(1)}x + 0.9x = ${ddData.resolved.multiple.toFixed(1)}x. EV = ${formatCompact(ddData.resolved.ev)}. Uplift: +${formatCompact(ddData.resolved.uplift)}.`} />
              </div>
              <div className="space-y-0">
                <div className="flex justify-between py-1.5 border-b text-xs"><span className="text-muted-foreground">EBITDA</span><span className="font-semibold text-success tabular-nums">{formatCompact(ddData.resolved.ebitda)}</span></div>
                <div className="flex justify-between py-1.5 border-b text-xs"><span className="text-muted-foreground">Multiple</span><span className="font-semibold text-success tabular-nums">{ddData.resolved.multiple.toFixed(1)}×</span></div>
                <div className="flex justify-between py-1.5 border-b text-xs"><span className="text-muted-foreground">Enterprise Value</span><span className="font-semibold text-success tabular-nums">{formatCompact(ddData.resolved.ev)}</span></div>
                <div className="flex justify-between py-1.5 text-xs"><span className="font-semibold">Uplift vs today</span><span className="font-bold text-primary text-base tabular-nums">+{formatCompact(ddData.resolved.uplift)}</span></div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Document Vault</div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.xls,.doc,.docx"
                onChange={handleFileInputChange}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                className={cn(
                  'border-2 border-dashed rounded-md p-4 text-center mb-2.5 transition-colors cursor-pointer',
                  dragActive ? 'border-primary bg-primary/5' : 'hover:border-primary',
                  isUploading && 'pointer-events-none opacity-60'
                )}
              >
                {isUploading ? (
                  <Loader2 className="w-5 h-5 mx-auto text-muted-foreground mb-1 animate-spin" />
                ) : (
                  <Upload className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
                )}
                <div className="text-[11.5px] text-muted-foreground">
                  {isUploading ? 'Uploading...' : `Drop documents here${selectedTag ? '' : ' (select a tag first)'}`}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {DOCUMENT_TAGS.map(tag => {
                  const count = tagCounts[tag.value] || 0;
                  const isActive = selectedTag === tag.value;
                  return (
                    <Button
                      key={tag.value}
                      variant={isActive ? 'default' : 'outline'}
                      size="sm"
                      className={cn('text-[11px] h-7', isActive && 'ring-1 ring-primary')}
                      onClick={() => handleTagClick(tag.value)}
                    >
                      <FileText className="w-3 h-3 mr-1" />
                      {tag.label}
                      {count > 0 && (
                        <span className={cn(
                          'ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full',
                          isActive ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground'
                        )}>
                          {count}
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>

              {/* Document list */}
              {documents.length > 0 ? (
                <div className="space-y-1">
                  {documents.map(doc => (
                    <div key={doc.id} className="flex items-center gap-2 p-2 pr-14 rounded-md bg-muted/50 hover:bg-muted transition-colors group">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11.5px] font-medium truncate">{doc.file_name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatFileSize(doc.file_size)} &middot; {new Date(doc.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => downloadDocument(doc)}
                        >
                          <Download className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                          onClick={() => deleteDocument(doc)}
                          disabled={isDeleting}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : selectedTag ? (
                <div className="text-center py-3 text-[11px] text-muted-foreground">
                  No documents uploaded for this tag yet
                </div>
              ) : null}
            </Card>
          </div>
        </div>
      </div>
  );
}

export default function DueDiligence() {
  return (
    <MainLayout userRole="admin">
      <Helmet><title>Due Diligence Engine™ | DentPulse</title></Helmet>
      <DueDiligenceContent />
    </MainLayout>
  );
}
