/**
 * Message Renderer component — renders AI conversation messages
 * with support for user/assistant/tool messages, thinking blocks,
 * tool calls, and streaming indicators.
 *
 * Pure function that returns a VNode tree.
 */

import type { VNode } from '../ink/virtual-tree.js';
import { Box } from './box.js';
import { Text } from './text.js';
import type { Message, ToolCall } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface MessageRendererOptions {
  readonly expanded?: boolean;
  readonly isStreaming?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLE_COLOR: Record<string, string> = { user: 'ansi:blue', assistant: 'ansi:cyan', tool: 'ansi:yellow' };
const ROLE_LABEL: Record<string, string> = { user: 'You', assistant: 'Claude', tool: 'Tool' };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Render a single conversation message. Handles text content,
 *  ToolCall[] arrays, reasoning_content thinking blocks, streaming
 *  cursor, and tool result status. */
export function renderMessage(
  msg: Message,
  opts: MessageRendererOptions = {},
): VNode {
  const children: VNode[] = [];
  children.push(renderRoleHeader(msg.role));

  if (typeof msg.content === 'string') {
    children.push(renderTextContent(msg.role, msg.content));
  } else if (Array.isArray(msg.content)) {
    for (const tc of msg.content) children.push(renderToolCall(tc));
  }

  if (msg.reasoning_content) {
    children.push(renderThinkingBlock(msg.reasoning_content, opts.expanded ?? false));
  }
  if (opts.isStreaming) {
    children.push(Text({ content: '█', color: 'ansi:cyan', bold: true }));
  }
  if (msg.role === 'tool' && msg.tool_id) {
    children.push(renderToolStatus(msg));
  }

  return Box({ flexDirection: 'column', padding: 0 }, ...children);
}

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

function renderRoleHeader(role: string): VNode {
  return Text({
    content: `${ROLE_LABEL[role] ?? role}:`,
    bold: true,
    color: ROLE_COLOR[role] ?? 'ansi:white',
  });
}

function renderTextContent(role: string, content: string): VNode {
  const children: VNode[] = [];
  for (const line of content.split('\n')) {
    children.push(Text({ content: line, wrap: 'wrap', dim: role === 'tool' }));
  }
  return Box({ flexDirection: 'column', padding: 0 }, ...children);
}

function renderToolCall(tc: ToolCall): VNode {
  return Box(
    { flexDirection: 'row', padding: 0 },
    Text({ content: `  ${tc.name}`, color: 'ansi:magenta', bold: true }),
    Text({ content: ` ${truncateArgs(tc.arguments, 60)}`, dim: true }),
  );
}

function renderToolStatus(msg: Message): VNode {
  const isErr = msg.critical;
  return Text({ content: isErr ? '  [error]' : '  [ok]', color: isErr ? 'ansi:red' : 'ansi:green', dim: true });
}

function renderThinkingBlock(reasoning: string, expanded: boolean): VNode {
  const marker = expanded ? '▼' : '▶';
  const children: VNode[] = [
    Text({ content: `${marker} Thinking...`, dim: true, italic: true }),
  ];
  if (expanded) {
    for (const line of reasoning.split('\n')) {
      children.push(Text({ content: `  ${line}`, dim: true, wrap: 'wrap' }));
    }
  }
  return Box({ flexDirection: 'column', padding: 0 }, ...children);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateArgs(args: Record<string, unknown>, maxLen: number): string {
  const json = JSON.stringify(args);
  if (json.length <= maxLen) return json;
  return json.slice(0, maxLen - 3) + '...';
}
