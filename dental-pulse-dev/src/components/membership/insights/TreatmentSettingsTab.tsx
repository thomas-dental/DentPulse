import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Loader2,
  Pencil,
  Search,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from "@/components/ui/pagination";
import { AccountMultiSelect, type AccountOption } from "@/components/settings/AccountMultiSelect";
import { useTreatments } from "@/hooks/useTreatments";
import {
  useMembershipTreatmentSettings,
  type ImportTreatmentSettingRow,
  type MembershipTreatmentSetting,
} from "@/hooks/useMembershipTreatmentSettings";
import { ScopeBar } from "./ScopeBar";
import { nn, gbpExact } from "./format";

const PAGE_SIZE = 25;
type SortKey = "name" | "dentist" | "hygienist" | "lab" | "material";

const EXPORT_FIELDS = [
  "Treatment Name",
  "Treatment Code",
  "Dentist Time (min)",
  "Hygienist Time (min)",
  "Lab Cost (GBP)",
  "Material Cost (GBP)",
] as const;

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseImportNumber(v: string | undefined): number | null {
  const s = (v ?? "").trim();
  if (s === "" || s === "—" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** First/last page always shown, plus a window around the current page,
 *  collapsing the gaps into ellipses — same shape as TreatmentsList's own
 *  pagination so a client sees one consistent pattern app-wide. */
function getPageNumbers(current: number, total: number): Array<number | "ellipsis"> {
  const maxVisible = 5;
  if (total <= maxVisible) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: Array<number | "ellipsis"> = [1];
  if (current > 3) pages.push("ellipsis");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

function mins(v: number | null): string {
  return v == null ? "—" : `${nn(v)} min`;
}
function cost(v: number | null): string {
  return v == null ? "—" : gbpExact(v);
}

interface EditState {
  dentistTimeMinutes: string;
  hygienistTimeMinutes: string;
  labCost: string;
  materialCost: string;
}

/** A column header that toggles sort on click, with a chevron showing
 *  direction only on the currently active column — same unstyled-button +
 *  inline-flex pattern LedgerLabel uses for its ⓘ icon, so it inherits the
 *  th's own alignment/right-align instead of fighting it. */
function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: "asc" | "desc";
  onClick: (key: SortKey) => void;
}) {
  const isActive = active === sortKey;
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        font: "inherit",
        color: isActive ? "var(--mpi-ink)" : "inherit",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
      }}
    >
      {label}
      {isActive ? (
        dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
      ) : (
        <ChevronUp className="w-3 h-3" style={{ opacity: 0.25 }} />
      )}
    </button>
  );
}

function toEditState(s: MembershipTreatmentSetting): EditState {
  return {
    dentistTimeMinutes: s.dentistTimeMinutes != null ? String(s.dentistTimeMinutes) : "",
    hygienistTimeMinutes: s.hygienistTimeMinutes != null ? String(s.hygienistTimeMinutes) : "",
    labCost: s.labCost != null ? String(s.labCost) : "",
    materialCost: s.materialCost != null ? String(s.materialCost) : "",
  };
}

/** Membership module's own per-treatment cost settings — a hand-picked
 *  subset of the org's treatment catalog (multi-select adds/removes rows),
 *  each with its own dentist time / hygienist time / lab cost / material
 *  cost. Stored in membership_treatment_settings (migration
 *  20260816000001), read by nothing else in the app yet — this tab is the
 *  data-entry surface only; wiring it into Margin's cost-to-serve
 *  calculation is a separate, deliberately unstarted step (see chat). */
