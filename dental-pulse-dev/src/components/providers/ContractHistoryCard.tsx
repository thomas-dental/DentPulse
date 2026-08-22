import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { List, Trash2 } from "lucide-react";
import { useProviderContracts, ProviderContract } from "@/hooks/useProviderContracts";

interface ContractHistoryCardProps {
  providerId: string | undefined;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const SPLIT_METHOD_LABEL: Record<string, string> = {
  "flat-percentage": "Flat Percentage",
  "sliding-scale": "Sliding Scale",
  "per-case": "Per Case",
  "per-hour": "Per Hour",
};

function splitDetails(contract: ProviderContract): string {
  switch (contract.split_source_method) {
    case "sliding-scale":
      return `Lab ${contract.lab_split_percentage_sliding ?? 0}%`;
    case "per-case":
      return `£${contract.associate_split_per_case_rate ?? 0} per case`;
    case "per-hour":
      return `£${contract.associate_split_per_hour_rate ?? 0}/hr${
        contract.employment_type ? ` (${contract.employment_type})` : ""
      }`;
    default:
      return `Associate ${contract.associate_split_percentage ?? 0}% / Lab ${contract.lab_split_percentage ?? 0}%`;
  }
}

export function ContractHistoryCard({ providerId }: ContractHistoryCardProps) {
  const { contracts, isLoading, error, deleteContract, isDeletingContract } =
    useProviderContracts(providerId);
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const [contractPendingDelete, setContractPendingDelete] =
    useState<ProviderContract | null>(null);

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4 rounded-md border border-border p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                Contract History
              </h3>
              <p className="text-sm text-muted-foreground">
                Every contract period logged for this provider, oldest to
                newest change.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 shrink-0"
              onClick={() => setViewAllOpen(true)}
              disabled={!providerId}
            >
              <List className="w-3.5 h-3.5" />
              View All Contracts ({contracts.length})
            </Button>
          </div>

          {isLoading ? (
            <div className="text-sm text-muted-foreground py-2">
              Loading contract history...
            </div>
          ) : error ? (
            <div className="text-center py-2 text-sm text-destructive">
              Couldn't load contract history: {(error as Error).message}
            </div>
          ) : contracts.length === 0 ? (
            <div className="text-center py-2 text-sm text-muted-foreground">
              No contract history logged yet. Use "Add New Contract" above
              and save to start tracking contract periods.
            </div>
          ) : null}
        </div>
      </CardContent>

      <Dialog open={viewAllOpen} onOpenChange={setViewAllOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>All Contracts</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Split Method</TableHead>
                  <TableHead>Split Details</TableHead>
                  <TableHead>Material Split %</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell>{formatDate(contract.contract_start_date)}</TableCell>
                    <TableCell>{formatDate(contract.contract_end_date)}</TableCell>
                    <TableCell>
                      {SPLIT_METHOD_LABEL[contract.split_source_method] ?? contract.split_source_method}
                    </TableCell>
                    <TableCell>{splitDetails(contract)}</TableCell>
                    <TableCell>
                      {contract.material_split_percentage != null
                        ? `${contract.material_split_percentage}%`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={() => setContractPendingDelete(contract)}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!contractPendingDelete}
        onOpenChange={(open) => {
          if (!open) setContractPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this contract?</AlertDialogTitle>
            <AlertDialogDescription>
              {contractPendingDelete && (
                <>
                  This will remove the contract period from{" "}
                  {formatDate(contractPendingDelete.contract_start_date)} to{" "}
                  {formatDate(contractPendingDelete.contract_end_date)} from
                  Contract History.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeletingContract}
              onClick={() => {
                if (contractPendingDelete && providerId) {
                  deleteContract({
                    id: contractPendingDelete.id,
                    providerId,
                  });
                }
                setContractPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
