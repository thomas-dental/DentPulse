import * as XLSX from 'xlsx';

export interface ParsedMembershipRow {
  surname: string;
  initial: string;
  dob: string | null; // YYYY-MM-DD
  treating_dentist: string;
  fee_category: string;
  discount_percent: number;
  net_due: number;
  // Extended raw columns (stored but not displayed)
  pay_grp_id: string | null;
  patient_id: string | null;
  title: string | null;
  pay_grp_size: string | null;
  multiple_payments: string | null;
  unpaid_payment: string | null;
  late_joiner: string | null;
  supplementary_insurance: string | null;
  implant_insurance: string | null;
  annual_payer: string | null;
  explanatory_text: string | null;
  // Denplan facility id extracted from the source filename (e.g. "256891a").
  // Every row from the same CSV shares the same value.
  source_facility_id: string | null;
}

export interface MembershipParseResult {
  data: ParsedMembershipRow[];
  errors: string[];
  totalRows: number;
  /** Facility id extracted from the filename, or null if none could be parsed. */
  facilityId: string | null;
  /** Raw filename — surfaced so the UI can show which file a facility came from. */
  fileName: string;
}

/**
 * Extract a Denplan facility id from a filename.
 * denplan.co.uk exports follow the shape `<digits><letter>-<anything>.csv`
 * (e.g. `256891a-members-May24.csv`). The id is case-insensitive; we lowercase
 * it so mapping lookups are canonical.
 */
export function extractFacilityIdFromFilename(fileName: string): string | null {
  const base = fileName.replace(/\.[^.]+$/, '');
  const m = base.match(/(?:^|[^a-z0-9])(\d{3,10}[a-z])(?=$|[^a-z0-9])/i);
  return m ? m[1].toLowerCase() : null;
}

