const fs = require('fs');
const path = 'C:/Users/Admin/.claude/projects/C--xampp-htdocs-dentpulse-superadmin/4cb45871-f8cb-4d3a-b0ab-0027b3fa203d.jsonl';
const data = fs.readFileSync(path, 'utf8').split('\n');
for (let i = 0; i < data.length; i++) {
  if (!data[i].trim()) continue;
  try {
    const obj = JSON.parse(data[i]);
    let t = obj.type || '?';
    let lineLen = data[i].length;
    // Check for tool_use and tool_result blocks
    let hasToolUse = false;
    let hasToolResult = false;
    let textContent = '';
    if (obj.message && obj.message.content) {
      if (Array.isArray(obj.message.content)) {
        for (const block of obj.message.content) {
          if (block.type === 'tool_use') hasToolUse = true;
          if (block.type === 'tool_result') hasToolResult = true;
          if (block.type === 'text' && block.text) textContent += block.text;
        }
      } else if (typeof obj.message.content === 'string') {
        textContent = obj.message.content;
      }
    }
    if (lineLen > 500) {
      console.log(`Line ${i}: type=${t} lineLen=${lineLen} textLen=${textContent.length} toolUse=${hasToolUse} toolResult=${hasToolResult}`);
    }
  } catch(e) {}
}
