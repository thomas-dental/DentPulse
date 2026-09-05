/**
 * Patient Economics — Denplan / Practice Plan CSV membership import.
 *
 * No Dentally PAT required. Frontend uploads the export to Storage, then invokes
 * this function with the storage path. Matches rows to public.patients and
 * upserts into membership_upload_members.
 *
 * Practice Plan PDFs stay on the existing client parser path.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  parseMembershipCsv,
  type ParsedMembershipRow,
} from "./parseMembershipCsv.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "membership-imports";

interface ImportRequest {
  organizationId: string;
  locationId?: string | null;
  uploadMonth: number;
  uploadYear: number;
  storagePath: string;
  fileName: string;
}

interface PatientRow {
  id: string;
  pt_id: number | null;
  pt_legacy_id: string | null;
  pt_first_name: string | null;
  pt_last_name: string | null;
  pt_dob: string | null;
  location_id: string | null;
  pt_payment_plan_id: number | null;
}

interface UnmatchedDetail {
  row: number;
  surname: string;
  exportPatientId: string | null;
  reason: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

function memberKey(r: ParsedMembershipRow): string | null {
  const grp = r.pay_grp_id != null ? String(r.pay_grp_id).trim() : "";
  if (grp === "") return null;
  return `${grp}|${norm(r.surname)}|${norm(r.initial)}|${norm(r.dob)}`;
}

function dedupeKey(r: ParsedMembershipRow): string | null {
  const pid = r.patient_id != null ? String(r.patient_id).trim() : "";
  if (pid !== "") return `pid:${pid}`;
  const mk = memberKey(r);
  return mk ? `mk:${mk}` : null;
}

function lastNameFromExportSurname(surname: string): string {
  const parts = surname.trim().split(/\s+/);
  return parts[parts.length - 1] || surname;
}

function toInt(v: string | null): number | null {
  if (v == null) return null;
  const n = parseInt(v.replace(/[^0-9\-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function matchPatient(
  row: ParsedMembershipRow,
  byLegacy: Map<string, PatientRow>,
  byPtId: Map<string, PatientRow>,
  byNameDob: Map<string, PatientRow[]>,
): { patient: PatientRow | null; reason: string | null } {
  const exportId = row.patient_id?.trim() || "";
  if (exportId) {
    const viaLegacy = byLegacy.get(exportId.toLowerCase());
    if (viaLegacy) return { patient: viaLegacy, reason: null };
    const viaPt = byPtId.get(exportId);
    if (viaPt) return { patient: viaPt, reason: null };
  }

  if (row.dob) {
    const ln = norm(lastNameFromExportSurname(row.surname));
    const key = `${ln}|${row.dob}`;
    const candidates = byNameDob.get(key) || [];
    if (candidates.length === 1) return { patient: candidates[0], reason: null };
    if (candidates.length > 1) {
      const initial = norm(row.initial).charAt(0);
      if (initial) {
        const narrowed = candidates.filter(
          (p) => norm(p.pt_first_name).charAt(0) === initial,
        );
        if (narrowed.length === 1) return { patient: narrowed[0], reason: null };
        if (narrowed.length > 1) {
          return {
            patient: null,
            reason: "ambiguous_name_dob_initial",
          };
        }
      }
      return { patient: null, reason: "ambiguous_name_dob" };
    }
  }

  if (exportId) return { patient: null, reason: "export_patient_id_not_found" };
  if (!row.dob) return { patient: null, reason: "missing_dob_for_fallback_match" };
  return { patient: null, reason: "no_match" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: "Invalid authentication" }, 401);
    }

    const body = (await req.json()) as ImportRequest;
    const {
      organizationId,
      locationId = null,
      uploadMonth,
      uploadYear,
      storagePath,
      fileName,
    } = body;

    if (!organizationId || !storagePath || !fileName) {
      return jsonResponse(
        { error: "organizationId, storagePath, and fileName are required" },
        400,
      );
    }
    if (
      !Number.isInteger(uploadMonth) ||
      uploadMonth < 1 ||
      uploadMonth > 12 ||
      !Number.isInteger(uploadYear) ||
      uploadYear < 2000
    ) {
      return jsonResponse({ error: "Invalid uploadMonth / uploadYear" }, 400);
    }

    // Tenant authorization — same pattern as save-organization-settings
    const { data: membership, error: memErr } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (memErr) {
      console.error("[membership-import] membership check failed:", memErr.message);
      return jsonResponse({ error: "Failed to verify practice access" }, 500);
    }
    if (!membership) {
      return jsonResponse({ error: "Not a member of this organization" }, 403);
    }

    // Path must stay under this org prefix
    if (!storagePath.startsWith(`${organizationId}/`)) {
      return jsonResponse(
        { error: "storagePath must be under the organization prefix" },
        400,
      );
    }

    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download(storagePath);

    if (dlErr || !fileBlob) {
      console.error("[membership-import] download failed:", dlErr?.message);
      return jsonResponse(
        { error: `Failed to download file: ${dlErr?.message || "not found"}` },
        400,
      );
    }

    const text = await fileBlob.text();
    const parsed = parseMembershipCsv(text, fileName);

    if (parsed.data.length === 0) {
      return jsonResponse({
        success: true,
        processed: 0,
        matched: 0,
        unmatched: [],
        errors: parsed.errors,
        duplicatesDropped: 0,
        inserted: 0,
        facilityId: parsed.facilityId,
        message: "No valid data rows in file",
      });
    }

    // --- Load candidate patients for matching ---
    const exportIds = [
      ...new Set(
        parsed.data
          .map((r) => r.patient_id?.trim())
          .filter((x): x is string => !!x && x.length > 0),
      ),
    ];
    const surnames = [
      ...new Set(
        parsed.data.map((r) => lastNameFromExportSurname(r.surname).trim()).filter(Boolean),
      ),
    ];
    const dobs = [
      ...new Set(parsed.data.map((r) => r.dob).filter((x): x is string => !!x)),
    ];

    const patients: PatientRow[] = [];
    const PAGE = 1000;

    async function fetchInChunks(
      column: string,
      values: string[],
      asNumber = false,
    ) {
      for (let i = 0; i < values.length; i += 100) {
        const chunk = values.slice(i, i + 100);
        const filterVals = asNumber
          ? chunk.map((v) => Number(v)).filter((n) => Number.isFinite(n))
          : chunk;
        if (filterVals.length === 0) continue;
        let from = 0;
        for (;;) {
          const { data, error } = await supabase
            .from("patients")
            .select(
              "id, pt_id, pt_legacy_id, pt_first_name, pt_last_name, pt_dob, location_id, pt_payment_plan_id",
            )
            .eq("organization_id", organizationId)
            .is("deleted_at", null)
            .in(column, filterVals)
            .range(from, from + PAGE - 1);
          if (error) {
            console.error(`[membership-import] patients.${column} fetch:`, error.message);
            break;
          }
          patients.push(...((data || []) as PatientRow[]));
          if (!data || data.length < PAGE) break;
          from += PAGE;
        }
      }
    }

    if (exportIds.length > 0) {
      await fetchInChunks("pt_legacy_id", exportIds);
      const numericIds = exportIds.filter((id) => /^\d+$/.test(id));
      if (numericIds.length > 0) {
        await fetchInChunks("pt_id", numericIds, true);
      }
    }
    // Surname + DOB fallback pool
    for (let i = 0; i < surnames.length; i += 50) {
      const snChunk = surnames.slice(i, i + 50);
      for (let j = 0; j < dobs.length; j += 50) {
        const dobChunk = dobs.slice(j, j + 50);
        if (snChunk.length === 0 || dobChunk.length === 0) continue;
        const { data, error } = await supabase
          .from("patients")
          .select(
            "id, pt_id, pt_legacy_id, pt_first_name, pt_last_name, pt_dob, location_id, pt_payment_plan_id",
          )
          .eq("organization_id", organizationId)
          .is("deleted_at", null)
          .in("pt_last_name", snChunk)
          .in("pt_dob", dobChunk)
          .limit(2000);
        if (error) {
          console.error("[membership-import] surname/dob fetch:", error.message);
        } else if (data) {
          patients.push(...(data as PatientRow[]));
        }
      }
    }

    // Dedupe patients by row PK
    const byPk = new Map<string, PatientRow>();
    for (const p of patients) byPk.set(p.id, p);
    const uniquePatients = [...byPk.values()];

    const byLegacy = new Map<string, PatientRow>();
    const byPtId = new Map<string, PatientRow>();
    const byNameDob = new Map<string, PatientRow[]>();
    for (const p of uniquePatients) {
      if (p.pt_legacy_id) byLegacy.set(String(p.pt_legacy_id).trim().toLowerCase(), p);
      if (p.pt_id != null) byPtId.set(String(p.pt_id), p);
      if (p.pt_last_name && p.pt_dob) {
        const k = `${norm(p.pt_last_name)}|${p.pt_dob}`;
        const arr = byNameDob.get(k) || [];
        arr.push(p);
        byNameDob.set(k, arr);
      }
    }

    // Plan names for mapped_plan_name
    const planIds = [
      ...new Set(
        uniquePatients
          .map((p) => p.pt_payment_plan_id)
          .filter((x): x is number => x != null),
      ),
    ];
    const planNameByPpId = new Map<number, { id: string; name: string }>();
    if (planIds.length > 0) {
      const { data: plans } = await supabase
        .from("payment_plans")
        .select("id, pp_id, pp_name, pp_patient_friendly_name")
        .eq("organization_id", organizationId)
        .in("pp_id", planIds);
      for (const pl of plans || []) {
        if (pl.pp_id != null) {
          planNameByPpId.set(Number(pl.pp_id), {
            id: pl.id,
            name: pl.pp_patient_friendly_name || pl.pp_name || String(pl.pp_id),
          });
        }
      }
    }

    // In-batch dedupe
    const deduped: ParsedMembershipRow[] = [];
    const dedupedSourceRow: number[] = [];
    const seen = new Set<string>();
    let duplicatesDropped = 0;
    parsed.data.forEach((r, idx) => {
      const dk = dedupeKey(r);
      if (dk) {
        if (seen.has(dk)) {
          duplicatesDropped++;
          return;
        }
        seen.add(dk);
      }
      deduped.push(r);
      dedupedSourceRow.push(idx + 2); // approx file row (header=1)
    });

    const unmatched: UnmatchedDetail[] = [];
    const rowErrors = [...parsed.errors];
    let matched = 0;

    const dbRows = deduped.map((r, i) => {
      const fileRow = dedupedSourceRow[i];
      const { patient, reason } = matchPatient(r, byLegacy, byPtId, byNameDob);
      let mappedPlanId: string | null = null;
      let mappedPlanName: string | null = null;
      let locationIdResolved: string | null = null;
      let resolvedPatientId: string | null = r.patient_id;

      if (patient) {
        matched++;
        locationIdResolved = patient.location_id;
        resolvedPatientId =
          r.patient_id ??
          (patient.pt_legacy_id ? String(patient.pt_legacy_id) : null);
        if (patient.pt_payment_plan_id != null) {
          const plan = planNameByPpId.get(Number(patient.pt_payment_plan_id));
          if (plan) {
            mappedPlanId = plan.id;
            mappedPlanName = plan.name;
          }
        }
      } else {
        unmatched.push({
          row: fileRow,
          surname: r.surname,
          exportPatientId: r.patient_id,
          reason: reason || "no_match",
        });
      }

      return {
        organization_id: organizationId,
        location_id: locationIdResolved,
        upload_location_id: locationId ?? null,
        surname: r.surname,
        initial: r.initial || null,
        dob: r.dob || null,
        treating_dentist: r.treating_dentist || null,
        fee_category: r.fee_category,
        discount_percent: r.discount_percent,
        net_due: r.net_due,
        upload_month: uploadMonth,
        upload_year: uploadYear,
        uploaded_by: user.id,
        pay_grp_id: r.pay_grp_id,
        patient_id: resolvedPatientId,
        title: r.title,
        pay_grp_size: toInt(r.pay_grp_size),
        multiple_payments: r.multiple_payments,
        unpaid_payment: r.unpaid_payment,
        late_joiner: r.late_joiner,
        supplementary_insurance: r.supplementary_insurance,
        implant_insurance: r.implant_insurance,
        annual_payer: r.annual_payer,
        explanatory_text: r.explanatory_text,
        mapped_plan_id: mappedPlanId,
        mapped_plan_name: mappedPlanName,
        source_facility_id: r.source_facility_id,
      };
    });

    // Soft-delete existing same-month members that share member keys (re-import)
    const incomingKeys = new Set<string>();
    for (const r of deduped) {
      const mk = memberKey(r);
      if (mk) incomingKeys.add(mk);
    }
    if (incomingKeys.size > 0) {
      const grpIds = [
        ...new Set(
          [...incomingKeys].map((k) => k.split("|")[0]).filter(Boolean),
        ),
      ];
      const { data: existing, error: selErr } = await supabase
        .from("membership_upload_members")
        .select("id, pay_grp_id, surname, initial, dob")
        .eq("organization_id", organizationId)
        .eq("upload_month", uploadMonth)
        .eq("upload_year", uploadYear)
        .is("deleted_at", null)
        .in("pay_grp_id", grpIds);

      if (selErr) {
        console.error("[membership-import] select existing:", selErr.message);
      } else {
        const toDelete: string[] = [];
        for (const row of existing || []) {
          const grp = row.pay_grp_id != null ? String(row.pay_grp_id).trim() : "";
          if (!grp) continue;
          const k = `${grp}|${norm(row.surname)}|${norm(row.initial)}|${norm(row.dob)}`;
          if (incomingKeys.has(k)) toDelete.push(row.id);
        }
        if (toDelete.length > 0) {
          const { error: delErr } = await supabase
            .from("membership_upload_members")
            .update({ deleted_at: new Date().toISOString() })
            .in("id", toDelete);
          if (delErr) {
            console.error("[membership-import] soft-delete:", delErr.message);
          }
        }
      }
    }

    let inserted = 0;
    const BATCH = 500;
    for (let i = 0; i < dbRows.length; i += BATCH) {
      const batch = dbRows.slice(i, i + BATCH);
      const { error: insErr } = await supabase
        .from("membership_upload_members")
        .insert(batch);
      if (insErr) {
        console.error("[membership-import] insert batch:", insErr.message);
        rowErrors.push({
          row: 0,
          message: `Insert failed for batch starting at ${i}: ${insErr.message}`,
        });
      } else {
        inserted += batch.length;
      }
    }

    // Best-effort cleanup of uploaded object
    try {
      await supabase.storage.from(BUCKET).remove([storagePath]);
    } catch {
      /* ignore */
    }

    return jsonResponse({
      success: true,
      processed: deduped.length,
      matched,
      unmatchedCount: unmatched.length,
      unmatched: unmatched.slice(0, 100), // cap response size
      unmatchedTruncated: unmatched.length > 100,
      errors: rowErrors.slice(0, 50),
      duplicatesDropped,
      inserted,
      facilityId: parsed.facilityId,
      uploadMonth,
      uploadYear,
    });
  } catch (err) {
    console.error("[membership-import] unexpected:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal error" },
      500,
    );
  }
});
