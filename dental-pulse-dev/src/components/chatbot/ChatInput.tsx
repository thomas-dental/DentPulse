import { useState, useRef, useEffect, useLayoutEffect, type KeyboardEvent, type ChangeEvent, type ClipboardEvent } from 'react';
import { SendHorizonal, AtSign, Paperclip, X, User as UserIcon, Calendar as CalIcon, FileText, Users as UsersIcon, FileType2 } from 'lucide-react';
import { toast } from 'sonner';
import { ChatMentionPicker } from './ChatMentionPicker';

export type MentionPayload = { value: string; type: 'provider' | 'period' | 'alias' | 'page' };

interface ChatInputProps {
  onSend: (message: string, attachments?: AttachedFile[], mentions?: MentionPayload[]) => void;
  disabled?: boolean;
  placeholder?: string;
  organizationId?: string;
  features?: {
    atMentions?: boolean;
  };
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB raw — Anthropic limit is 5MB after base64.
const MAX_DOC_BYTES = 20 * 1024 * 1024; // 20MB for PDF/DOCX
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
const SUPPORTED_PDF_TYPES = ['application/pdf'];
const SUPPORTED_DOC_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
];
const FILE_INPUT_ACCEPT = 'image/*,application/pdf,.pdf,.docx,.doc';

export type AttachmentKind = 'image' | 'pdf' | 'doc';

export interface AttachedFile {
  id: string;
  name: string;
  dataUrl: string;
  kind: AttachmentKind;
  mediaType: string;
}

type MentionType = 'provider' | 'period' | 'alias' | 'page';
interface MentionChip {
  id: string;
  value: string;
  type: MentionType;
}

const MENTION_ICON: Record<MentionType, typeof UserIcon> = {
  provider: UserIcon,
  period: CalIcon,
  page: FileText,
  alias: UsersIcon,
};


function classifyFile(file: File): { kind: AttachmentKind; mediaType: string } | null {
  const t = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  if (SUPPORTED_IMAGE_TYPES.includes(t)) return { kind: 'image', mediaType: t === 'image/jpg' ? 'image/jpeg' : t };
  if (SUPPORTED_PDF_TYPES.includes(t) || name.endsWith('.pdf')) return { kind: 'pdf', mediaType: 'application/pdf' };
  if (SUPPORTED_DOC_TYPES.includes(t) || name.endsWith('.docx') || name.endsWith('.doc')) {
    const mt = name.endsWith('.docx')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : (t || 'application/msword');
    return { kind: 'doc', mediaType: mt };
  }
  return null;
}

