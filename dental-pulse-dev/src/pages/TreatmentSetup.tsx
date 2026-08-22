import { useState, useMemo, useEffect } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@/components/ui/pagination";
import { TreatmentCategoriesManagement } from "@/components/treatments/TreatmentCategoriesManagement";
import { TreatmentFileUpload } from "@/components/treatments/TreatmentFileUpload";
import { TreatmentFilePreview } from "@/components/treatments/TreatmentFilePreview";
import { useTreatments } from "@/hooks/useTreatments";
import { useTreatmentCategories } from "@/hooks/useTreatmentCategories";
import { useLocations } from "@/hooks/useLocations";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/hooks/useAuth";
import { useFilters } from "@/contexts/FilterContext";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Treatment } from "@/types/treatment";
import { toast } from "sonner";
import {
  Search,
  Download,
  Upload,
  Plus,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Package,
  Loader2,
  Clock,
} from "lucide-react";

// Page-size options offered in the per-page dropdown.
// 10 default keeps the current behaviour; 100 gives a near-flat view
// without becoming unscrollable.
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 10;

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "-";
  return `£${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return "-";
  return `${value}%`;
}

function formatMinutes(value: number | null | undefined): string {
  if (value == null) return "-";
  return `${value}`;
}

function ComingSoonPlaceholder({
  title,
  icon: Icon,
}: {
  title: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <Icon className="w-12 h-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-semibold mb-1">{title}</h3>
        <p className="text-muted-foreground text-sm">
          This feature is coming soon.
        </p>
      </CardContent>
    </Card>
  );
}

// --- CSV Export ---
function exportTreatmentsToCSV(treatments: Treatment[]) {
  const headers = [
    "Treatment Code",
    "Treatment Name",
    "Category",
    "Treatment Type",
    "Price",
    "Dentist Time Mins",
    "Therapist Time Mins",
    "Lab Bill",
    "Lab Bill Discount",
    "Material Cost",
    "Associate Pay %",
    "Therapist Pay Rate",
    "Finance Fee %",
    "Operating Cost Per Surgery Per Hour",
    "Completion Time Used Mins",
  ];

  const rows = treatments.map((t) => [
    t.treatment_code ?? "",
    t.treatment_name,
    t.category?.name ?? "",
    t.treatment_type,
    t.price ?? 0,
    t.duration_minutes ?? 0,
    t.therapist_time_mins ?? 0,
    t.lab_bill ?? 0,
    t.lab_bill_discount ?? 0,
    t.material_cost ?? 0,
    t.percent_fees ?? 0,
    t.therapist_pay_rate ?? 0,
    t.finance_fee ?? 0,
    t.hourly_rate ?? 0,
    t.average_time_minutes ?? 0,
  ]);

  const escapeCSV = (cell: any) => {
    const str = String(cell);
    return str.includes(",") || str.includes('"') || str.includes("\n")
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };

  const csvContent = [
    headers.map(escapeCSV).join(","),
    ...rows.map((row) => row.map(escapeCSV).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `treatments-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// --- Add Treatment Form Default State ---
const defaultFormData = {
  treatment_code: "",
  treatment_name: "",
  category_id: "",
  treatment_type: "private" as "private" | "nhs",
  price: 0,
  duration_minutes: 0,
  therapist_time_mins: 0,
  lab_bill: 0,
  material_cost: 0,
  percent_fees: 0,
  therapist_pay_rate: 0,
  hourly_rate: 0,
  finance_fee: 0,
  average_time_minutes: 0,
};

// Map internal tab keys to permission registry card keys
const SETUP_TAB_CARD_MAP: Record<string, string> = {
  treatments: "setup_treatments_tab",
  // steps: "setup_steps_tab",
  categories: "setup_categories_tab",
  products: "setup_products_tab",
};
const SETUP_TABS = [
  "treatments",
  //  "steps",
  "categories",
  "products",
] as const;

