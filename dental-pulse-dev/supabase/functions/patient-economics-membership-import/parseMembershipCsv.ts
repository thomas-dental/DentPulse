/**
 * Isolated Denplan/membership CSV parsing for the Edge Function.
 * Port of dental-pulse-dev/src/utils/membershipFileParser.ts (CSV path only).
 * Swap formats later by replacing this module — keep index.ts free of format details.
 */

export interface ParsedMembershipRow {
  surname: string;
  initial: string;
  dob: string | null;
  treating_dentist: string;
  fee_category: string;
  discount_percent: number;
  net_due: number;
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
  source_facility_id: string | null;
}

export interface MembershipParseResult {
  data: ParsedMembershipRow[];
  errors: Array<{ row: number; message: string }>;
  totalRows: number;
  facilityId: string | null;
  fileName: string;
}

function normalizeHeader(h: string): string {
  return String(h)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

const MONTH_LOOKUP: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

function pad2(s: string | number): string {
  return String(s).padStart(2, "0");
}

/** Facility id from Denplan filenames: e.g. `256891a-members-May24.csv` */
export function extractFacilityIdFromFilename(fileName: string): string | null {
  const base = fileName.replace(/\.[^.]+$/, "");
  const m = base.match(/(?:^|[^a-z0-9])(\d{3,10}[a-z])(?=$|[^a-z0-9])/i);
  return m ? m[1].toLowerCase() : null;
}

function parseDate(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const str = String(raw).trim();
  if (!str) return null;

  let m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;

  m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
  if (m) {
    const yy = parseInt(m[3], 10);
    const yyyy = yy > 30 ? 1900 + yy : 2000 + yy;
    return `${yyyy}-${pad2(m[2])}-${pad2(m[1])}`;
  }

  m = str.match(/^(\d{1,2})[\s\-]([A-Za-z]+)[\s\-](\d{4})$/);
  if (m) {
    const mm = MONTH_LOOKUP[m[2].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${pad2(m[1])}`;
  }

  m = str.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mm = MONTH_LOOKUP[m[1].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${pad2(m[2])}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  }
  return null;
}

const HEADER_MAP: Record<string, string> = {
  surname: "surname",
  initial: "initial",
  initials: "initial",
  dob: "dob",
  date_of_birth: "dob",
  treating_dentist: "treating_dentist",
  dentist: "treating_dentist",
  fee_category: "fee_category",
  fee: "fee_category",
  category: "fee_category",
  plan_name: "fee_category",
  plan: "fee_category",
  discount: "discount_percent",
  discount_percent: "discount_percent",
  discount__: "discount_percent",
  net_due: "net_due",
  net: "net_due",
  amount: "net_due",
  pay_grp_id: "pay_grp_id",
  paygrp_id: "pay_grp_id",
  pay_group_id: "pay_grp_id",
  patient_id: "patient_id",
  title: "title",
  pay_grp_size: "pay_grp_size",
  paygrp_size: "pay_grp_size",
  pay_group_size: "pay_grp_size",
  multiple_payments: "multiple_payments",
  unpaid_payment: "unpaid_payment",
  late_joiner: "late_joiner",
  supplementary_insurance: "supplementary_insurance",
  implant_insurance: "implant_insurance",
  annual_payer: "annual_payer",
  explanatory_text: "explanatory_text",
};

function mapHeader(normalized: string): string | null {
  if (HEADER_MAP[normalized]) return HEADER_MAP[normalized];
  for (const [key, val] of Object.entries(HEADER_MAP)) {
    if (normalized.includes(key)) return val;
  }
  return null;
}

/** Minimal CSV splitter — handles quoted fields; no Node/xlsx deps. */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else if (ch === "\r") {
      // ignore CR (handle CRLF)
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }

  return rows;
}

export function processMembershipRows(
  rawRows: string[][],
  facilityId: string | null,
  fileName: string,
): MembershipParseResult {
  const data: ParsedMembershipRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  if (rawRows.length < 2) {
    return {
      data: [],
      errors: [{ row: 0, message: "File has no data rows" }],
      totalRows: 0,
      facilityId,
      fileName,
    };
  }

  const headerRow = rawRows[0].map((h) => normalizeHeader(String(h)));
  const colMap: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    const mapped = mapHeader(h);
    if (mapped && !(mapped in colMap)) colMap[mapped] = i;
  });

  if (!("surname" in colMap) && !("fee_category" in colMap)) {
    errors.push({
      row: 1,
      message: "Could not find required columns (Surname, Plan name). Check your headers.",
    });
    return { data: [], errors, totalRows: 0, facilityId, fileName };
  }

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    const fileRow = i + 1; // 1-based for humans
    try {
      const surname = String(row[colMap.surname] ?? "").trim();
      if (!surname) continue;

      const planName = String(row[colMap.fee_category] ?? "").trim();
      if (!planName) {
        errors.push({ row: fileRow, message: "Plan name is empty, skipped" });
        continue;
      }

      const netDueRaw = String(row[colMap.net_due] ?? "0").replace(/[^0-9.\-]/g, "");
      const netDue = parseFloat(netDueRaw) || 0;
      const discountRaw = String(row[colMap.discount_percent] ?? "0").replace(
        /[^0-9.\-]/g,
        "",
      );
      const discountPercent = parseFloat(discountRaw) || 0;

      const getRaw = (key: string): string | null => {
        if (!(key in colMap)) return null;
        const v = row[colMap[key]];
        if (v == null) return null;
        const s = String(v).trim();
        return s === "" ? null : s;
      };

      data.push({
        surname,
        initial: String(row[colMap.initial] ?? "").trim(),
        dob: parseDate(row[colMap.dob] ?? null),
        treating_dentist: String(row[colMap.treating_dentist] ?? "").trim(),
        fee_category: planName,
        discount_percent: discountPercent,
        net_due: netDue,
        pay_grp_id: getRaw("pay_grp_id"),
        patient_id: getRaw("patient_id"),
        title: getRaw("title"),
        pay_grp_size: getRaw("pay_grp_size"),
        multiple_payments: getRaw("multiple_payments"),
        unpaid_payment: getRaw("unpaid_payment"),
        late_joiner: getRaw("late_joiner"),
        supplementary_insurance: getRaw("supplementary_insurance"),
        implant_insurance: getRaw("implant_insurance"),
        annual_payer: getRaw("annual_payer"),
        explanatory_text: getRaw("explanatory_text"),
        source_facility_id: facilityId,
      });
    } catch (e) {
      errors.push({
        row: fileRow,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { data, errors, totalRows: data.length, facilityId, fileName };
}

export function parseMembershipCsv(
  text: string,
  fileName: string,
): MembershipParseResult {
  const facilityId = extractFacilityIdFromFilename(fileName);
  const rawRows = parseCsvText(text);
  return processMembershipRows(rawRows, facilityId, fileName);
}
