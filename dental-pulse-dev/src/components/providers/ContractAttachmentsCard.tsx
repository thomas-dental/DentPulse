import { useCallback, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, Upload, Download, Trash2, Loader2, List } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useProviderContractAttachments,
  isAllowedContractAttachment,
  ProviderContractAttachment,
} from "@/hooks/useProviderContractAttachments";

interface ContractAttachmentsCardProps {
  providerId: string | undefined;
}

const ACCEPT = ".pdf,.doc,.docx";
const RECENT_COUNT = 3;

function formatFileSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function ContractAttachmentsCard({
  providerId,
}: ContractAttachmentsCardProps) {
  const {
    attachments,
    isLoading,
    uploadAttachment,
    isUploading,
    deleteAttachment,
    isDeleting,
    downloadAttachment,
  } = useProviderContractAttachments(providerId);

  const [dragActive, setDragActive] = useState(false);
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(
    (file: File) => {
      if (!isAllowedContractAttachment(file)) {
        return;
      }
      uploadAttachment(file);
    },
    [uploadAttachment],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    },
    [handleFileUpload],
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const renderAttachmentRow = (attachment: ProviderContractAttachment) => (
    <div
      key={attachment.id}
      className="flex items-center gap-3 p-2.5 rounded-md bg-muted/50 hover:bg-muted transition-colors"
    >
      <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {attachment.file_name}
        </div>
        <div className="text-xs text-muted-foreground">
          {formatFileSize(attachment.file_size)} &middot;{" "}
          {formatDate(attachment.created_at)}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => downloadAttachment(attachment)}
          title="Download"
        >
          <Download className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={() => deleteAttachment(attachment)}
          disabled={isDeleting}
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4 rounded-md border border-border p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                Contract Attachments
              </h3>
              <p className="text-sm text-muted-foreground">
                Upload contract documents for this provider. PDF and Word
                (.doc, .docx) files are supported.
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
              View All ({attachments.length})
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            onChange={handleFileInputChange}
            className="hidden"
            disabled={!providerId || isUploading}
          />

          <div
            onClick={() => providerId && fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              if (providerId) setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={providerId ? handleDrop : undefined}
            className={cn(
              "rounded-md border-2 border-dashed p-6 text-center transition-colors",
              !providerId
                ? "opacity-50 cursor-not-allowed"
                : "cursor-pointer",
              dragActive
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/30",
              isUploading && "pointer-events-none opacity-60",
            )}
          >
            {isUploading ? (
              <Loader2 className="w-6 h-6 mx-auto text-muted-foreground mb-2 animate-spin" />
            ) : (
              <Upload className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
            )}
            <div className="text-sm text-muted-foreground">
              {isUploading
                ? "Uploading..."
                : "Click to upload or drag & drop"}
            </div>
            <div className="text-xs text-muted-foreground/60 mt-1">
              PDF, DOC or DOCX up to 10MB
            </div>
          </div>

          {isLoading ? (
            <div className="text-sm text-muted-foreground py-2">
              Loading attachments...
            </div>
          ) : attachments.length > 0 ? (
            <div className="space-y-1.5">
              {attachments.slice(0, RECENT_COUNT).map(renderAttachmentRow)}
              {attachments.length > RECENT_COUNT && (
                <button
                  type="button"
                  onClick={() => setViewAllOpen(true)}
                  className="text-xs text-primary hover:underline pl-1"
                >
                  +{attachments.length - RECENT_COUNT} more — view all
                </button>
              )}
            </div>
          ) : (
            <div className="text-center py-2 text-sm text-muted-foreground">
              No contract attachments uploaded yet
            </div>
          )}
        </div>
      </CardContent>

      <Dialog open={viewAllOpen} onOpenChange={setViewAllOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>All Contract Attachments</DialogTitle>
          </DialogHeader>
          {attachments.length > 0 ? (
            <div className="max-h-[60vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File Name</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Uploaded On</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attachments.map((attachment) => (
                    <TableRow key={attachment.id}>
                      <TableCell className="max-w-[280px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">
                            {attachment.file_name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{formatFileSize(attachment.file_size)}</TableCell>
                      <TableCell>{formatDate(attachment.created_at)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => downloadAttachment(attachment)}
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => deleteAttachment(attachment)}
                          disabled={isDeleting}
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
          ) : (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No contract attachments uploaded yet
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