export default function TreatmentSetup() {
  const { can } = usePermissions();

  // Filter visible tabs by permission
  const visibleTabs = SETUP_TABS.filter((tab) =>
    can("treatments", "view", SETUP_TAB_CARD_MAP[tab]),
  );
  const [activeTab, setActiveTab] = useState<string>(visibleTabs[0] || "treatments");

  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.includes(activeTab as any)) {
      setActiveTab(visibleTabs[0]);
    }
  }, [visibleTabs.join(",")]);

  // Helper: check CRUD for the active setup tab
  const canSetup = (
    action: "add" | "update" | "delete" | "export" | "import",
    tab: string = "treatments",
  ) => {
    return can(
      "treatments",
      action,
      SETUP_TAB_CARD_MAP[tab] || "setup_treatments_tab",
    );
  };

  const navigate = useNavigate();
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  // When a specific location is selected in the top filter bar, scope the
  // list to that location's treatments (plus org-wide catalog entries whose
  // location_id is NULL). When null ("All Regions"), show every treatment.
  const { selectedLocationId } = useFilters();
  const {
    treatments,
    isLoading: treatmentsLoading,
    createTreatment,
    deleteTreatment,
    isCreating,
    isDeleting,
  } = useTreatments({ locationId: selectedLocationId, includeInactive: true });
  const {
    categories,
    isLoading: categoriesLoading,
    createCategory,
    updateCategory,
    deleteCategory,
  } = useTreatmentCategories();
  const { locations, regions } = useLocations();

  // Table state
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Add Treatment dialog state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [formData, setFormData] = useState(defaultFormData);

  // Import dialog state
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

  // Dropdown options = categories actually used by treatments visible
  // in the table. The treatments list above is already scoped to the
  // selected location (via useTreatments({ locationId })), so deriving
  // the dropdown from it guarantees every option corresponds to at
  // least one row the user can see — no leak of categories that have
  // zero treatments here, and no mysterious filter-with-empty-result.
  //
  // Earlier attempts went via DB columns (treatment_categories.location_id,
  // a separate link table, TPI-derived RPCs). All produced dropdowns that
  // didn't match the table — because the table uses integration_id
  // scoping (Dentally API key shared across sister practices) while
  // those approaches scoped narrower than the table. Matching the
  // table's own scope is the only way the two stay consistent.
  const availableCategories = useMemo(() => {
    const usedIds = new Set<string>();
    for (const t of treatments) {
      if (t.category_id) usedIds.add(t.category_id);
    }
    return categories.filter((c) => usedIds.has(c.id));
  }, [categories, treatments]);

  // If the active filter points at a category no longer in the
  // location-scoped list (e.g. user switched location), drop back to "all"
  // so the table doesn't render empty with no obvious cause.
  useEffect(() => {
    if (
      categoryFilter !== "all" &&
      !availableCategories.some((c) => c.id === categoryFilter)
    ) {
      setCategoryFilter("all");
    }
  }, [availableCategories, categoryFilter]);

  // Filter treatments by search and category
  const filteredTreatments = useMemo(() => {
    let result = treatments;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.treatment_name.toLowerCase().includes(q) ||
          (t.treatment_code && t.treatment_code.toLowerCase().includes(q)),
      );
    }

    if (categoryFilter !== "all") {
      result = result.filter((t) => t.category_id === categoryFilter);
    }

    return result;
  }, [treatments, searchQuery, categoryFilter]);

  // Pagination
  const totalPages = Math.max(
    1,
    Math.ceil(filteredTreatments.length / pageSize),
  );
  const paginatedTreatments = filteredTreatments.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handleCategoryFilterChange = (value: string) => {
    setCategoryFilter(value);
    setCurrentPage(1);
  };

  const handleDeleteConfirm = () => {
    if (deleteId) {
      deleteTreatment(deleteId);
      setDeleteId(null);
    }
  };

  // --- Export handler ---
  const handleExport = () => {
    if (treatments.length === 0) {
      toast.error("No treatments to export");
      return;
    }
    exportTreatmentsToCSV(treatments);
    toast.success(`Exported ${treatments.length} treatments to CSV`);
  };

  // --- Add Treatment handlers ---
  const handleNumberChange = (field: string, value: string) => {
    const num = value === "" ? 0 : parseFloat(value);
    setFormData((prev) => ({ ...prev, [field]: isNaN(num) ? 0 : num }));
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.treatment_name.trim()) {
      toast.error("Treatment name is required");
      return;
    }

    try {
      await createTreatment({
        treatment_name: formData.treatment_name,
        treatment_code: formData.treatment_code || null,
        category_id: formData.category_id || null,
        treatment_type: formData.treatment_type,
        price: formData.price,
        duration_minutes: formData.duration_minutes,
        therapist_time_mins: formData.therapist_time_mins,
        lab_bill: formData.lab_bill,
        material_cost: formData.material_cost,
        percent_fees: formData.percent_fees,
        therapist_pay_rate: formData.therapist_pay_rate,
        hourly_rate: formData.hourly_rate,
        finance_fee: formData.finance_fee,
        average_time_minutes: formData.average_time_minutes,
      });
      setIsAddOpen(false);
      setFormData(defaultFormData);
    } catch {
      // Error toast is handled by the hook
    }
  };

  // --- Import handlers ---
  const [isImporting, setIsImporting] = useState(false);

  const handleFileSelected = (file: File) => {
    setImportFile(file);
  };

  // CSV header -> DB column mapping
  const CSV_FIELD_MAP: Record<string, string> = {
    "treatment code": "treatment_code",
    code: "treatment_code",
    "treatment name": "treatment_name",
    name: "treatment_name",
    "treatment type": "treatment_type",
    type: "treatment_type",
    price: "price",
    amount: "price",
    "dentist time mins": "duration_minutes",
    "dentist time (min)": "duration_minutes",
    duration_minutes: "duration_minutes",
    "therapist time mins": "therapist_time_mins",
    "therapist time (min)": "therapist_time_mins",
    "lab bill": "lab_bill",
    "lab bill discount": "lab_bill_discount",
    "material cost": "material_cost",
    "associate pay %": "percent_fees",
    "associate pay (%)": "percent_fees",
    percent_fees: "percent_fees",
    "therapist pay rate": "therapist_pay_rate",
    "therapist pay": "therapist_pay_rate",
    "finance fee %": "finance_fee",
    "finance fee (%)": "finance_fee",
    "operating cost per surgery per hour": "hourly_rate",
    "op cost (hourly rate)": "hourly_rate",
    "op cost": "hourly_rate",
    hourly_rate: "hourly_rate",
    "completion time used mins": "average_time_minutes",
    "completion time (min)": "average_time_minutes",
    average_time_minutes: "average_time_minutes",
    category: "category_name",
    "category name": "category_name",
  };

  const handleImportProcess = async (file: File) => {
    if (!organizationId || !user?.id) {
      toast.error("No organization or user");
      return;
    }

    setIsImporting(true);
    try {
      const text = await file.text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });

      if (parsed.data.length === 0) {
        toast.error("No rows found in CSV");
        setIsImporting(false);
        return;
      }

      const rows = parsed.data as Record<string, string>[];

      // Build header mapping from CSV columns to DB columns
      const csvHeaders = Object.keys(rows[0]);
      const headerMap: Record<string, string> = {};
      for (const csvHeader of csvHeaders) {
        const normalized = csvHeader.trim().toLowerCase();
        if (CSV_FIELD_MAP[normalized]) {
          headerMap[csvHeader] = CSV_FIELD_MAP[normalized];
        }
      }

      // Convert rows to DB-column-keyed objects
      const treatments = rows
        .map((row) => {
          const obj: Record<string, any> = {};
          for (const [csvCol, dbCol] of Object.entries(headerMap)) {
            const val = row[csvCol]?.trim() ?? "";
            if (
              dbCol === "treatment_name" ||
              dbCol === "treatment_code" ||
              dbCol === "treatment_type" ||
              dbCol === "category_name"
            ) {
              obj[dbCol] = val;
            } else {
              // Numeric field
              obj[dbCol] = val === "" ? null : String(parseFloat(val));
            }
          }
          return obj;
        })
        .filter(
          (obj) => obj.treatment_name && obj.treatment_name.trim() !== "",
        );

      if (treatments.length === 0) {
        toast.error(
          'No valid treatment rows found. Make sure CSV has a "Treatment Name" column.',
        );
        setIsImporting(false);
        return;
      }

      // Resolve category names to category IDs
      const categoryNameMap = new Map<string, string>();
      for (const cat of categories) {
        categoryNameMap.set(cat.name.trim().toLowerCase(), cat.id);
      }
      for (const t of treatments) {
        if (t.category_name) {
          const catId = categoryNameMap.get(
            String(t.category_name).trim().toLowerCase(),
          );
          if (catId) {
            t.category_id = catId;
          }
          delete t.category_name;
        }
      }

      // Call the DB function (bypasses RLS via SECURITY DEFINER)
      const { data: result, error } = await (supabase as any).rpc(
        "bulk_upsert_treatments",
        {
          p_organization_id: organizationId,
          p_user_id: user.id,
          p_treatments: treatments,
        },
      );

      if (error) {
        toast.error(`Import failed: ${error.message}`);
      } else {
        const r = result as {
          success: boolean;
          inserted: number;
          updated: number;
          errors: number;
        };
        const parts = [];
        if (r.inserted > 0) parts.push(`${r.inserted} added`);
        if (r.updated > 0) parts.push(`${r.updated} updated`);
        if (r.errors > 0) parts.push(`${r.errors} errors`);
        toast.success(`Import complete: ${parts.join(", ")}`);
        queryClient.invalidateQueries({
          queryKey: ["treatments", organizationId],
        });
        setImportFile(null);
        setIsImportOpen(false);
      }
    } catch (error: any) {
      toast.error(`Import failed: ${error.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportCancel = () => {
    setImportFile(null);
  };

  // --- Remove duplicates handler ---
  const handleRemoveDuplicates = async () => {
    if (!organizationId || !user?.id) return;
    try {
      const { data: result, error } = await (supabase as any).rpc(
        "remove_duplicate_treatments",
        {
          p_organization_id: organizationId,
          p_user_id: user.id,
        },
      );
      if (error) {
        toast.error(`Failed: ${error.message}`);
      } else {
        const r = result as { success: boolean; removed: number };
        if (r.removed === 0) {
          toast.info("No duplicate treatments found");
        } else {
          toast.success(`Removed ${r.removed} duplicate treatments`);
          queryClient.invalidateQueries({
            queryKey: ["treatments", organizationId],
          });
        }
      }
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    }
  };

  return (
    <MainLayout userRole="admin">
      <Helmet>
        <title>Treatment Setup | DentPulse</title>
      </Helmet>

      <div className="space-y-6 pt-6">
        {/* Breadcrumb + Header */}
        <div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
            <Link to="/treatments/insights" className="hover:text-foreground">
              Treatment
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">Setup</span>
          </div>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">Treatment Setup</h1>
              <p className="text-muted-foreground">
                Configure treatments, steps, categories, and product costs
              </p>
            </div>
            <div className="flex items-center gap-2">
              {can("treatments", "export", "setup_treatments_tab") && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleExport}
                >
                  <Download className="w-4 h-4" />
                  Export
                </Button>
              )}
              {can("treatments", "import", "setup_treatments_tab") && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => setIsImportOpen(true)}
                  disabled={isImporting}
                >
                  {isImporting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  {isImporting ? "Importing..." : "Import"}
                </Button>
              )}
              {can("treatments", "delete", "setup_treatments_tab") && (
                <Button
                  variant="outline"
                  className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={handleRemoveDuplicates}
                >
                  <Trash2 className="w-4 h-4" />
                  Remove Duplicates
                </Button>
              )}
              {can("treatments", "add", "setup_treatments_tab") && (
                <Button
                  className="gap-2"
                  onClick={() => {
                    setFormData(defaultFormData);
                    setIsAddOpen(true);
                  }}
                >
                  <Plus className="w-4 h-4" />
                  Add Treatment
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-4"
        >
          <TabsList>
            {visibleTabs.includes("treatments") && (
              <TabsTrigger value="treatments">Treatments</TabsTrigger>
            )}
            {/* {visibleTabs.includes("steps") && (
              <TabsTrigger value="steps">Steps</TabsTrigger>
            )} */}
            {visibleTabs.includes("categories") && (
              <TabsTrigger value="categories">Categories</TabsTrigger>
            )}
            {visibleTabs.includes("products") && (
              <TabsTrigger value="products">
                Products &amp; Sundries
              </TabsTrigger>
            )}
          </TabsList>

          {/* Tab 1: Treatments */}
          <TabsContent value="treatments">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle>Treatments</CardTitle>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search treatments..."
                      value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      className="pl-9 w-[220px]"
                    />
                  </div>
                  <Select
                    value={categoryFilter}
                    onValueChange={handleCategoryFilterChange}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {availableCategories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Table */}
                <div className="overflow-x-auto">
                  <Table
                    className="w-full"
                    style={{ borderCollapse: "collapse" }}
                  >
                    <TableHeader>
                      <TableRow>
                        <TableHead className="border-r border-b border-black">
                          Case Type
                        </TableHead>
                        <TableHead className="text-right border-r border-b border-black">
                          Treatment Value
                        </TableHead>
                        <TableHead className="text-right border-r border-b border-black">
                          Dentist Time
                        </TableHead>
                        <TableHead className="text-right border-r border-b border-black">
                          Therapist Time
                        </TableHead>
                        <TableHead className="text-right border-r border-b border-black">
                          Lab Bill
                        </TableHead>
                        <TableHead className="text-right border-r border-b border-black">
                          Material Cost
                        </TableHead>
                        <TableHead className="text-right border-r border-b border-black">
                          Associate Pay %
                        </TableHead>
                        <TableHead className="text-right border-r border-b border-black">
                          Therapist Pay
                        </TableHead>
                        <TableHead className="text-right border-r border-b border-black">
                          Finance Fee %
                        </TableHead>
                        <TableHead className="text-right border-r border-b border-black">
                          OP Cost
                        </TableHead>
                        <TableHead className="text-right border-r border-b border-black">
                          Completion Time
                        </TableHead>
                        <TableHead className="text-right border-r border-b border-black">
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {treatmentsLoading ? (
                        <TableRow>
                          <TableCell
                            colSpan={12}
                            className="text-center py-8 text-muted-foreground border-r border-b border-black"
                          >
                            Loading treatments...
                          </TableCell>
                        </TableRow>
                      ) : paginatedTreatments.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={12}
                            className="text-center py-8 text-muted-foreground border-r border-b border-black"
                          >
                            {searchQuery || categoryFilter !== "all"
                              ? "No treatments match your filters."
                              : 'No treatments found. Click "Add Treatment" to create one.'}
                          </TableCell>
                        </TableRow>
                      ) : (
                        paginatedTreatments.map((treatment) => (
                          <TableRow key={treatment.id}>
                            <TableCell className="border-r border-b border-black">
                              <div>
                                <div className="font-medium flex items-center gap-2">
                                  <span
                                    className={
                                      treatment.is_active === false
                                        ? "text-muted-foreground"
                                        : ""
                                    }
                                  >
                                    {treatment.treatment_name}
                                  </span>
                                  {treatment.is_active === false && (
                                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                                      Archived
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {[
                                    treatment.treatment_code,
                                    treatment.category?.name,
                                  ]
                                    .filter(Boolean)
                                    .join(" \u2022 ")}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right border-r border-b border-black">
                              {formatCurrency(treatment.price)}
                            </TableCell>
                            <TableCell className="text-right border-r border-b border-black">
                              {formatMinutes(treatment.duration_minutes)}
                            </TableCell>
                            <TableCell className="text-right border-r border-b border-black">
                              {formatMinutes(treatment.therapist_time_mins)}
                            </TableCell>
                            <TableCell className="text-right border-r border-b border-black">
                              {formatCurrency(treatment.lab_bill)}
                            </TableCell>
                            <TableCell className="text-right border-r border-b border-black">
                              {formatCurrency(treatment.material_cost)}
                            </TableCell>
                            <TableCell className="text-right border-r border-b border-black">
                              {formatPercent(treatment.percent_fees)}
                            </TableCell>
                            <TableCell className="text-right border-r border-b border-black">
                              {formatCurrency(treatment.therapist_pay_rate)}
                            </TableCell>
                            <TableCell className="text-right border-r border-b border-black">
                              {formatPercent(treatment.finance_fee)}
                            </TableCell>
                            <TableCell className="text-right border-r border-b border-black">
                              {formatCurrency(treatment.hourly_rate)}
                            </TableCell>
                            <TableCell className="text-right border-r border-b border-black">
                              {formatMinutes(treatment.average_time_minutes)}
                            </TableCell>
                            <TableCell className="text-right border-r border-b border-black">
                              <div className="flex items-center justify-end gap-1">
                                {can(
                                  "treatments",
                                  "update",
                                  "setup_treatments_tab",
                                ) && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() =>
                                      navigate(
                                        `/treatments/${treatment.id}/edit`,
                                      )
                                    }
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                )}
                                {can(
                                  "treatments",
                                  "delete",
                                  "setup_treatments_tab",
                                ) && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setDeleteId(treatment.id)}
                                    disabled={isDeleting}
                                  >
                                    <Trash2 className="w-4 h-4 text-destructive" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {filteredTreatments.length > 0 && (
                  <div className="flex items-center justify-between pt-2 flex-wrap gap-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="text-sm text-muted-foreground">
                        Showing {(currentPage - 1) * pageSize + 1}–
                        {Math.min(
                          currentPage * pageSize,
                          filteredTreatments.length,
                        )}{" "}
                        of {filteredTreatments.length} treatments
                      </p>
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor="page-size"
                          className="text-sm text-muted-foreground"
                        >
                          Per page
                        </Label>
                        <Select
                          value={String(pageSize)}
                          onValueChange={(v) => {
                            // Snap back to page 1 so the user doesn't end up
                            // looking at an out-of-range page after shrinking
                            // the visible window or jumping to a totally
                            // different slice of the list.
                            setPageSize(Number(v));
                            setCurrentPage(1);
                          }}
                        >
                          <SelectTrigger
                            id="page-size"
                            className="h-8 w-[80px]"
                          >
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
                              onClick={() =>
                                setCurrentPage((p) => Math.max(1, p - 1))
                              }
                              disabled={currentPage === 1}
                              className="gap-1 pl-2.5"
                            >
                              <ChevronLeft className="h-4 w-4" />
                              <span>Previous</span>
                            </Button>
                          </PaginationItem>
                          {/* Build the visible page list with first, last,
                              current ±1, and ellipses for the gaps. Same
                              pattern as TreatmentsList.tsx so the two
                              treatment screens behave consistently. */}
                          {(() => {
                            const pages: (number | string)[] = [];
                            const maxVisible = 5;
                            if (totalPages <= maxVisible) {
                              for (let i = 1; i <= totalPages; i++)
                                pages.push(i);
                            } else {
                              pages.push(1);
                              if (currentPage > 3) pages.push("ellipsis-start");
                              const start = Math.max(2, currentPage - 1);
                              const end = Math.min(
                                totalPages - 1,
                                currentPage + 1,
                              );
                              for (let i = start; i <= end; i++) pages.push(i);
                              if (currentPage < totalPages - 2)
                                pages.push("ellipsis-end");
                              pages.push(totalPages);
                            }
                            return pages.map((p, idx) =>
                              p === "ellipsis-start" || p === "ellipsis-end" ? (
                                <PaginationItem key={`ell-${idx}`}>
                                  <PaginationEllipsis />
                                </PaginationItem>
                              ) : (
                                <PaginationItem key={p}>
                                  <Button
                                    variant={
                                      currentPage === p ? "outline" : "ghost"
                                    }
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
                              onClick={() =>
                                setCurrentPage((p) =>
                                  Math.min(totalPages, p + 1),
                                )
                              }
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
          </TabsContent>

          {/* Tab 2: Steps */}
          {/* <TabsContent value="steps">
            <ComingSoonPlaceholder title="Treatment Steps" icon={Clock} />
          </TabsContent> */}

          {/* Tab 3: Categories */}
          <TabsContent value="categories">
            <TreatmentCategoriesManagement
              categories={categories}
              locations={locations}
              regions={regions}
              onCreate={createCategory}
              onUpdate={updateCategory}
              onDelete={deleteCategory}
              isLoading={categoriesLoading}
              canAdd={canSetup("add", "categories")}
              canUpdate={canSetup("update", "categories")}
              canDelete={canSetup("delete", "categories")}
            />
          </TabsContent>

          {/* Tab 4: Products & Sundries */}
          <TabsContent value="products">
            <ComingSoonPlaceholder title="Products & Sundries" icon={Package} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Treatment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this treatment? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Treatment Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Treatment</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="add_treatment_name">Name *</Label>
                <Input
                  id="add_treatment_name"
                  value={formData.treatment_name}
                  onChange={(e) =>
                    setFormData({ ...formData, treatment_name: e.target.value })
                  }
                  placeholder="Treatment name"
                  required
                />
              </div>
              <div>
                <Label htmlFor="add_treatment_code">Code</Label>
                <Input
                  id="add_treatment_code"
                  value={formData.treatment_code}
                  onChange={(e) =>
                    setFormData({ ...formData, treatment_code: e.target.value })
                  }
                  placeholder="Treatment code"
                />
              </div>
              <div>
                <Label htmlFor="add_category_id">Category</Label>
                <Select
                  value={formData.category_id}
                  onValueChange={(value) =>
                    setFormData({ ...formData, category_id: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="add_treatment_type">Type *</Label>
                <Select
                  value={formData.treatment_type}
                  onValueChange={(value: "private" | "nhs") =>
                    setFormData({ ...formData, treatment_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="nhs">NHS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="add_price">Price (£) *</Label>
                <Input
                  id="add_price"
                  type="number"
                  step="0.01"
                  value={formData.price}
                  onChange={(e) => handleNumberChange("price", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="add_duration_minutes">Dentist Time (min)</Label>
                <Input
                  id="add_duration_minutes"
                  type="number"
                  value={formData.duration_minutes}
                  onChange={(e) =>
                    handleNumberChange("duration_minutes", e.target.value)
                  }
                />
              </div>
              <div>
                <Label htmlFor="add_therapist_time_mins">
                  Therapist Time (min)
                </Label>
                <Input
                  id="add_therapist_time_mins"
                  type="number"
                  value={formData.therapist_time_mins}
                  onChange={(e) =>
                    handleNumberChange("therapist_time_mins", e.target.value)
                  }
                />
              </div>
              <div>
                <Label htmlFor="add_lab_bill">Lab Bill (£)</Label>
                <Input
                  id="add_lab_bill"
                  type="number"
                  step="0.01"
                  value={formData.lab_bill}
                  onChange={(e) =>
                    handleNumberChange("lab_bill", e.target.value)
                  }
                />
              </div>
              <div>
                <Label htmlFor="add_material_cost">Material Cost (£)</Label>
                <Input
                  id="add_material_cost"
                  type="number"
                  step="0.01"
                  value={formData.material_cost}
                  onChange={(e) =>
                    handleNumberChange("material_cost", e.target.value)
                  }
                />
              </div>
              <div>
                <Label htmlFor="add_percent_fees">Associate Pay (%)</Label>
                <Input
                  id="add_percent_fees"
                  type="number"
                  step="0.01"
                  value={formData.percent_fees}
                  onChange={(e) =>
                    handleNumberChange("percent_fees", e.target.value)
                  }
                />
              </div>
              <div>
                <Label htmlFor="add_therapist_pay_rate">
                  Therapist Pay (£)
                </Label>
                <Input
                  id="add_therapist_pay_rate"
                  type="number"
                  step="0.01"
                  value={formData.therapist_pay_rate}
                  onChange={(e) =>
                    handleNumberChange("therapist_pay_rate", e.target.value)
                  }
                />
              </div>
              <div>
                <Label htmlFor="add_hourly_rate">
                  OP Cost / Hourly Rate (£)
                </Label>
                <Input
                  id="add_hourly_rate"
                  type="number"
                  step="0.01"
                  value={formData.hourly_rate}
                  onChange={(e) =>
                    handleNumberChange("hourly_rate", e.target.value)
                  }
                />
              </div>
              <div>
                <Label htmlFor="add_finance_fee">Finance Fee (%)</Label>
                <Input
                  id="add_finance_fee"
                  type="number"
                  step="0.01"
                  value={formData.finance_fee}
                  onChange={(e) =>
                    handleNumberChange("finance_fee", e.target.value)
                  }
                />
              </div>
              <div>
                <Label htmlFor="add_average_time_minutes">
                  Completion Time (min)
                </Label>
                <Input
                  id="add_average_time_minutes"
                  type="number"
                  value={formData.average_time_minutes}
                  onChange={(e) =>
                    handleNumberChange("average_time_minutes", e.target.value)
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddOpen(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreating || !formData.treatment_name.trim()}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Treatment"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog
        open={isImportOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsImportOpen(false);
            setImportFile(null);
          }
        }}
      >
        <DialogContent className="max-w-[95vw] w-[1400px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Treatments</DialogTitle>
          </DialogHeader>
          {importFile ? (
            <TreatmentFilePreview
              file={importFile}
              onProcess={handleImportProcess}
              onCancel={handleImportCancel}
            />
          ) : (
            <TreatmentFileUpload onFileSelected={handleFileSelected} />
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
