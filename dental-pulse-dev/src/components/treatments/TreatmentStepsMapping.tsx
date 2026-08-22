import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from '@/components/ui/pagination';
import { Edit, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { TreatmentServiceStepFormDialog } from './TreatmentServiceStepFormDialog';
import { useTreatmentServiceSteps } from '@/hooks/useTreatmentServiceSteps';
import { TreatmentServiceStep, TreatmentServiceStepUpdate } from '@/types/treatment-service-step';
import { Treatment } from '@/types/treatment';

interface TreatmentStepsMappingProps {
  treatments: Treatment[];
  canUpdate?: boolean;
}

type StepFilter = 'all' | 'mapped' | 'unmapped' | 'main' | 'not_main';

// Same options/pattern as the Treatments tab (TreatmentSetup.tsx) so the two
// tables inside Treatment Setup behave consistently.
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 10;

export function TreatmentStepsMapping({ treatments, canUpdate = true }: TreatmentStepsMappingProps) {
  const { steps, isLoading, updateStep, isUpdating } = useTreatmentServiceSteps();

  const [searchQuery, setSearchQuery] = useState('');
  const [stepFilter, setStepFilter] = useState<StepFilter>('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedStep, setSelectedStep] = useState<TreatmentServiceStep | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const filteredSteps = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return steps.filter((step) => {
      if (stepFilter === 'mapped' && !step.mapped_treatment_id) return false;
      if (stepFilter === 'unmapped' && step.mapped_treatment_id) return false;
      if (stepFilter === 'main' && !step.is_main_treatment_step) return false;
      if (stepFilter === 'not_main' && step.is_main_treatment_step) return false;
      if (!term) return true;
      return (
        step.service_name.toLowerCase().includes(term) ||
        (step.service_code || '').toLowerCase().includes(term) ||
        (step.mapped_treatment?.treatment_name.toLowerCase().includes(term) ?? false)
      );
    });
  }, [steps, searchQuery, stepFilter]);

  // Snap back to page 1 whenever the filtered set changes shape, so the user
  // never ends up looking at an out-of-range page after a search/filter.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, stepFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredSteps.length / pageSize));
  const paginatedSteps = filteredSteps.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const handleEdit = (step: TreatmentServiceStep) => {
    setSelectedStep(step);
    setIsFormOpen(true);
  };

  const handleFormSubmit = async (data: TreatmentServiceStepUpdate) => {
    if (!selectedStep) return;
    try {
      await updateStep({ ...data, id: selectedStep.id });
      setIsFormOpen(false);
      setSelectedStep(null);
    } catch {
      // Errors are surfaced via toast in the hook
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Treatment Steps</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Treatments already set up, with per-treatment step settings
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search treatments..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 w-[220px]"
              />
            </div>
            <Select value={stepFilter} onValueChange={(v: StepFilter) => setStepFilter(v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Steps</SelectItem>
                <SelectItem value="mapped">Mapped</SelectItem>
                <SelectItem value="unmapped">Unmapped</SelectItem>
                <SelectItem value="main">Is Main Treatment</SelectItem>
                <SelectItem value="not_main">Not Main Treatment</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <TableHeader>
                <TableRow>
                  <TableHead className="border-r border-b border-black">Treatment Code</TableHead>
                  <TableHead className="border-r border-b border-black">Treatment Name</TableHead>
                  <TableHead className="border-r border-b border-black">Mapped Treatment</TableHead>
                  <TableHead className="text-center border-r border-b border-black">Main Treatment Step</TableHead>
                  <TableHead className="text-right border-r border-b border-black">Completion Time (mins)</TableHead>
                  <TableHead className="text-center border-r border-b border-black">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground border-r border-b border-black">
                      Loading treatment steps...
                    </TableCell>
                  </TableRow>
                ) : paginatedSteps.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground border-r border-b border-black">
                      {steps.length === 0
                        ? 'No treatments found. Add a treatment in the Treatments tab first.'
                        : 'No treatments match your filters.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedSteps.map((step) => (
                    <TableRow key={step.id}>
                      <TableCell className="border-r border-b border-black">{step.service_code || '-'}</TableCell>
                      <TableCell className="font-medium border-r border-b border-black">{step.service_name}</TableCell>
                      <TableCell className="border-r border-b border-black">
                        {step.mapped_treatment ? (
                          <span title={step.mapped_treatment.treatment_name}>
                            {step.mapped_treatment.treatment_name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Unmapped</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center border-r border-b border-black">
                        {step.is_main_treatment_step ? 'Yes' : 'No'}
                      </TableCell>
                      <TableCell className="text-right border-r border-b border-black">
                        {step.completion_time_used_mins ?? '-'}
                      </TableCell>
                      <TableCell className="text-center border-r border-b border-black">
                        {canUpdate && (
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(step)} disabled={isUpdating}>
                            <Edit className="w-4 h-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {filteredSteps.length > 0 && (
            <div className="flex items-center justify-between pt-4 flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-sm text-muted-foreground">
                  Showing {(currentPage - 1) * pageSize + 1}–
                  {Math.min(currentPage * pageSize, filteredSteps.length)} of{' '}
                  {filteredSteps.length} treatments
                </p>
                <div className="flex items-center gap-2">
                  <Label htmlFor="steps-page-size" className="text-sm text-muted-foreground">
                    Per page
                  </Label>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v));
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger id="steps-page-size" className="h-8 w-[80px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {totalPages > 1 && (
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <Button
                        variant="ghost"
                        size="default"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="gap-1 pl-2.5"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        <span>Previous</span>
                      </Button>
                    </PaginationItem>
                    {(() => {
                      const pages: (number | string)[] = [];
                      const maxVisible = 5;
                      if (totalPages <= maxVisible) {
                        for (let i = 1; i <= totalPages; i++) pages.push(i);
                      } else {
                        pages.push(1);
                        if (currentPage > 3) pages.push('ellipsis-start');
                        const start = Math.max(2, currentPage - 1);
                        const end = Math.min(totalPages - 1, currentPage + 1);
                        for (let i = start; i <= end; i++) pages.push(i);
                        if (currentPage < totalPages - 2) pages.push('ellipsis-end');
                        pages.push(totalPages);
                      }
                      return pages.map((p, idx) =>
                        p === 'ellipsis-start' || p === 'ellipsis-end' ? (
                          <PaginationItem key={`ell-${idx}`}>
                            <PaginationEllipsis />
                          </PaginationItem>
                        ) : (
                          <PaginationItem key={p}>
                            <Button
                              variant={currentPage === p ? 'outline' : 'ghost'}
                              size="icon"
                              onClick={() => setCurrentPage(p as number)}
                              className="h-9 w-9"
                            >
                              {p}
                            </Button>
                          </PaginationItem>
                        ),
                      );
                    })()}
                    <PaginationItem>
                      <Button
                        variant="ghost"
                        size="default"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="gap-1 pr-2.5"
                      >
                        <span>Next</span>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <TreatmentServiceStepFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        step={selectedStep}
        treatments={treatments}
        onSubmit={handleFormSubmit}
        isLoading={isUpdating}
      />
    </>
  );
}