export function ChatInput({ onSend, disabled, placeholder, organizationId, features }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [mentions, setMentions] = useState<MentionChip[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-resize textarea up to ~160px, then scroll inside.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const addAttachment = (file: File) => {
    const cls = classifyFile(file);
    if (!cls) {
      toast.error(`Unsupported file type: ${file.type || file.name || 'unknown'}`, {
        description: 'Allowed: PNG, JPG, WebP, GIF, PDF, DOCX, DOC.',
      });
      return;
    }
    const limit = cls.kind === 'image' ? MAX_IMAGE_BYTES : MAX_DOC_BYTES;
    if (file.size > limit) {
      toast.error(`File too large: ${(file.size / (1024 * 1024)).toFixed(1)}MB`, {
        description: cls.kind === 'image' ? 'Max 4MB per image.' : 'Max 20MB per document.',
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      setAttachments(prev => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name || (cls.kind === 'image' ? 'pasted-image.png' : 'document'),
        dataUrl,
        kind: cls.kind,
        mediaType: cls.mediaType,
      }]);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = () => {
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0 && mentions.length === 0) || disabled) return;
    // Prepend chip values as plain text so the message reads naturally in the
    // user bubble. The backend resolves them by string match (period tokens,
    // provider names, page names) — no '@' marker needed.
    const mentionPrefix = mentions.map(m => m.value).join(' ');
    const fullMessage = [mentionPrefix, trimmed].filter(Boolean).join(' ').trim();
    // Also send the picked mentions structurally so the backend can resolve
    // them unambiguously (provider/period filters). The plain-text prefix
    // alone is unrecoverable server-side once a multi-word name is followed
    // by the question text.
    const mentionPayload: MentionPayload[] = mentions.map(m => ({ value: m.value, type: m.type }));
    onSend(
      fullMessage,
      attachments.length > 0 ? attachments : undefined,
      mentionPayload.length > 0 ? mentionPayload : undefined,
    );
    setInput('');
    setAttachments([]);
    setMentions([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    if (!features?.atMentions) return;

    // Identify the active @-fragment up to the cursor: the substring from the
    // most recent '@' to the cursor position. If that span contains whitespace
    // we're no longer composing a mention, so close the picker.
    const cursor = e.target.selectionStart ?? val.length;
    const upto = val.slice(0, cursor);
    const atIdx = upto.lastIndexOf('@');
    if (atIdx === -1) {
      if (mentionOpen) setMentionOpen(false);
      return;
    }
    // Skip the picker when the '@' is part of an email address — i.e. the
    // character right before it is non-whitespace (e.g. "hitesh@gmail.com").
    // Mentions are only valid at the start of the message or after a space.
    const charBefore = atIdx > 0 ? upto[atIdx - 1] : '';
    if (charBefore && !/\s/.test(charBefore)) {
      if (mentionOpen) setMentionOpen(false);
      return;
    }
    const fragment = upto.slice(atIdx + 1);
    if (/\s/.test(fragment)) {
      if (mentionOpen) setMentionOpen(false);
      return;
    }
    // We're inside a mention; keep the picker open and let it filter on the fragment.
    if (!mentionOpen) setMentionOpen(true);
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(it => it.kind === 'file' && it.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) addAttachment(file);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(addAttachment);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleMentionSelect = (value: string, type: MentionType) => {
    // Add a styled chip and strip the @-fragment the user was typing from the
    // textarea (so they don't end up with both a chip and "@frag" in the text).
    setMentions(prev => {
      if (prev.some(m => m.value === value && m.type === type)) return prev;
      return [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, value, type }];
    });
    setInput(prev => {
      const cursor = inputRef.current?.selectionStart ?? prev.length;
      const before = prev.slice(0, cursor);
      const after = prev.slice(cursor);
      const lastAtIndex = before.lastIndexOf('@');
      if (lastAtIndex >= 0) {
        return before.slice(0, lastAtIndex) + after;
      }
      return prev;
    });
    setMentionOpen(false);
    inputRef.current?.focus();
  };

  const removeMention = (id: string) => {
    setMentions(prev => prev.filter(m => m.id !== id));
  };

  // Derive the active @-fragment so the picker can filter as the user types.
  // Empty string when not composing a mention.
  const mentionFragment = (() => {
    if (!mentionOpen) return '';
    const atIdx = input.lastIndexOf('@');
    if (atIdx === -1) return '';
    // Same email-guard as in handleChange: an '@' preceded by a non-space char
    // is part of an email address, not a mention.
    const charBefore = atIdx > 0 ? input[atIdx - 1] : '';
    if (charBefore && !/\s/.test(charBefore)) return '';
    const tail = input.slice(atIdx + 1);
    if (/\s/.test(tail)) return '';
    return tail;
  })();

  return (
    <div className="relative border-t border-border bg-card">
      <span ref={anchorRef} className="absolute bottom-full left-3" />
      <ChatMentionPicker
        open={mentionOpen}
        onClose={() => setMentionOpen(false)}
        onSelect={handleMentionSelect}
        anchorRef={anchorRef}
        organizationId={organizationId}
        features={features}
        searchPrefilter={mentionFragment}
      />

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {attachments.map(att => {
            if (att.kind === 'image') {
              return (
                <div key={att.id} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border bg-muted">
                  <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-background/80 hover:bg-background flex items-center justify-center shadow-sm"
                    title="Remove image"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              );
            }
            const Icon = att.kind === 'pdf' ? FileType2 : FileText;
            const tag = att.kind === 'pdf' ? 'PDF' : 'DOC';
            return (
              <div
                key={att.id}
                className="relative flex items-center gap-2 max-w-[220px] rounded-lg border border-border bg-muted px-2.5 py-1.5"
                title={att.name}
              >
                <Icon className="h-4 w-4 shrink-0 text-primary" />
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium truncate">{att.name}</span>
                  <span className="text-[10px] text-muted-foreground">{tag}</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  className="ml-1 w-4 h-4 rounded-full bg-background/80 hover:bg-background flex items-center justify-center shadow-sm shrink-0"
                  title="Remove file"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-2 p-3">
        {features?.atMentions && (
          <button
            onClick={() => { setInput(prev => prev + '@'); setMentionOpen(true); inputRef.current?.focus(); }}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Mention @provider or @period"
          >
            <AtSign className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          title="Attach image, PDF, or DOC (images can also be pasted)"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={FILE_INPUT_ACCEPT}
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
        <div
          className={`flex-1 relative flex flex-col rounded-xl border border-border bg-background transition-all ${disabled ? 'opacity-50' : 'focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary/50'}`}
          onClick={() => inputRef.current?.focus()}
        >
          {mentions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2 pt-2">
              {mentions.map(m => {
                const Icon = MENTION_ICON[m.type] || AtSign;
                return (
                  <span
                    key={m.id}
                    className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                  >
                    <Icon className="h-3 w-3" />
                    <span>{m.value}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeMention(m.id); }}
                      className="ml-0.5 rounded-sm hover:bg-primary/20"
                      title={`Remove ${m.value}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={disabled}
            placeholder={placeholder || 'Ask about your practice...'}
            className="w-full px-3 py-2 text-sm bg-transparent border-0 focus:outline-none focus:ring-0 disabled:opacity-50 resize-none leading-5 max-h-40 overflow-y-auto"
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={disabled || (!input.trim() && attachments.length === 0 && mentions.length === 0)}
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
