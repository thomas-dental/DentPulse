import { ChatMarkdown } from '../../ChatMarkdown';
import type { DashboardWidget } from '@/hooks/useChatbot';

export function TextSummaryWidget({ widget }: { widget: DashboardWidget }) {
  return (
    <div className="text-sm">
      <ChatMarkdown content={widget.data?.markdown || ''} />
    </div>
  );
}
