import { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Image, X, Eye, EyeOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface InvoiceFileUploadProps {
  onFileSelected?: (files: File[]) => void;
  onPreviewUrlChange?: (url: string | null) => void;
  multiple?: boolean;
  isUploading?: boolean;
  disabled?: boolean;
  hideInternalPreview?: boolean;
}

export function InvoiceFileUpload({
  onFileSelected,
  onPreviewUrlChange,
  multiple = false,
  isUploading = false,
  disabled = false,
  hideInternalPreview = false,
}: InvoiceFileUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Store callback in ref to avoid effect re-runs when callback changes
  const onPreviewUrlChangeRef = useRef(onPreviewUrlChange);
  useEffect(() => {
    onPreviewUrlChangeRef.current = onPreviewUrlChange;
  }, [onPreviewUrlChange]);

  // Create/cleanup PDF preview URL when file changes
  useEffect(() => {
    if (selectedFiles.length > 0) {
      const file = selectedFiles[0];
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        const url = URL.createObjectURL(file);
        setPdfPreviewUrl(url);
        onPreviewUrlChangeRef.current?.(url);
        return () => {
          URL.revokeObjectURL(url);
          onPreviewUrlChangeRef.current?.(null);
        };
      }
    }
    setPdfPreviewUrl(null);
    onPreviewUrlChangeRef.current?.(null);
  }, [selectedFiles]);

  // Disable upload area when file is selected, uploading, or explicitly disabled
  const isDisabled = disabled || isUploading || selectedFiles.length > 0;

  const validateFile = (file: File): boolean => {
    // Validate file type - PDF and image files
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    const allowedExtensions = ['pdf'];
    
    if (!fileExtension || !allowedExtensions.includes(fileExtension)) {
      toast.error(`Invalid file type. Only PDF files are allowed.`);
      return false;
    }

    // Validate file size (max 4MB)
    const maxSize = 4 * 1024 * 1024; // 4MB
    if (file.size > maxSize) {
      toast.error(`Uploaded file is too large. Maximum file size is 4MB.`);
      return false;
    }

    return true;
  };

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const validFiles: File[] = [];
    
    Array.from(files).forEach((file) => {
      if (validateFile(file)) {
        validFiles.push(file);
      }
    });

    if (validFiles.length === 0) return;

    if (multiple) {
      setSelectedFiles((prev) => {
        const newFiles = [...prev, ...validFiles];
        if (onFileSelected) {
          onFileSelected(newFiles);
        }
        if (validFiles.length > 0) {
          toast.success(`${validFiles.length} file${validFiles.length > 1 ? 's' : ''} added successfully`);
        }
        return newFiles;
      });
    } else {
      setSelectedFiles([validFiles[0]]);
      if (onFileSelected) {
        onFileSelected([validFiles[0]]);
      }
      toast.success('File added successfully');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files);
    // Reset input so same file can be selected again
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    const newFiles = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(newFiles);
    if (onFileSelected) {
      onFileSelected(newFiles);
    }
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') {
      return <FileText className="w-5 h-5 text-red-500" />;
    }
    return <Image className="w-5 h-5 text-blue-500" />;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!isDisabled) {
            setDragActive(true);
          }
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (!isDisabled) {
            handleFileSelect(e.dataTransfer.files);
          }
        }}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center transition-all',
          isDisabled
            ? 'border-border/30 bg-muted/20 cursor-not-allowed opacity-60'
            : dragActive
              ? 'border-primary bg-primary/5 cursor-pointer'
              : 'border-border/50 hover:border-primary/50 hover:bg-muted/30 cursor-pointer'
        )}
        onClick={() => {
          if (!isDisabled) {
            inputRef.current?.click();
          }
        }}
      >
        <Upload className={cn(
          "w-12 h-12 mx-auto mb-4",
          isDisabled ? "text-muted-foreground/50" : "text-muted-foreground"
        )} />
        <h3 className={cn(
          "text-lg font-medium mb-2",
          isDisabled ? "text-muted-foreground" : "text-foreground"
        )}>
          Upload Supplier Invoice
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          {isDisabled
            ? 'File selected. Click "Upload Files" to process.'
            : 'Drag and drop PDF file here, or click to browse'}
        </p>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground flex-wrap">
          <Badge variant="outline">PDF</Badge>
          <span className="ml-2">Max 4MB per file</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          onChange={handleChange}
          multiple={false}
          disabled={isDisabled}
          className="hidden"
        />
      </div>

      {/* Selected Files List */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              Selected Files ({selectedFiles.length})
            </p>
            {!hideInternalPreview && pdfPreviewUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
                className="gap-2"
              >
                {showPreview ? (
                  <>
                    <EyeOff className="w-4 h-4" />
                    Hide Preview
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4" />
                    Show Preview
                  </>
                )}
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {selectedFiles.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {getFileIcon(file.name)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                </div>
                {!isUploading && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(index);
                    }}
                    className="ml-2 text-muted-foreground hover:text-destructive transition-colors p-1 rounded hover:bg-destructive/10"
                    type="button"
                    title="Remove file"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PDF Preview - only show if not hidden externally */}
      {!hideInternalPreview && pdfPreviewUrl && showPreview && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-muted/30 px-3 py-2 border-b">
            <p className="text-sm font-medium text-foreground">PDF Preview</p>
          </div>
          <iframe
            src={`${pdfPreviewUrl}#toolbar=1&navpanes=0`}
            className="w-full bg-gray-100"
            style={{ height: '400px' }}
            title="PDF Preview"
          />
        </div>
      )}
    </div>
  );
}
