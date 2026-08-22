import { useMemo } from 'react';
import DOMPurify from 'dompurify';

interface ChatMarkdownProps {
  content: string;
}

function parseMarkdownTables(text: string): string {
  const lines = text.split('\n');
  let result = '';
  let inTable = false;
  let tableHtml = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const isTableRow = line.startsWith('|') && line.endsWith('|');
    const isSeparator = /^\|[\s\-:|]+\|$/.test(line);

    if (isTableRow && !isSeparator) {
      if (!inTable) {
        inTable = true;
        tableHtml = '<div class="overflow-x-auto my-2"><table class="min-w-full text-xs border-collapse">';
      }
      const cells = line.split('|').filter(c => c.trim() !== '');
      const tag = tableHtml.includes('<tbody>') ? 'td' : 'th';

      if (tag === 'th') {
        tableHtml += '<thead><tr>';
        cells.forEach(c => { tableHtml += `<th class="px-2 py-1 text-left font-semibold border-b border-border">${c.trim()}</th>`; });
        tableHtml += '</tr></thead><tbody>';
      } else {
        tableHtml += '<tr>';
        cells.forEach(c => { tableHtml += `<td class="px-2 py-1 border-b border-border/50">${c.trim()}</td>`; });
        tableHtml += '</tr>';
      }
    } else if (isSeparator) {
      // Skip separator rows
      continue;
    } else {
      if (inTable) {
        tableHtml += '</tbody></table></div>';
        result += tableHtml;
        tableHtml = '';
        inTable = false;
      }
      result += line + '\n';
    }
  }

  if (inTable) {
    tableHtml += '</tbody></table></div>';
    result += tableHtml;
  }

  return result;
}

export function ChatMarkdown({ content }: ChatMarkdownProps) {
  const html = useMemo(() => {
    let result = content;

    // Headers
    result = result.replace(/^### (.+)$/gm, '<h3 class="text-sm font-bold mt-3 mb-1">$1</h3>');
    result = result.replace(/^## (.+)$/gm, '<h2 class="text-base font-bold mt-3 mb-1">$1</h2>');

    // Bold
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Inline code
    result = result.replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs">$1</code>');

    // Links
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-primary underline">$1</a>');

    // Tables
    result = parseMarkdownTables(result);

    // Line breaks (but not inside table blocks)
    result = result.replace(/\n/g, '<br/>');

    // Clean up double breaks
    result = result.replace(/(<br\/>){3,}/g, '<br/><br/>');

    return DOMPurify.sanitize(result);
  }, [content]);

  return (
    <div
      className="text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