export function TreatmentSettingsTab() {
  const { treatments, isLoading: treatmentsLoading } = useTreatments();
  const {
    settings,
    isLoading: settingsLoading,
    setSelectedTreatments,
    isSelecting,
    updateSetting,
    isSaving,
    importSettings,
    isImporting,
  } = useMembershipTreatmentSettings();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);

  const treatmentById = useMemo(() => new Map(treatments.map((t) => [t.id, t])), [treatments]);

  const options: AccountOption[] = useMemo(
    () =>
      treatments
        .map((t) => ({
          value: t.id,
          label: t.treatment_code ? `${t.treatment_name} · ${t.treatment_code}` : t.treatment_name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [treatments],
  );

  const selectedIds = useMemo(() => settings.map((s) => s.treatmentId), [settings]);

  const selectedRows = useMemo(
    () =>
      settings
        .map((s) => ({ setting: s, treatment: treatmentById.get(s.treatmentId) }))
        .filter(
          (r): r is { setting: MembershipTreatmentSetting; treatment: NonNullable<typeof r.treatment> } =>
            !!r.treatment,
        )
        .sort((a, b) => a.treatment.treatment_name.localeCompare(b.treatment.treatment_name)),
    [settings, treatmentById],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return selectedRows;
    return selectedRows.filter(
      ({ treatment }) =>
        treatment.treatment_name.toLowerCase().includes(q) ||
        (treatment.treatment_code ?? "").toLowerCase().includes(q),
    );
  }, [selectedRows, search]);

  const sortedRows = useMemo(() => {
    const dirMul = sortDir === "asc" ? 1 : -1;
    const value = (row: (typeof filteredRows)[number]): string | number | null => {
      switch (sortKey) {
        case "name": return row.treatment.treatment_name;
        case "dentist": return row.setting.dentistTimeMinutes;
        case "hygienist": return row.setting.hygienistTimeMinutes;
        case "lab": return row.setting.labCost;
        case "material": return row.setting.materialCost;
      }
    };
    return [...filteredRows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      // Blanks always sort to the bottom, regardless of direction — a
      // reversed sort should surface the highest/lowest real numbers, not
      // bury them under every unset treatment.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * dirMul;
      }
      return (av - bv) * dirMul;
    });
  }, [filteredRows, sortKey, sortDir]);

  // Search/sort changing the result set, or the selection itself changing
  // (add/remove), can leave currentPage past the new last page.
  useEffect(() => {
    setCurrentPage(1);
  }, [search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const pageStart = (currentPageSafe - 1) * PAGE_SIZE;
  const pagedRows = sortedRows.slice(pageStart, pageStart + PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const exportCsv = () => {
    const csv = Papa.unparse({
      fields: [...EXPORT_FIELDS],
      data: selectedRows.map(({ setting, treatment }) => [
        treatment.treatment_name,
        treatment.treatment_code ?? "",
        setting.dentistTimeMinutes ?? "",
        setting.hygienistTimeMinutes ?? "",
        setting.labCost ?? "",
        setting.materialCost ?? "",
      ]),
    });
    downloadCsv(csv, "membership-treatment-settings.csv");
  };

  const triggerImport = () => fileInputRef.current?.click();

  // Matches each row to an existing treatment by code first, then by exact
  // name — never creates new catalog entries. Upserts via importSettings, so
  // an unselected treatment in the file gets added and an already-selected
  // one gets its four values overwritten; anything selected but absent from
  // the file is left alone (see importSettings' own comment).
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const byCode = new Map(
          treatments.filter((t) => t.treatment_code).map((t) => [t.treatment_code!.trim().toLowerCase(), t]),
        );
        const byName = new Map(treatments.map((t) => [t.treatment_name.trim().toLowerCase(), t]));

        const rows: ImportTreatmentSettingRow[] = [];
        let unmatched = 0;
        for (const raw of results.data) {
          const code = (raw["Treatment Code"] ?? "").trim().toLowerCase();
          const name = (raw["Treatment Name"] ?? "").trim().toLowerCase();
          const match = (code && byCode.get(code)) || (name && byName.get(name));
          if (!match) {
            unmatched++;
            continue;
          }
          rows.push({
            treatmentId: match.id,
            dentistTimeMinutes: parseImportNumber(raw["Dentist Time (min)"]),
            hygienistTimeMinutes: parseImportNumber(raw["Hygienist Time (min)"]),
            labCost: parseImportNumber(raw["Lab Cost (GBP)"]),
            materialCost: parseImportNumber(raw["Material Cost (GBP)"]),
          });
        }

        if (rows.length === 0) {
          toast.error(unmatched > 0 ? `No matching treatments found for any of ${unmatched} row(s).` : "No rows found in file.");
          return;
        }

        await importSettings(rows);
        toast.success(`Imported ${rows.length} treatment(s).${unmatched > 0 ? ` Skipped ${unmatched} unmatched row(s).` : ""}`);
      },
      error: (error) => {
        toast.error(`Couldn't read file: ${error.message}`);
      },
    });
  };

  // New selections start pre-filled from the treatment's own Treatment Setup
  // values (never re-read after that first add) — same "don't silently show
  // 0 for a real existing number" spirit as the Settings tab's exam/hygiene
  // entitlement editor. Hygienist time has no catalog equivalent to start
  // from, so it's left blank.
  const applySelection = (ids: string[]) => {
    const defaultsByTreatmentId = new Map<
      string,
      { dentistTimeMinutes: number | null; labCost: number | null; materialCost: number | null }
    >();
    for (const id of ids) {
      const t = treatmentById.get(id);
      if (!t) continue;
      defaultsByTreatmentId.set(id, {
        dentistTimeMinutes: t.duration_minutes != null ? Number(t.duration_minutes) : null,
        labCost: t.lab_bill != null ? Number(t.lab_bill) : null,
        materialCost: t.material_cost != null ? Number(t.material_cost) : null,
      });
    }
    setSelectedTreatments({ treatmentIds: ids, defaultsByTreatmentId });
  };

  const startEdit = (s: MembershipTreatmentSetting) => {
    setEditingId(s.treatmentId);
    setEditState(toEditState(s));
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditState(null);
  };
  const saveEdit = async (treatmentId: string) => {
    if (!editState) return;
    const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Number(v)));
    await updateSetting({
      treatmentId,
      dentistTimeMinutes: num(editState.dentistTimeMinutes),
      hygienistTimeMinutes: num(editState.hygienistTimeMinutes),
      labCost: num(editState.labCost),
      materialCost: num(editState.materialCost),
    });
    setEditingId(null);
    setEditState(null);
  };
  const removeTreatment = (treatmentId: string) => {
    if (editingId === treatmentId) cancelEdit();
    applySelection(selectedIds.filter((id) => id !== treatmentId));
  };

  const isLoading = treatmentsLoading || settingsLoading;

  return (
    <div className="mpi space-y-6">
      <ScopeBar
        title="Treatments"
        subtitle="Dentist time, hygienist time, lab cost and material cost per treatment — membership-only, separate from the general Treatment Setup catalog"
        action={
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleImportFile}
            />
            <Button variant="outline" size="sm" onClick={triggerImport} disabled={isLoading || isImporting}>
              {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Import CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={selectedRows.length === 0}>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        }
      />

      <div>
        <p className="mpi-eyebrow">Add treatments</p>
        <div className="mpi-card">
          <AccountMultiSelect
            options={options}
            value={selectedIds}
            onChange={applySelection}
            placeholder="Select treatments to cost under membership…"
            itemNoun="treatment"
            disabled={isLoading || isSelecting}
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mpi-mb" style={{ marginBottom: 6 }}>
          <p className="mpi-eyebrow" style={{ margin: 0 }}>
            Selected treatments · {nn(selectedRows.length)}
            {search.trim() && ` · ${nn(sortedRows.length)} matching`}
          </p>
          {selectedRows.length > 0 && (
            <div style={{ position: "relative", width: 220 }}>
              <Search
                className="w-3.5 h-3.5"
                style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--mpi-t3)" }}
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search treatments…"
                className="h-8 text-sm"
                style={{ paddingLeft: 28 }}
                aria-label="Search selected treatments"
              />
            </div>
          )}
        </div>
        {isLoading ? (
          <div className="mpi-card text-sm text-center py-8" style={{ color: "var(--mpi-t3)" }}>
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
            Loading…
          </div>
        ) : selectedRows.length === 0 ? (
          <div className="mpi-card text-sm text-center py-8" style={{ color: "var(--mpi-t3)" }}>
            No treatments selected yet — pick some above to set their membership cost.
          </div>
        ) : sortedRows.length === 0 ? (
          <div className="mpi-card text-sm text-center py-8" style={{ color: "var(--mpi-t3)" }}>
            No selected treatments match "{search}".
          </div>
        ) : (
          <div className="mpi-card" style={{ opacity: isSelecting ? 0.6 : 1 }}>
            <table className="mpi-tb">
              <thead>
                <tr>
                  <th className="l"><SortHeader label="Treatment" sortKey="name" active={sortKey} dir={sortDir} onClick={toggleSort} /></th>
                  <th><SortHeader label="Dentist time" sortKey="dentist" active={sortKey} dir={sortDir} onClick={toggleSort} /></th>
                  <th><SortHeader label="Hygienist time" sortKey="hygienist" active={sortKey} dir={sortDir} onClick={toggleSort} /></th>
                  <th><SortHeader label="Lab cost" sortKey="lab" active={sortKey} dir={sortDir} onClick={toggleSort} /></th>
                  <th><SortHeader label="Material cost" sortKey="material" active={sortKey} dir={sortDir} onClick={toggleSort} /></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map(({ setting, treatment }) => {
                  const isEditing = editingId === setting.treatmentId;
                  return (
                    <tr key={setting.treatmentId}>
                      <td>
                        {treatment.treatment_name}
                        {treatment.treatment_code && (
                          <span className="sitecol" style={{ marginLeft: 6 }}>
                            {treatment.treatment_code}
                          </span>
                        )}
                      </td>
                      {isEditing && editState ? (
                        <>
                          <td>
                            <Input
                              type="number"
                              min={0}
                              value={editState.dentistTimeMinutes}
                              onChange={(e) => setEditState({ ...editState, dentistTimeMinutes: e.target.value })}
                              className="h-7 w-20 text-right px-2 ml-auto"
                              aria-label={`Dentist time for ${treatment.treatment_name}`}
                            />
                          </td>
                          <td>
                            <Input
                              type="number"
                              min={0}
                              value={editState.hygienistTimeMinutes}
                              onChange={(e) => setEditState({ ...editState, hygienistTimeMinutes: e.target.value })}
                              className="h-7 w-20 text-right px-2 ml-auto"
                              aria-label={`Hygienist time for ${treatment.treatment_name}`}
                            />
                          </td>
                          <td>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={editState.labCost}
                              onChange={(e) => setEditState({ ...editState, labCost: e.target.value })}
                              className="h-7 w-20 text-right px-2 ml-auto"
                              aria-label={`Lab cost for ${treatment.treatment_name}`}
                            />
                          </td>
                          <td>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={editState.materialCost}
                              onChange={(e) => setEditState({ ...editState, materialCost: e.target.value })}
                              className="h-7 w-20 text-right px-2 ml-auto"
                              aria-label={`Material cost for ${treatment.treatment_name}`}
                            />
                          </td>
                          <td>
                            <div className="flex items-center gap-1 justify-end">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                disabled={isSaving}
                                onClick={() => saveEdit(setting.treatmentId)}
                                aria-label={`Save ${treatment.treatment_name}`}
                              >
                                <Check className="w-4 h-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                disabled={isSaving}
                                onClick={cancelEdit}
                                aria-label="Cancel"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{mins(setting.dentistTimeMinutes)}</td>
                          <td>{mins(setting.hygienistTimeMinutes)}</td>
                          <td>{cost(setting.labCost)}</td>
                          <td>{cost(setting.materialCost)}</td>
                          <td>
                            <div className="flex items-center gap-1 justify-end">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => startEdit(setting)}
                                aria-label={`Edit ${treatment.treatment_name}`}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => removeTreatment(setting.treatmentId)}
                                aria-label={`Remove ${treatment.treatment_name}`}
                              >
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div
                className="flex items-center justify-between"
                style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--mpi-line)" }}
              >
                <span className="text-xs" style={{ color: "var(--mpi-t3)" }}>
                  Showing {nn(pageStart + 1)}–{nn(Math.min(pageStart + PAGE_SIZE, sortedRows.length))} of {nn(sortedRows.length)}
                </span>
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPageSafe === 1}
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Prev
                      </Button>
                    </PaginationItem>
                    {getPageNumbers(currentPageSafe, totalPages).map((page, i) =>
                      page === "ellipsis" ? (
                        <PaginationItem key={`e${i}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={page}>
                          <Button
                            variant={page === currentPageSafe ? "outline" : "ghost"}
                            size="icon"
                            className="h-7 w-7 text-xs"
                            onClick={() => setCurrentPage(page)}
                          >
                            {page}
                          </Button>
                        </PaginationItem>
                      ),
                    )}
                    <PaginationItem>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPageSafe === totalPages}
                      >
                        Next
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Button>
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </div>
        )}
        <p className="text-xs mt-2" style={{ color: "var(--mpi-t3)" }}>
          These four figures are membership-only — editing them never changes Treatment Setup, Chair Efficiency
          or any other page's costing, and editing the general catalog never changes these. New selections start
          pre-filled from the treatment's own Treatment Setup duration/lab/material values as a starting point;
          edit any of the four independently from there. Hygienist time has no catalog equivalent, so it starts
          blank.
        </p>
      </div>
    </div>
  );
}
