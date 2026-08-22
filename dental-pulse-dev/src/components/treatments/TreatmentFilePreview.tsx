import { useState, useEffect } from 'react';
import { FileText, Loader2, AlertCircle, Play, X, Building2, Calendar, Users, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { DialogFooter } from '@/components/ui/dialog';
import { parseTreatmentFile, ParsedTreatmentRow, FileMetadata } from '@/utils/fileParser';
import { toast } from 'sonner';

interface TreatmentFilePreviewProps {
  file: File;
  uploadId?: string; // Deprecated, kept for backward compatibility
  onProcess: (file: File) => Promise<void>;
  onCancel: () => void;
  categoryId?: string | null;
  locationId?: string | null;
  regionId?: string | null;
}

export function TreatmentFilePreview({
  file,
  uploadId,
  onProcess,
  onCancel,
  categoryId,
  locationId,
  regionId,
}: TreatmentFilePreviewProps) {
  const [parsedData, setParsedData] = useState<ParsedTreatmentRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [metadata, setMetadata] = useState<FileMetadata | undefined>();
  const [isParsing, setIsParsing] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const parseFile = async () => {
      try {
        setIsParsing(true);
        const result = await parseTreatmentFile(file);
        setParsedData(result.data);
        setErrors(result.errors);
        setMetadata(result.metadata);
      } catch (error: any) {
        toast.error(`Failed to parse file: ${error.message}`);
        setErrors([error.message]);
      } finally {
        setIsParsing(false);
      }
    };

    parseFile();
  }, [file]);

  const handleProcess = async () => {
    try {
      setIsProcessing(true);
      await onProcess(file);
      // Success message will be shown by the hook
    } catch (error: any) {
      console.error('Process error:', error);
      toast.error(`Failed to process file: ${error.message || 'Unknown error occurred'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center justify-between mb-4 flex-shrink-0 w-full">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="w-5 h-5" />
          File Preview
        </h3>
        <Button variant="ghost" size="icon" onClick={onCancel} disabled={isProcessing}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 w-full">
        {isParsing ? (
          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
            <p className="text-sm text-muted-foreground">Parsing file...</p>
          </div>
        ) : (
          <>
          {/* Summary - Below Table */}
          <div className="grid grid-cols-3 gap-4 flex-shrink-0">
              <div className="border rounded-lg p-3 bg-muted/30">
                <p className="text-xs text-muted-foreground">Total Rows</p>
                <p className="text-2xl font-semibold">{parsedData.length}</p>
              </div>
              <div className="border rounded-lg p-3 bg-muted/30">
                <p className="text-xs text-muted-foreground">Valid Rows</p>
                <p className="text-2xl font-semibold text-green-600">
                  {parsedData.length - errors.length}
                </p>
              </div>
              <div className="border rounded-lg p-3 bg-muted/30">
                <p className="text-xs text-muted-foreground">Errors</p>
                <p className="text-2xl font-semibold text-red-600">{errors.length}</p>
              </div>
            </div>
            
            <Accordion type="single" defaultValue="treatment-data" collapsible className="w-full flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* File Metadata/Header Info Accordion - Closed by default */}
              {metadata && (
                <AccordionItem value="details">
                  <AccordionTrigger className="text-sm font-medium">
                    Show Details
                  </AccordionTrigger>
                  <AccordionContent>
                    <Card className="bg-muted/30">
                      <CardContent className="pt-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                          {metadata.practiceName && (
                            <div className="flex items-start gap-2">
                              <Building2 className="w-4 h-4 text-muted-foreground mt-0.5" />
                              <div>
                                <p className="text-xs text-muted-foreground">Practice</p>
                                <p className="font-medium">{metadata.practiceName}</p>
                                {metadata.practiceCode && (
                                  <p className="text-xs text-muted-foreground">Code: {metadata.practiceCode}</p>
                                )}
                              </div>
                            </div>
                          )}
                          
                          {(metadata.dateFrom || metadata.dateTo) && (
                            <div className="flex items-start gap-2">
                              <Calendar className="w-4 h-4 text-muted-foreground mt-0.5" />
                              <div>
                                <p className="text-xs text-muted-foreground">Date Range</p>
                                <p className="font-medium">
                                  {metadata.dateFrom && metadata.dateTo 
                                    ? `${metadata.dateFrom} to ${metadata.dateTo}`
                                    : metadata.dateFrom || metadata.dateTo
                                  }
                                </p>
                              </div>
                            </div>
                          )}
                          
                          {metadata.providers && (
                            <div className="flex items-start gap-2">
                              <Users className="w-4 h-4 text-muted-foreground mt-0.5" />
                              <div className="flex-1">
                                <p className="text-xs text-muted-foreground">Providers</p>
                                <p className="font-medium text-xs break-words">{metadata.providers}</p>
                              </div>
                            </div>
                          )}
                          
                          {metadata.payors && (
                            <div className="flex items-start gap-2">
                              <CreditCard className="w-4 h-4 text-muted-foreground mt-0.5" />
                              <div className="flex-1">
                                <p className="text-xs text-muted-foreground">Payors</p>
                                <p className="font-medium text-xs">{metadata.payors}</p>
                              </div>
                            </div>
                          )}
                          
                          {metadata.reportDate && (
                            <div className="flex items-start gap-2">
                              <Calendar className="w-4 h-4 text-muted-foreground mt-0.5" />
                              <div>
                                <p className="text-xs text-muted-foreground">Report Generated</p>
                                <p className="font-medium">
                                  {metadata.reportDate}
                                  {metadata.reportTime && ` at ${metadata.reportTime}`}
                                </p>
                              </div>
                            </div>
                          )}
                          
                          {metadata.sortBy && (
                            <div className="flex items-start gap-2">
                              <FileText className="w-4 h-4 text-muted-foreground mt-0.5" />
                              <div>
                                <p className="text-xs text-muted-foreground">Sort By</p>
                                <p className="font-medium">{metadata.sortBy}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Preview Table Accordion - Open by default */}
              {parsedData.length > 0 && (
                <AccordionItem value="treatment-data" className="flex-1 flex flex-col min-h-0 w-full">
                  <AccordionTrigger className="text-sm font-medium flex-shrink-0">
                    All Treatment Data ({parsedData.length} rows)
                  </AccordionTrigger>
                  <AccordionContent className="flex-1 overflow-hidden flex flex-col min-h-0 w-full">
                    <div className="border rounded-lg flex flex-col h-full overflow-hidden w-full">
                      <div className="overflow-y-auto overflow-x-auto w-full" style={{ maxHeight: 'calc(70vh - 300px)' }}>
                        <Table className="w-full">
                          <TableHeader className="sticky top-0 bg-background z-10">
                            <TableRow>
                              <TableHead className="min-w-[80px]">Code</TableHead>
                              <TableHead className="min-w-[180px]">Treatment Name</TableHead>
                              <TableHead className="min-w-[120px]">Category</TableHead>
                              <TableHead className="min-w-[70px]">Type</TableHead>
                              <TableHead className="min-w-[80px] text-right">Price</TableHead>
                              <TableHead className="min-w-[70px] text-right">Dentist Time</TableHead>
                              <TableHead className="min-w-[70px] text-right">Therapist Time</TableHead>
                              <TableHead className="min-w-[70px] text-right">Lab Bill</TableHead>
                              <TableHead className="min-w-[70px] text-right">Material Cost</TableHead>
                              <TableHead className="min-w-[70px] text-right">Associate %</TableHead>
                              <TableHead className="min-w-[80px] text-right">Therapist Pay</TableHead>
                              <TableHead className="min-w-[70px] text-right">Finance %</TableHead>
                              <TableHead className="min-w-[70px] text-right">OP Cost</TableHead>
                              <TableHead className="min-w-[80px] text-right">Completion Time</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {parsedData.map((row, index) => (
                              <TableRow key={index}>
                                <TableCell className="font-mono text-sm font-semibold">
                                  {row.treatment_code || '-'}
                                </TableCell>
                                <TableCell className="font-medium">{row.treatment_name}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {row.category_name || '-'}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={row.treatment_type === 'nhs' ? 'secondary' : 'outline'} className="text-xs">
                                    {row.treatment_type}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-semibold">
                                  {formatCurrency(row.price)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.duration_minutes !== undefined ? `${row.duration_minutes}` : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.therapist_time_mins !== undefined ? `${row.therapist_time_mins}` : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.lab_bill !== undefined ? formatCurrency(row.lab_bill) : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.material_cost !== undefined ? formatCurrency(row.material_cost) : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.percent_fees !== undefined ? `${row.percent_fees}%` : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.therapist_pay_rate !== undefined ? formatCurrency(row.therapist_pay_rate) : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.finance_fee !== undefined ? `${row.finance_fee}%` : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.hourly_rate !== undefined ? formatCurrency(row.hourly_rate) : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.average_time_minutes !== undefined ? `${row.average_time_minutes}` : '-'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="p-3 border-t bg-muted/30 text-xs text-muted-foreground text-center">
                        Showing all {parsedData.length} treatments
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}
            </Accordion>

            {/* Errors */}
            {errors.length > 0 && (
              <div className="border border-red-200 rounded-lg p-4 bg-red-50 flex-shrink-0">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <p className="text-sm font-medium text-red-900">Parsing Errors</p>
                </div>
                <ScrollArea className="h-32">
                  <ul className="text-xs text-red-700 space-y-1">
                    {errors.map((error, index) => (
                      <li key={index}>• {error}</li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            )}

            {/* Action Buttons */}
            <DialogFooter className="flex-shrink-0 mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isProcessing}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleProcess}
                disabled={isProcessing || parsedData.length === 0}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Process & Save ({parsedData.length} treatments)
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </div>
    </div>
  );
}
