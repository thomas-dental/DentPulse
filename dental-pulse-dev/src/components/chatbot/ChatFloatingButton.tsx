import { MessageCircle } from 'lucide-react';
import { useDraggableFab } from '@/hooks/useDraggableFab';

interface ChatFloatingButtonProps {
  onClick: () => void;
}

const STORAGE_KEY = 'dentpulse-chat-fab-position';

export function ChatFloatingButton({ onClick }: ChatFloatingButtonProps) {
  const { position, onPointerDown, onPointerMove, onPointerUp, wrapClick } = useDraggableFab(STORAGE_KEY);

  return (
    <button
      onClick={wrapClick(onClick)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      data-no-print
      style={{ left: position.x, top: position.y, touchAction: 'none' }}
      className="fixed h-14 w-14 rounded-2xl flex items-center justify-center z-50 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 active:scale-95 transition-shadow duration-200 cursor-default"
    >
      <MessageCircle className="h-7 w-7" />
      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-background" />
    </button>
  );
}
