import { Sparkles } from 'lucide-react';

interface ChatSuggestionsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  disabled?: boolean;
}

export function ChatSuggestions({ suggestions, onSelect, disabled }: ChatSuggestionsProps) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pl-10 pr-3 pt-1.5 pb-1">
      {suggestions.map((suggestion, i) => (
        <button
          key={i}
          onClick={() => onSelect(suggestion)}
          disabled={disabled}
          className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary hover:bg-primary hover:text-white hover:border-primary transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Sparkles className="h-2.5 w-2.5" />
          {suggestion}
        </button>
      ))}
    </div>
  );
}