function normalizeHeader(h: string): string {
  return String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

const MONTH_LOOKUP: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

function pad2(s: string | number): string {
  return String(s).padStart(2, '0');
}

function parseDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null;

  // XLSX may return a JS Date object for date cells
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${pad2(raw.getMonth() + 1)}-${pad2(raw.getDate())}`;
  }

  // Excel serial number (days since 1899-12-30)
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw < 2958466) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + raw * 86400000);
    if (!isNaN(d.getTime())) {
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    }
  }

  const str = String(raw).trim();
  if (!str) return null;

  // YYYY-MM-DD or YYYY/MM/DD
  let m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (UK style — day first)
  m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;

  // DD/MM/YY → assume 19XX if YY > 30, else 20XX
  m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
  if (m) {
    const yy = parseInt(m[3], 10);
    const yyyy = yy > 30 ? 1900 + yy : 2000 + yy;
    return `${yyyy}-${pad2(m[2])}-${pad2(m[1])}`;
  }

  // "15 Jan 1980" / "15-Jan-1980" / "15 January 1980"
  m = str.match(/^(\d{1,2})[\s\-]([A-Za-z]+)[\s\-](\d{4})$/);
  if (m) {
    const mm = MONTH_LOOKUP[m[2].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${pad2(m[1])}`;
  }

  // "Jan 15, 1980" / "January 15 1980"
  m = str.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mm = MONTH_LOOKUP[m[1].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${pad2(m[2])}`;
  }

  // Last-resort: Date.parse
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  }

  return null;
}

const HEADER_MAP: Record<string, string> = {
  surname: 'surname',
  initial: 'initial',
  initials: 'initial',
  dob: 'dob',
  date_of_birth: 'dob',
  treating_dentist: 'treating_dentist',
  dentist: 'treating_dentist',
  fee_category: 'fee_category',
  fee: 'fee_category',
  category: 'fee_category',
  plan_name: 'fee_category',
  plan: 'fee_category',
  discount: 'discount_percent',
  discount_percent: 'discount_percent',
  discount__: 'discount_percent',
  net_due: 'net_due',
  net: 'net_due',
  amount: 'net_due',
  // Extended columns (stored only)
  pay_grp_id: 'pay_grp_id',
  paygrp_id: 'pay_grp_id',
  pay_group_id: 'pay_grp_id',
  patient_id: 'patient_id',
  title: 'title',
  pay_grp_size: 'pay_grp_size',
  paygrp_size: 'pay_grp_size',
  pay_group_size: 'pay_grp_size',
  multiple_payments: 'multiple_payments',
  unpaid_payment: 'unpaid_payment',
  late_joiner: 'late_joiner',
  supplementary_insurance: 'supplementary_insurance',
  implant_insurance: 'implant_insurance',
  annual_payer: 'annual_payer',
  explanatory_text: 'explanatory_text',
};

function mapHeader(normalized: string): string | null {
  if (HEADER_MAP[normalized]) return HEADER_MAP[normalized];
  // Fuzzy: contains key
  for (const [key, val] of Object.entries(HEADER_MAP)) {
    if (normalized.includes(key)) return val;
  }
  return null;
}

export async function parseMembershipFile(file: File): Promise<MembershipParseResult> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const facilityId = extractFacilityIdFromFilename(file.name);
  if (ext === 'csv') {
    return await parseMembershipCSV(file, facilityId);
  }
  if (ext === 'xlsx' || ext === 'xls') {
    return await parseMembershipExcel(file, facilityId);
  }
  throw new Error(`Unsupported file type: ${ext}`);
}

async function parseMembershipCSV(file: File, facilityId: string | null): Promise<MembershipParseResult> {
  const Papa = (await import('papaparse')).default;
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const rows = results.data as string[][];
          resolve(processRows(rows, facilityId, file.name));
        } catch (e: any) {
          reject(new Error(`CSV parse error: ${e.message}`));
        }
      },
      error: (err) => reject(new Error(`CSV error: ${err.message}`)),
    });
  });
}

async function parseMembershipExcel(file: File, facilityId: string | null): Promise<MembershipParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as any[][];
        resolve(processRows(rows, facilityId, file.name));
      } catch (e: any) {
        reject(new Error(`Excel parse error: ${e.message}`));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

function processRows(rawRows: any[][], facilityId: string | null, fileName: string): MembershipParseResult {
  const data: ParsedMembershipRow[] = [];
  const errors: string[] = [];

  if (rawRows.length < 2) {
    return { data: [], errors: ['File has no data rows'], totalRows: 0, facilityId, fileName };
  }

  // Map headers
  const headerRow = rawRows[0].map((h: any) => normalizeHeader(String(h)));
  const colMap: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    const mapped = mapHeader(h);
    if (mapped && !(mapped in colMap)) {
      colMap[mapped] = i;
    }
  });

  if (!('surname' in colMap) && !('fee_category' in colMap)) {
    errors.push('Could not find required columns (Surname, Plan name). Check your headers.');
    return { data: [], errors, totalRows: 0, facilityId, fileName };
  }

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    const surname = String(row[colMap.surname] ?? '').trim();
    if (!surname) continue; // skip empty rows

    const planName = String(row[colMap.fee_category] ?? '').trim();
    if (!planName) {
      errors.push(`Row ${i + 1}: Plan name is empty, skipped`);
      continue;
    }

    const netDueRaw = String(row[colMap.net_due] ?? '0').replace(/[^0-9.\-]/g, '');
    const netDue = parseFloat(netDueRaw) || 0;

    const discountRaw = String(row[colMap.discount_percent] ?? '0').replace(/[^0-9.\-]/g, '');
    const discountPercent = parseFloat(discountRaw) || 0;

    const getRaw = (key: string): string | null => {
      if (!(key in colMap)) return null;
      const v = row[colMap[key]];
      if (v == null) return null;
      const s = String(v).trim();
      return s === '' ? null : s;
    };

    data.push({
      surname,
      initial: String(row[colMap.initial] ?? '').trim(),
      dob: parseDate(row[colMap.dob] ?? null),
      treating_dentist: String(row[colMap.treating_dentist] ?? '').trim(),
      fee_category: planName,
      discount_percent: discountPercent,
      net_due: netDue,
      pay_grp_id: getRaw('pay_grp_id'),
      patient_id: getRaw('patient_id'),
      title: getRaw('title'),
      pay_grp_size: getRaw('pay_grp_size'),
      multiple_payments: getRaw('multiple_payments'),
      unpaid_payment: getRaw('unpaid_payment'),
      late_joiner: getRaw('late_joiner'),
      supplementary_insurance: getRaw('supplementary_insurance'),
      implant_insurance: getRaw('implant_insurance'),
      annual_payer: getRaw('annual_payer'),
      explanatory_text: getRaw('explanatory_text'),
      source_facility_id: facilityId,
    });
  }

  return { data, errors, totalRows: data.length, facilityId, fileName };
}
