import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Edit, Trash2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useTreatments } from '@/hooks/useTreatments';
import { Treatment } from '@/types/treatment';
import { Pagination, PaginationContent, PaginationItem, PaginationEllipsis } from '@/components/ui/pagination';

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

interface TreatmentsListProps {
  treatmentType?: 'private' | 'nhs' | null;
  typeOfTreatment?: string | null; // Filter by type_of_treatment (e.g., 'invisalign', 'implant')
  categoryId?: string | null;
}

export function TreatmentsList({ treatmentType = null, typeOfTreatment = null, categoryId = null }: TreatmentsListProps) {
  const navigate = useNavigate();
  const { treatments, isLoading, deleteTreatment, isDeleting } = useTreatments({
    treatmentType,
    typeOfTreatment,
    categoryId,
    // NOTE: treatments are org-wide catalog items (location_id is null for synced treatments),
    // so we do NOT filter by location/region here. Location filtering applies to TPIs/revenue only.
  });

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [treatmentType, typeOfTreatment, categoryId]);

  // Debug: Log treatment data to see category information
  useEffect(() => {
    if (treatments.length > 0) {
      console.log('[TreatmentsList] Sample treatment:', {
        name: treatments[0].treatment_name,
        category_id: treatments[0].category_id,
        category: treatments[0].category,
        hasCategory: !!treatments[0].category,
        categoryName: treatments[0].category?.name
      });
    }
  }, [treatments]);

  // Calculate pagination
  const totalPages = Math.ceil(treatments.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedTreatments = treatments.slice(startIndex, endIndex);

  const handleDelete = (treatmentId: string) => {
    if (confirm('Are you sure you want to delete this treatment?')) {
      deleteTreatment(treatmentId);
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleEdit = (treatmentId: string) => {
    navigate(`/treatments/${treatmentId}/edit`);
  };

  // Helper function to render pagination controls
  const renderPagination = () => {
    if (totalPages <= 1) return null;

    const getPageNumbers = () => {
      const pages: (number | string)[] = [];
      const maxVisiblePages = 5;

      if (totalPages <= maxVisiblePages) {
        // Show all pages if total pages is less than max visible
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Always show first page
        pages.push(1);

        if (currentPage > 3) {
          pages.push('ellipsis-start');
        }

        // Show pages around current page
        const start = Math.max(2, currentPage - 1);
        const end = Math.min(totalPages - 1, currentPage + 1);

        for (let i = start; i <= end; i++) {
          pages.push(i);
        }

        if (currentPage < totalPages - 2) {
          pages.push('ellipsis-end');
        }

        // Always show last page
        pages.push(totalPages);
      }

      return pages;
    };

    return (
      <Pagination className="mt-4">
        <PaginationContent>
          <PaginationItem>
            <Button
              variant="ghost"
              size="default"
              onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="gap-1 pl-2.5"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Previous</span>
            </Button>
          </PaginationItem>
          {getPageNumbers().map((page, index) => {
            if (page === 'ellipsis-start' || page === 'ellipsis-end') {
              return (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              );
            }
            return (
              <PaginationItem key={page}>
                <Button
                  variant={currentPage === page ? 'outline' : 'ghost'}
                  size="icon"
                  onClick={() => handlePageChange(page as number)}
                  className="h-9 w-9"
                >
                  {page}
                </Button>
              </PaginationItem>
            );
          })}
          <PaginationItem>
            <Button
              variant="ghost"
              size="default"
              onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="gap-1 pr-2.5"
            >
              <span>Next</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-muted-foreground">Loading treatments...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Group NHS treatments by band for summary
  const groupedByBand = treatments.reduce((acc, treatment) => {
    if (treatment.treatment_type === 'nhs' && treatment.nhs_band) {
      const band = treatment.nhs_band;
      if (!acc[band]) {
        acc[band] = {
          band,
          count: 0,
          revenue: 0,
          treatments: [],
        };
      }
      acc[band].count += treatment.no_items || 1;
      acc[band].revenue += (treatment.nhs_price || treatment.price) * (treatment.no_items || 1);
      acc[band].treatments.push(treatment);
    }
    return acc;
  }, {} as Record<string, { band: string; count: number; revenue: number; treatments: Treatment[] }>);

  const totalCount = treatments.reduce((sum, t) => sum + (t.no_items || 1), 0);
  const totalRevenue = treatments.reduce(
    (sum, t) => sum + (t.nhs_price || t.price) * (t.no_items || 1),
    0
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>
            {treatmentType === 'nhs' ? 'NHS Treatments' : treatmentType === 'private' ? 'Private Treatments' : typeOfTreatment === 'implant' ? 'Implant Treatments' : typeOfTreatment === 'invisalign' ? 'Invisalign Treatments' : 'All Treatments'}
          </CardTitle>
          <div className="text-sm text-muted-foreground">
            {treatments.length} {treatments.length === 1 ? 'treatment' : 'treatments'}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {treatments.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No treatments found{(treatmentType || typeOfTreatment) ? ' for the selected filters' : ''}.</p>
            {!treatmentType && !typeOfTreatment && (
              <p className="mt-1">Upload a CSV or Excel file to add treatments.</p>
            )}
            {typeOfTreatment && (
              <p className="text-sm mt-2">
                Make sure treatments are tagged as "{typeOfTreatment}" in the Treatment Settings tab.
              </p>
            )}
          </div>
        ) : treatmentType === 'nhs' && Object.keys(groupedByBand).length > 0 ? (
          // NHS Band Summary View
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Band</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Avg Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.values(groupedByBand).map((group) => {
                  const avgValue = group.count > 0 ? group.revenue / group.count : 0;
                  return (
                    <TableRow key={group.band}>
                      <TableCell className="font-medium">{group.band}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {group.treatments.length} {group.treatments.length === 1 ? 'treatment' : 'treatments'}
                      </TableCell>
                      <TableCell className="text-right">{group.count.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{formatCurrency(group.revenue)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(avgValue)}</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="font-bold">
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right">{totalCount.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{formatCurrency(totalRevenue)}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>

            {/* Detailed Treatments Table */}
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-4">All Treatments</h3>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Treatment Name</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Band</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedTreatments.map((treatment) => (
                      <TableRow key={treatment.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {treatment.treatment_name}
                            {treatment.external_id && (
                              <Badge variant="outline" className="text-xs">Dentally</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {treatment.treatment_code || '-'}
                        </TableCell>
                        <TableCell>
                          {treatment.category?.name ? (
                            <Badge variant="outline">{treatment.category.name}</Badge>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {treatment.nhs_band ? (
                            <Badge variant="secondary">{treatment.nhs_band}</Badge>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(treatment.nhs_price || treatment.price)}
                        </TableCell>
                        <TableCell className="text-right">
                          {treatment.duration_minutes
                            ? `${treatment.duration_minutes} min`
                            : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(treatment.id)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(treatment.id)}
                              disabled={isDeleting}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {renderPagination()}
            </div>
          </div>
        ) : (
          // Standard List View
          <>
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Code</TableHead>
                    <TableHead className="min-w-[250px] max-w-[250px]">Name</TableHead>
                    <TableHead className="whitespace-nowrap">Category</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Amount</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Dentist Time Mins</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Therapist Time Mins</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Lab Bill</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Lab Bill Discount</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Material Cost</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Associate Pay (%)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Therapist Pay Rate</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Operating Cost / Surgery / Hr</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Finance Fee (%)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Completion Time Used Mins</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedTreatments.map((treatment) => (
                    <TableRow key={treatment.id}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {treatment.treatment_code || '-'}
                      </TableCell>
                      <TableCell className="font-medium min-w-[250px] max-w-[250px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span>{treatment.treatment_name}</span>
                          {treatment.external_id && (
                            <Badge variant="outline" className="text-xs shrink-0">Dentally</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {treatment.category?.name ? (
                          <Badge variant="outline">{treatment.category.name}</Badge>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {formatCurrency(treatment.price)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {treatment.duration_minutes ?? 0}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {treatment.therapist_time_mins ?? 0}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {treatment.lab_bill ?? 0}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {treatment.lab_bill_discount ?? 0}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {treatment.material_cost ?? 0}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {treatment.percent_fees ?? 0}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {treatment.therapist_pay_rate ?? 0}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {treatment.hourly_rate ?? 0}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {treatment.finance_fee ?? 0}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {treatment.average_time_minutes ?? 0}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(treatment.id)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(treatment.id)}
                            disabled={isDeleting}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {renderPagination()}
          </>
        )}
      </CardContent>
    </Card>
  );
}
