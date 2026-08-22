import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Check, ChevronsUpDown, Loader2, Tag, X, Plus } from 'lucide-react';
import { useInvoiceTags, useInvoiceTagsForInvoice } from '@/hooks/useInvoiceTags';

interface TagSelectorProps {
  invoiceId: string;
  locationId?: string | null;
  onTagsUpdate?: () => void;
}

export function TagSelector({ invoiceId, locationId, onTagsUpdate }: TagSelectorProps) {
  const [tagsOpen, setTagsOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const isRemovingRef = useRef(false);

  const { tags, isLoading: isLoadingTags, createTag, assignTagsToInvoice } = useInvoiceTags();
  const { assignedTagIds, refetch: refetchInvoiceTags } = useInvoiceTagsForInvoice(invoiceId);

  const handleRemoveTag = async (tagId: string) => {
    const newTagIds = assignedTagIds.filter((id) => id !== tagId);
    await assignTagsToInvoice(invoiceId, newTagIds);
    refetchInvoiceTags();
    onTagsUpdate?.();
  };

  const handleToggleTag = async (tagId: string, isSelected: boolean) => {
    const newTagIds = isSelected
      ? assignedTagIds.filter((id) => id !== tagId)
      : [...assignedTagIds, tagId];
    await assignTagsToInvoice(invoiceId, newTagIds);
    refetchInvoiceTags();
    onTagsUpdate?.();
  };

  const handleCreateTag = () => {
    if (newTagName.trim()) {
      createTag({ name: newTagName.trim(), location_id: locationId || null });
      setNewTagName('');
    }
  };

  const handleOpenChange = (open: boolean) => {
    // Don't open if we're removing a tag
    if (open && isRemovingRef.current) {
      isRemovingRef.current = false;
      return;
    }
    setTagsOpen(open);
  };

  return (
    <div className="space-y-2">
      <Popover open={tagsOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={tagsOpen}
            className="w-full justify-between font-normal h-8 px-2 text-xs"
          >
            {isLoadingTags ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading tags...
              </span>
            ) : assignedTagIds.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {assignedTagIds.map((tagId) => {
                  const tag = tags.find((t) => t.id === tagId);
                  if (!tag) return null;
                  return (
                    <span
                      key={tag.id}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
                    >
                      {tag.name}
                      <span
                        className="inline-flex"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          isRemovingRef.current = true;
                          handleRemoveTag(tagId);
                        }}
                      >
                        <X className="w-2.5 h-2.5 cursor-pointer hover:text-indigo-900" />
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Tag className="w-3 h-3" />
                Select tags
              </span>
            )}
            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[500px] p-0 z-[100]" align="start">
          <div className="p-2 border-b">
            <div className="flex gap-2">
              <Input
                placeholder="Create new tag..."
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTagName.trim()) {
                    e.preventDefault();
                    handleCreateTag();
                  }
                }}
                className="h-8"
              />
              <Button
                size="sm"
                className="h-8"
                disabled={!newTagName.trim()}
                onClick={handleCreateTag}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="max-h-[250px] overflow-auto" onWheel={(e) => e.stopPropagation()}>
            {isLoadingTags ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : tags.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No tags yet. Create one above.
              </div>
            ) : (
              <div className="py-1">
                {tags.map((tag) => {
                  const isSelected = assignedTagIds.includes(tag.id);
                  return (
                    <div
                      key={tag.id}
                      className="px-3 py-2.5 cursor-pointer flex items-center justify-between transition-all duration-150 mx-1 my-0.5 rounded-md hover:bg-indigo-50"
                      onClick={() => handleToggleTag(tag.id, isSelected)}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="w-4 h-4 rounded-full shadow-sm"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="text-sm font-medium">{tag.name}</span>
                      </div>
                      {isSelected && (
                        <Check className="w-4 h-4 text-indigo-600" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
