import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ParsedTreatmentRow {
  treatment_name: string;
  treatment_code?: string;
  description?: string;
  treatment_type: 'private' | 'nhs';
  price: number;
  private_price?: number;
  nhs_price?: number;
  nhs_band?: 'Band 1' | 'Band 2' | 'Band 3';
  duration_minutes?: number;
  therapist_time_mins?: number;
  lab_bill?: number;
  lab_bill_discount?: number;
  material_cost?: number;
  percent_fees?: number;
  therapist_pay_rate?: number;
  finance_fee?: number;
  hourly_rate?: number;
  average_time_minutes?: number;
  requires_followup?: boolean;
  category_name?: string;
  notes?: string;
  // DentLedger specific fields
  no_items?: number;
  average?: number;
}

export interface FileMetadata {
  practiceName?: string;
  practiceCode?: string;
  country?: string;
  reportTitle?: string;
  patientsSelected?: string;
  providers?: string;
  payors?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  reportDate?: string;
  reportTime?: string;
}

export interface ParseResult {
  data: ParsedTreatmentRow[];
  errors: string[];
  totalRows: number;
  metadata?: FileMetadata;
}

/**
 * Parse CSV file - handles DentLedger format and standard CSV
 */
export async function parseCSV(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: false,
      complete: (results) => {
        try {
          const rows = results.data as string[][];
          
          // Check if this is DentLedger format (has "Service" header)
          const isDentLedgerFormat = rows.some((row, index) => {
            if (index < 15) {
              const firstCell = String(row[0] || '').trim();
              return firstCell === 'Service' || firstCell.includes('Service');
            }
            return false;
          });

          if (isDentLedgerFormat) {
            const parsed = parseDentLedgerFormat(rows);
            resolve({
              data: parsed.data,
              errors: [...results.errors.map(e => e.message || 'Unknown error'), ...parsed.errors],
              totalRows: parsed.data.length,
              metadata: parsed.metadata,
            });
          } else {
            // Standard CSV format
            const parsed = parseStandardCSV(rows);
            resolve({
              data: parsed.data,
              errors: [...results.errors.map(e => e.message || 'Unknown error'), ...parsed.errors],
              totalRows: parsed.data.length,
              metadata: parsed.metadata,
            });
          }
        } catch (error: any) {
          reject(new Error(`Failed to parse CSV: ${error.message}`));
        }
      },
      error: (error) => {
        reject(new Error(`CSV parsing error: ${error.message}`));
      },
    });
  });
}

/**
 * Parse DentLedger CSV format
 * Format: Service Code, Description, No.Items, Average, Fees, %Fees, Time, Average Time, Hourly Rate
 */
