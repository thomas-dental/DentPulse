import { useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface TreatmentFileUploadProps {
  practiceId?: string | null;
  locationId?: string | null;
  categoryId?: string | null;
  regionId?: string | null;
  onUploadComplete?: (uploadId: string) => void;
  onProcessComplete?: () => void;
  onFileSelected?: (file: File) => void; // Callback when file is selected
}

export function TreatmentFileUpload({ 
  onFileSelected
}: TreatmentFileUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    // Validate file type
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    if (!fileExtension || !['csv', 'xlsx', 'xls'].includes(fileExtension)) {
      toast.error('Invalid file type. Only CSV, XLSX, and XLS files are allowed.');
      return;
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      toast.error('File size exceeds 10MB limit.');
      return;
    }

    // If onFileSelected callback is provided, use it (for separate preview modal)
    if (onFileSelected) {
      onFileSelected(file);
      return;
    }

    // Otherwise, keep the old behavior (show preview inline)
    // This is kept for backward compatibility
  };


  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };


  return (
    <div className="h-full flex flex-col">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer',
          dragActive
            ? 'border-primary bg-primary/5'
            : 'border-border/50 hover:border-primary/50 hover:bg-muted/30'
        )}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">
          Upload CSV or Excel File
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Drag and drop your file here, or click to browse
        </p>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">CSV</Badge>
          <Badge variant="outline">XLSX</Badge>
          <Badge variant="outline">XLS</Badge>
          <span className="ml-2">Max 10MB</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleChange}
          className="hidden"
        />
      </div>
    </div>
  );
}
