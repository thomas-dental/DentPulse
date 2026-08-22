import ContentLoader from 'react-content-loader';

export function ChatMessageSkeleton() {
  return (
    <div className="flex gap-2">
      <div className="w-7 h-7 rounded-full bg-muted animate-pulse shrink-0" />
      <div className="flex-1 space-y-2">
        <ContentLoader
          speed={1.5}
          width="100%"
          height={72}
          backgroundColor="hsl(var(--muted))"
          foregroundColor="hsl(var(--muted) / 0.5)"
          style={{ width: '85%' }}
        >
          <rect x="0" y="0" rx="8" ry="8" width="100%" height="16" />
          <rect x="0" y="24" rx="8" ry="8" width="75%" height="16" />
          <rect x="0" y="48" rx="8" ry="8" width="50%" height="16" />
        </ContentLoader>
      </div>
    </div>
  );
}

export function ChatBriefingSkeleton() {
  return (
    <div className="mx-3 mb-3 rounded-xl p-4 bg-gradient-to-br from-primary/20 to-primary/10 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-4 h-4 rounded bg-primary/30" />
        <div className="h-4 w-28 rounded bg-primary/30" />
      </div>
      <div className="h-3 w-20 rounded bg-primary/20 mb-3" />
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white/10 rounded-lg p-3 space-y-2">
            <div className="h-2 w-12 rounded bg-white/20 mx-auto" />
            <div className="h-4 w-16 rounded bg-white/20 mx-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChatSessionSkeleton() {
  return (
    <div className="p-2 space-y-2">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-3 animate-pulse">
          <div className="w-4 h-4 rounded bg-muted shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 rounded bg-muted" style={{ width: `${60 + Math.random() * 30}%` }} />
            <div className="h-2.5 w-20 rounded bg-muted/60" />
          </div>
        </div>
      ))}
    </div>
  );
}