function parseDentLedgerFormat(rows: string[][]): { data: ParsedTreatmentRow[]; errors: string[]; metadata?: FileMetadata } {
  const data: ParsedTreatmentRow[] = [];
  const errors: string[] = [];
  const metadata: FileMetadata = {};
  
  // Extract metadata from header rows
  if (rows.length > 0) {
    // Row 0: Practice name, code, country
    if (rows[0] && rows[0][0]) metadata.practiceName = String(rows[0][0]).trim();
    if (rows[0] && rows[0][1]) metadata.practiceCode = String(rows[0][1]).trim();
    if (rows[0] && rows[0][2]) metadata.country = String(rows[0][2]).trim();
    
    // Row 1: Report title
    if (rows[1] && rows[1][0]) metadata.reportTitle = String(rows[1][0]).trim();
    
    // Row 3: Patients Selected
    if (rows[3] && rows[3][0]) {
      const label = String(rows[3][0]).trim();
      if (label.toLowerCase().includes('patient')) {
        metadata.patientsSelected = rows[3].slice(1).filter(c => c).join(', ') || 'All';
      }
    }
    
    // Row 4 or 5: Providers (check both rows)
    for (let rowIdx = 4; rowIdx <= 5; rowIdx++) {
      if (rows[rowIdx] && rows[rowIdx][0]) {
        const label = String(rows[rowIdx][0]).trim();
        if (label.toLowerCase().includes('provider')) {
          // Get all cells from this row and join them
          const providerValue = rows[rowIdx].slice(1).map(c => String(c || '').trim()).filter(c => c).join(' ') || '';
          metadata.providers = providerValue || 'All Providers';
          break;
        }
      }
    }
    
    // Row 5 or 6: Payors (check both rows)
    for (let rowIdx = 5; rowIdx <= 6; rowIdx++) {
      if (rows[rowIdx] && rows[rowIdx][0]) {
        const label = String(rows[rowIdx][0]).trim();
        if (label.toLowerCase().includes('payor')) {
          // Get all cells from this row and join them
          const payorValue = rows[rowIdx].slice(1).map(c => String(c || '').trim()).filter(c => c).join(' ') || '';
          metadata.payors = payorValue || 'All Payors';
          break;
        }
      }
    }
    
    // Row 6: Date range
    if (rows[6] && rows[6][0]) {
      const dateRange = String(rows[6][0]).trim();
      const dateMatch = dateRange.match(/From\s+(\d{2}\/\d{2}\/\d{4})\s+To\s+(\d{2}\/\d{2}\/\d{4})/i);
      if (dateMatch) {
        metadata.dateFrom = dateMatch[1];
        metadata.dateTo = dateMatch[2];
      }
    }
    
    // Row 7: Sort By
    if (rows[7] && rows[7][0]) {
      const label = String(rows[7][0]).trim();
      if (label.toLowerCase().includes('sort')) {
        metadata.sortBy = rows[7].slice(1).filter(c => c).join(' ') || '';
      }
    }
    
    // Row 9: Report date/time
    if (rows[9] && rows[9][0]) {
      const label = String(rows[9][0]).trim();
      if (label.toLowerCase().includes('as at')) {
        if (rows[9][1]) metadata.reportDate = String(rows[9][1]).trim();
        if (rows[9][2]) metadata.reportTime = String(rows[9][2]).trim();
      }
    }
  }
  
  // Find header row (contains "Service")
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const firstCell = String(rows[i][0] || '').trim();
    if (firstCell === 'Service' || firstCell.includes('Service')) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    errors.push('Could not find header row in DentLedger format');
    return { data, errors, metadata };
  }

  // Parse data rows starting after header
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const serviceCode = String(row[0] || '').trim();
    const description = String(row[1] || '').trim();
    const noItemsStr = String(row[3] || '').trim(); // No.Items column (index 3)
    const averageStr = String(row[5] || '').trim(); // Average column (index 5)
    const feesStr = String(row[6] || '').trim(); // Fees column (index 6)
    const percentFeesStr = String(row[7] || '').trim(); // %Fees column (index 7)
    const timeStr = String(row[8] || '').trim(); // Time column (index 8, format: HH:MM)
    const avgTimeStr = String(row[9] || '').trim(); // Average Time column (index 9)
    const hourlyRateStr = String(row[10] || '').trim(); // Hourly Rate column (index 10)

    // Skip footer rows and invalid rows
    if (
      serviceCode.toLowerCase().includes('totals') ||
      serviceCode.toLowerCase().includes('note:') ||
      serviceCode.toLowerCase().includes('* the number') ||
      serviceCode.toLowerCase().startsWith('note:') ||
      serviceCode === '' ||
      feesStr === '' ||
      feesStr === '0.00' ||
      feesStr === '0' ||
      serviceCode.startsWith('*') && feesStr.startsWith('-') // Skip negative fee rows like "*LATE"
    ) {
      continue;
    }

    try {
      // Parse fees (price)
      const fees = parseFloat(feesStr.replace(/,/g, ''));
      if (isNaN(fees) || fees <= 0) {
        continue; // Skip rows with invalid, zero, or negative fees
      }

      // Parse No.Items
      const noItems = noItemsStr ? parseInt(noItemsStr.replace(/,/g, '').replace('*', '')) : undefined;
      
      // Parse Average
      const average = averageStr ? parseFloat(averageStr.replace(/,/g, '')) : undefined;
      
      // Parse %Fees
      const percentFees = percentFeesStr ? parseFloat(percentFeesStr.replace(/,/g, '')) : undefined;
      
      // Parse time to minutes (format: HH:MM)
      let durationMinutes: number | undefined;
      if (timeStr && timeStr.includes(':')) {
        const timeParts = timeStr.split(':');
        if (timeParts.length === 2) {
          const hours = parseInt(timeParts[0]) || 0;
          const minutes = parseInt(timeParts[1]) || 0;
          durationMinutes = hours * 60 + minutes;
        }
      }
      
      // Parse Average Time to minutes (format: MM:SS)
      let averageTimeMinutes: number | undefined;
      if (avgTimeStr && avgTimeStr.includes(':')) {
        const avgTimeParts = avgTimeStr.split(':');
        if (avgTimeParts.length === 2) {
          const avgMinutes = parseInt(avgTimeParts[0]) || 0;
          const avgSeconds = parseInt(avgTimeParts[1]) || 0;
          averageTimeMinutes = avgMinutes + (avgSeconds / 60);
        }
      }
      
      // Parse Hourly Rate
      const hourlyRate = hourlyRateStr ? parseFloat(hourlyRateStr.replace(/,/g, '')) : undefined;

      // Determine treatment name (use description if available, otherwise code)
      // Clean service code (remove leading asterisk if present)
      const cleanServiceCode = serviceCode.replace(/^\*+/, '').trim();
      const treatmentName = description || cleanServiceCode;
      if (!treatmentName || treatmentName.trim() === '') {
        continue;
      }

      // Determine treatment type dynamically
      // Check Payors metadata - if it contains "NHS" then it's NHS, otherwise private
      let treatmentType: 'private' | 'nhs' = 'private';
      
      // Check if Payors metadata indicates NHS
      if (metadata.payors && metadata.payors.toLowerCase().includes('nhs')) {
        treatmentType = 'nhs';
      }
      
      // Also check if service code or description suggests NHS (e.g., Band 1, Band 2, Band 3)
      const serviceCodeLower = cleanServiceCode.toLowerCase();
      const descriptionLower = description.toLowerCase();
      if (
        serviceCodeLower.includes('band 1') ||
        serviceCodeLower.includes('band 2') ||
        serviceCodeLower.includes('band 3') ||
        descriptionLower.includes('band 1') ||
        descriptionLower.includes('band 2') ||
        descriptionLower.includes('band 3') ||
        descriptionLower.includes('nhs')
      ) {
        treatmentType = 'nhs';
      }

      // Detect NHS Band from service code or description
      let nhsBand: 'Band 1' | 'Band 2' | 'Band 3' | undefined;
      if (treatmentType === 'nhs') {
        if (serviceCodeLower.includes('band 1') || descriptionLower.includes('band 1')) {
          nhsBand = 'Band 1';
        } else if (serviceCodeLower.includes('band 2') || descriptionLower.includes('band 2')) {
          nhsBand = 'Band 2';
        } else if (serviceCodeLower.includes('band 3') || descriptionLower.includes('band 3')) {
          nhsBand = 'Band 3';
        }
      }

      const parsedRow: ParsedTreatmentRow = {
        treatment_name: treatmentName.trim(),
        treatment_code: cleanServiceCode || undefined,
        description: description || undefined,
        treatment_type: treatmentType,
        price: fees,
        nhs_price: treatmentType === 'nhs' ? fees : undefined,
        private_price: treatmentType === 'private' ? fees : undefined,
        nhs_band: nhsBand,
        duration_minutes: durationMinutes,
        requires_followup: false,
        no_items: noItems,
        average: average,
        percent_fees: percentFees,
        hourly_rate: hourlyRate,
        average_time_minutes: averageTimeMinutes,
      };

      data.push(parsedRow);
    } catch (error: any) {
      errors.push(`Row ${i + 1}: ${error.message || 'Unknown error'}`);
    }
  }

  return { data, errors, metadata };
}

