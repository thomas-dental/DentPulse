import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useDraggableFab } from '@/hooks/useDraggableFab';

const FAB_STORAGE_KEY = 'dentpulse-chat-fab-position';

type Message = { role: 'user' | 'assistant'; content: string };

interface AIChatWidgetProps {
  // Controlled mode: receives data from parent (useChatbot hook)
  messages?: Message[];
  isLoading?: boolean;
  error?: string | { message: string } | null;
  onSend?: (message: string) => void;
  onClear?: () => void;
  // Legacy mode: standalone with useAIChat (deprecated, kept for backward compat)
  userRole?: string;
  context?: Record<string, any>;
}

export function AIChatWidget(props: AIChatWidgetProps) {
  // Determine if running in controlled mode (from useChatbot) or legacy mode
  const isControlled = props.onSend !== undefined;

  // In controlled mode, use props directly
  // In legacy mode, fall back to empty defaults (legacy useAIChat removed)
  const messages = props.messages || [];
  const isLoading = props.isLoading || false;
  const error = props.error || null;
  const sendMessage = props.onSend || (() => {});
  const clearMessages = props.onClear || (() => {});

  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { position: fabPosition, onPointerDown, onPointerMove, onPointerUp, wrapClick } = useDraggableFab(FAB_STORAGE_KEY);

  useEffect(() => {
    // Scroll to bottom when messages change
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      sendMessage(input.trim());
      setInput('');
    }
  };

  const suggestedQuestions = [
    "What's our current financial health?",
    "Which locations need attention?",
    "Show me revenue by provider this month.",
    "What are the top risks this week?",
  ];

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={wrapClick(() => setIsOpen(!isOpen))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ left: fabPosition.x, top: fabPosition.y, touchAction: 'none' }}
        className={cn(
          'fixed z-50 flex items-center justify-center w-14 h-14 rounded-full shadow-lg transition-shadow duration-300 cursor-default',
          isOpen
            ? 'bg-muted text-muted-foreground'
            : 'bg-primary text-primary-foreground'
        )}
        aria-label={isOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
      >
        {isOpen ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>

      {/* Chat Panel */}
      <div
        className={cn(
          'fixed bottom-24 right-6 z-50 w-96 bg-background border border-border rounded-xl shadow-2xl transition-all duration-300 overflow-hidden',
          isOpen ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'
        )}
        style={{ maxHeight: 'calc(100vh - 140px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">DentPulse AI</h3>
              <p className="text-xs text-muted-foreground capitalize">{props.userRole || 'AI'} Assistant</p>
            </div>
          </div>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={clearMessages}
              className="h-8 w-8"
              title="Clear conversation"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* Messages */}
        <ScrollArea className="h-80" ref={scrollAreaRef}>
          <div className="p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground text-center">
                  Ask me anything about your financial data
                </p>
                <div className="space-y-2">
                  {suggestedQuestions.map((question, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setInput(question);
                        inputRef.current?.focus();
                      }}
                      className="w-full text-left text-sm px-3 py-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                    msg.role === 'user'
                      ? 'ml-auto bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  )}
                >
                  {msg.content || (
                    <span className="inline-flex items-center gap-1">
                      <span className="animate-pulse">●</span>
                      <span className="animate-pulse delay-100">●</span>
                      <span className="animate-pulse delay-200">●</span>
                    </span>
                  )}
                </div>
              ))
            )}

            {error && (
              <div className="text-center text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                {typeof error === 'string' ? error : error.message}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-3 border-t border-border">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your data..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
