import { useState, useRef } from 'react';
import { Upload, X, Camera, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

interface ImageUploadProps {
  value?: string;
  onChange: (url: string | null) => void;
  className?: string;
  variant?: 'logo' | 'avatar';
  disabled?: boolean;
}

export function ImageUpload({
  value,
  onChange,
  className,
  variant = 'logo',
  disabled = false,
}: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    if (!file) return;
    setError(null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Invalid file type. Only PNG, JPG, GIF, and WEBP are allowed.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    if (file.size > MAX_SIZE) {
      setError('File is too large. Maximum size is 5MB.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    setIsUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${variant}s/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('uploads')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('uploads')
        .getPublicUrl(filePath);

      onChange(publicUrl);
    } catch (err) {
      console.error('Upload error:', err);
      onChange(localUrl);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  const handleRemove = () => {
    if (preview) {
      URL.revokeObjectURL(preview);
      setPreview(null);
    }
    setError(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const displayUrl = preview || value;
  const isAvatar = variant === 'avatar';
  const isLogo = variant === 'logo';

  // ── Avatar variant ─────────────────────────────────────────────────────────
  if (isAvatar) {
    return (
      <div className={cn('relative', className)}>
        <input
          ref={inputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.gif,.webp"
          onChange={handleChange}
          className="hidden"
          disabled={disabled || isUploading}
        />
        {displayUrl ? (
          <div className="relative group w-20 h-20 rounded-full">
            <img
              src={displayUrl}
              alt="Uploaded"
              className="w-full h-full object-cover rounded-full"
            />
            {!disabled && (
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 rounded-full">
                <Button type="button" variant="secondary" size="icon" className="h-8 w-8"
                  onClick={() => inputRef.current?.click()}>
                  <Camera className="w-4 h-4" />
                </Button>
                <Button type="button" variant="destructive" size="icon" className="h-8 w-8"
                  onClick={handleRemove}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || isUploading}
            className="w-20 h-20 rounded-full border-2 border-dashed border-border/50 flex items-center justify-center hover:border-primary/50 hover:bg-muted/30 transition-all"
          >
            {isUploading
              ? <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
              : <Upload className="w-5 h-5 text-muted-foreground" />}
          </button>
        )}
        {error && <p className="text-xs text-destructive mt-2 text-center">{error}</p>}
      </div>
    );
  }

  // ── Logo variant ────────────────────────────────────────────────────────────
  return (
    <div className={cn('w-full', className)}>
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.gif,.webp"
        onChange={handleChange}
        className="hidden"
        disabled={disabled || isUploading}
      />

      <div
        onClick={() => !displayUrl && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={cn(
          'w-full h-32 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all',
          dragActive ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-primary/50 hover:bg-muted/30',
          displayUrl ? 'cursor-default' : 'cursor-pointer',
          disabled ? 'opacity-50 pointer-events-none' : '',
        )}
      >
        {isUploading ? (
          <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
        ) : displayUrl ? (
          <div className="relative w-full h-full flex items-center justify-center group">
            <img src={displayUrl} alt="Organization logo" className="h-20 object-contain p-2"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            {!disabled && (
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center gap-2">
                <Button type="button" variant="secondary" size="sm" className="h-8 text-xs gap-1.5"
                  onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
                  <Camera className="w-3.5 h-3.5" /> Change
                </Button>
                <Button type="button" variant="destructive" size="sm" className="h-8 text-xs gap-1.5"
                  onClick={(e) => { e.stopPropagation(); handleRemove(); }}>
                  <X className="w-3.5 h-3.5" /> Remove
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <Upload className="w-8 h-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Click to upload or drag & drop</p>
            <p className="text-xs text-muted-foreground/60">PNG, JPG up to 5MB</p>
          </>
        )}
      </div>

      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
    </div>
  );
}