/**
 * Parse standard CSV format with headers
 */
function parseStandardCSV(rows: string[][]): { data: ParsedTreatmentRow[]; errors: string[]; metadata?: FileMetadata } {
  if (rows.length === 0) {
    return { data: [], errors: ['CSV file is empty'] };
  }

  // First row is headers
  const headers = rows[0].map((h: string) => 
    String(h).trim().toLowerCase().replace(/\s+/g, '_')
  );

  // Convert rows to objects
  const rowObjects = rows.slice(1).map((row: string[]) => {
    const obj: any = {};
    headers.forEach((header, index) => {
      obj[header] = row[index] || '';
    });
    return obj;
  });

  const parsed = parseRows(rowObjects);
  return { ...parsed, metadata: undefined };
}

/**
 * Parse Excel file (XLSX or XLS)
 */
export async function parseExcel(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Get first sheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
        });
        
        if (jsonData.length === 0) {
          reject(new Error('Excel file is empty'));
          return;
        }
        
        // First row is headers
        const headers = (jsonData[0] as any[]).map((h: any) => 
          String(h).trim().toLowerCase().replace(/\s+/g, '_')
        );
        
        // Convert rows to objects
        const rows = jsonData.slice(1).map((row: any[]) => {
          const obj: any = {};
          headers.forEach((header, index) => {
            obj[header] = row[index] || '';
          });
          return obj;
        });
        
        const parsed = parseRows(rows);
        resolve({
          data: parsed.data,
          errors: parsed.errors,
          totalRows: rows.length,
          metadata: undefined,
        });
      } catch (error: any) {
        reject(new Error(`Failed to parse Excel: ${error.message}`));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read Excel file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Parse rows and map to treatment data structure
 */
function parseRows(rows: any[]): { data: ParsedTreatmentRow[]; errors: string[] } {
  const data: ParsedTreatmentRow[] = [];
  const errors: string[] = [];
  
  rows.forEach((row, index) => {
    try {
      // Map column names (flexible mapping)
      const treatmentName = 
        row.treatment_name || 
        row.name || 
        row.treatment || 
        row.service_name ||
        '';
      
      if (!treatmentName || treatmentName.trim() === '') {
        errors.push(`Row ${index + 2}: Treatment name is required`);
        return;
      }
      
      const treatmentType = 
        (row.treatment_type || row.type || row.service_type || 'private')
          .toString()
          .toLowerCase()
          .trim();
      
      if (treatmentType !== 'private' && treatmentType !== 'nhs') {
        errors.push(`Row ${index + 2}: Invalid treatment type "${treatmentType}". Must be "private" or "nhs"`);
        return;
      }
      
      const price = parseFloat(row.price || row.base_price || row.cost || '0');
      if (isNaN(price) || price < 0) {
        errors.push(`Row ${index + 2}: Invalid price value`);
        return;
      }
      
      const safeParseFloat = (val: any) => { const n = parseFloat(val); return isNaN(n) ? undefined : n; };
      const safeParseInt = (val: any) => { const n = parseInt(val); return isNaN(n) ? undefined : n; };

      const parsedRow: ParsedTreatmentRow = {
        treatment_name: treatmentName.trim(),
        treatment_code: row.treatment_code || row.code || row.ada_code || undefined,
        description: row.description || row.desc || undefined,
        treatment_type: treatmentType as 'private' | 'nhs',
        price: price,
        private_price: row.private_price ? parseFloat(row.private_price) : undefined,
        nhs_price: row.nhs_price ? parseFloat(row.nhs_price) : undefined,
        nhs_band: row.nhs_band ? (row.nhs_band as 'Band 1' | 'Band 2' | 'Band 3') : undefined,
        duration_minutes: safeParseInt(row.duration_minutes || row.dentist_time_mins || row.duration || row.time),
        therapist_time_mins: safeParseInt(row.therapist_time_mins),
        lab_bill: safeParseFloat(row.lab_bill),
        lab_bill_discount: safeParseFloat(row.lab_bill_discount),
        material_cost: safeParseFloat(row.material_cost),
        percent_fees: safeParseFloat(row.percent_fees || row['associate_pay_%']),
        therapist_pay_rate: safeParseFloat(row.therapist_pay_rate || row.therapist_pay),
        finance_fee: safeParseFloat(row.finance_fee || row['finance_fee_%']),
        hourly_rate: safeParseFloat(row.hourly_rate || row.operating_cost_per_surgery_per_hour || row.op_cost),
        average_time_minutes: safeParseFloat(row.average_time_minutes || row.completion_time_used_mins || row.completion_time),
        requires_followup: row.requires_followup === 'true' || row.requires_followup === true || row.followup === 'yes',
        category_name: row.category_name || row.category || undefined,
        notes: row.notes || row.note || undefined,
      };
      
      // Validate NHS band if NHS treatment
      if (parsedRow.treatment_type === 'nhs' && parsedRow.nhs_band) {
        const validBands = ['Band 1', 'Band 2', 'Band 3'];
        if (!validBands.includes(parsedRow.nhs_band)) {
          errors.push(`Row ${index + 2}: Invalid NHS band "${parsedRow.nhs_band}". Must be Band 1, Band 2, or Band 3`);
          return;
        }
      }
      
      data.push(parsedRow);
    } catch (error: any) {
      errors.push(`Row ${index + 2}: ${error.message || 'Unknown error'}`);
    }
  });
  
  return { data, errors };
}

/**
 * Main parse function - detects file type and parses accordingly
 */
export async function parseTreatmentFile(file: File): Promise<ParseResult> {
  const fileExtension = file.name.split('.').pop()?.toLowerCase();
  
  if (fileExtension === 'csv') {
    return parseCSV(file);
  } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
    return parseExcel(file);
  } else {
    throw new Error(`Unsupported file type: ${fileExtension}`);
  }
}
