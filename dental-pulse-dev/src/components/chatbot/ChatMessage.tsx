import { Bot, User, Copy, Check, FileText, FileType2 } from 'lucide-react';
import { useState } from 'react';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatInlineChart } from './ChatInlineChart';
import { ToolSteps } from './dashboard/ToolSteps';
import { UsageLine } from './dashboard/UsageLine';
import type { ChatMessage as ChatMessageType } from '@/hooks/useChatbot';

interface ChatMessageProps {
  message: ChatMessageType;
}

function formatTime(ts?: string) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const time = formatTime(message.timestamp);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center shadow-sm ${
        isUser
          ? 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground'
          : 'bg-gradient-to-br from-violet-100 to-purple-50 dark:from-violet-900/40 dark:to-purple-900/20'
      }`}>
        {isUser
          ? <User className="h-3.5 w-3.5" />
          : <Bot className="h-3.5 w-3.5 text-primary" />
        }
      </div>

      {/* Message bubble */}
      <div className={`group relative min-w-0 ${isUser ? 'max-w-[80%]' : 'max-w-[92%]'}`}>
        <div className={`rounded-2xl px-3.5 py-2.5 ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-muted/70 border border-border/40 rounded-tl-sm'
        }`}>
          {isUser ? (
            <>
              {message.attachments && message.attachments.length > 0 && (
                <div className={`flex flex-wrap gap-1.5 ${message.content ? 'mb-2' : ''}`}>
                  {message.attachments.map((att, i) => {
                    if (att.kind === 'image') {
                      return (
                        <a
                          key={i}
                          href={att.dataUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-20 h-20 rounded-md overflow-hidden border border-primary-foreground/20"
                        >
                          <img src={att.dataUrl} alt={att.name || `attachment ${i + 1}`} className="w-full h-full object-cover" />
                        </a>
                      );
                    }
                    const Icon = att.kind === 'pdf' ? FileType2 : FileText;
                    const tag = att.kind === 'pdf' ? 'PDF' : 'DOC';
                    return (
                      <a
                        key={i}
                        href={att.dataUrl}
                        download={att.name}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 max-w-[220px] rounded-md border border-primary-foreground/20 bg-primary-foreground/10 px-2.5 py-1.5"
                        title={att.name}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <div className="flex flex-col min-w-0 text-left">
                          <span className="text-xs font-medium truncate">{att.name}</span>
                          <span className="text-[10px] opacity-80">{tag}</span>
                        </div>
                      </a>
                    );
                  })}
                </div>
              )}
              {message.content && <p className="text-sm whitespace-pre-wrap">{message.content}</p>}
            </>
          ) : (
            <>
              <ChatMarkdown content={message.content} />
              {message.dashboard && (
                <>
                  <ToolSteps steps={message.dashboard.steps} />
                  <UsageLine usage={message.dashboard.usage} />
                </>
              )}
              {message.chart && !message.dashboard && (
                <ChatInlineChart chart={message.chart} />
              )}
            </>
          )}
        </div>

        {/* Copy button — inside bubble, top-right */}
        {!isUser && message.content && (
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-background/50"
            title="Copy"
          >
            {copied
              ? <Check className="h-3 w-3 text-green-500" />
              : <Copy className="h-3 w-3 text-muted-foreground" />
            }
          </button>
        )}

        {/* Timestamp */}
        {time && (
          <p className={`text-[10px] text-muted-foreground mt-1 ${isUser ? 'text-left' : 'text-right'}`}>{time}</p>
        )}
      </div>
    </div>
  );
}
