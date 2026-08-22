import { X, Bot, History, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ChatHeaderProps {
  activeVersion: 'v1' | 'v2';
  onClear: () => void;
  onClose: () => void;
  onShowHistory?: () => void;
}

export function ChatHeader({ activeVersion, onClear, onClose, onShowHistory }: ChatHeaderProps) {

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-card to-muted/30">
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-sm">
            <Bot className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${activeVersion === 'v2' ? 'bg-green-500' : 'bg-amber-500'}`} />
        </div>
        <span className="font-semibold text-sm">DentPulse AI</span>
      </div>
      <div className="flex items-center gap-0.5">
        {onShowHistory && (
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-white hover:bg-primary" onClick={onShowHistory} title="Chat history">
            <History className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-white hover:bg-primary" onClick={onClear} title="New chat">
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-white hover:bg-primary" onClick={onClose} title="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
