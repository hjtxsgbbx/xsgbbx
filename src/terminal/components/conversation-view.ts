/**
 * Conversation View component — full conversation display with
 * virtual scrolling, auto-scroll-to-bottom, and message grouping.
 *
 * Pure function that returns a VNode tree.
 */

import type { VNode } from '../ink/virtual-tree.js';
import type { Size } from '../ink/layout/geometry.js';
import { Box } from './box.js';
import { Text } from './text.js';
import { renderMessage } from './message-renderer.js';
import type { Message } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationViewOptions {
  readonly viewport: Size;
  readonly scrollOffset?: number;
  readonly autoScroll?: boolean;
}

interface MessageGroup {
  readonly type: 'single' | 'tool-block';
  readonly messages: readonly Message[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderConversation(
  messages: readonly Message[],
  options: ConversationViewOptions,
): VNode {
  const { viewport, scrollOffset = 0 } = options;
  const groups = groupMessages(messages);
  const { offsets, totalRows } = computeOffsets(groups);
  const viewRows = Math.max(1, viewport.height);
  const effectiveOffset = Math.min(scrollOffset, Math.max(0, totalRows - viewRows));

  const startGroup = findStartGroup(groups, offsets, totalRows, effectiveOffset);
  const children: VNode[] = [];

  // Top overflow indicator
  if (effectiveOffset > 0) {
    children.push(Text({ content: `  ... ${effectiveOffset} lines above ...`, dim: true }));
  }

  // Render visible groups
  let renderedRows = 0;
  for (let g = startGroup; g < groups.length && renderedRows < viewRows; g++) {
    const group = groups[g]!;
    const msgRows = offsets[g + 1]! - (offsets[g] ?? 0);
    children.push(
      group.type === 'tool-block'
        ? renderToolBlock(group.messages)
        : renderMessage(group.messages[0]!),
    );
    renderedRows += msgRows;
  }

  const remaining = totalRows - effectiveOffset - renderedRows;
  if (remaining > 0) {
    children.push(Text({ content: `  ... ${remaining} lines below ...`, dim: true }));
  }
  if (messages.length === 0) {
    children.push(Text({ content: '  No messages yet. Start a conversation!', dim: true }));
  }

  return Box({ flexDirection: 'column', padding: 0 }, ...children);
}

// ---------------------------------------------------------------------------
// Message grouping + virtual-scroll
// ---------------------------------------------------------------------------

function groupMessages(messages: readonly Message[]): readonly MessageGroup[] {
  const groups: MessageGroup[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i]!;
    if (msg.role === 'assistant' && Array.isArray(msg.content) && msg.content.length > 0) {
      const block: Message[] = [msg];
      for (i++; i < messages.length && messages[i]!.role === 'tool'; i++) {
        block.push(messages[i]!);
      }
      groups.push({ type: 'tool-block', messages: block });
    } else {
      groups.push({ type: 'single', messages: [msg] });
      i++;
    }
  }
  return groups;
}

function computeOffsets(groups: readonly MessageGroup[]) {
  const offsets: number[] = [0];
  let totalRows = 0;
  for (const g of groups) {
    const rows = g.messages.reduce(
      (s, m) => s + estimateRows(m), 0,
    );
    totalRows += rows;
    offsets.push(totalRows);
  }
  return { offsets, totalRows };
}

function findStartGroup(
  groups: readonly MessageGroup[],
  offsets: number[],
  totalRows: number,
  effectiveOffset: number,
): number {
  for (let g = 0; g < groups.length; g++) {
    if ((offsets[g + 1] ?? totalRows) > effectiveOffset) return g;
  }
  return 0;
}

function estimateRows(msg: Message): number {
  let rows = 1;
  if (typeof msg.content === 'string') rows += msg.content.split('\n').length;
  else if (Array.isArray(msg.content)) rows += msg.content.length;
  if (msg.reasoning_content) rows += msg.reasoning_content.split('\n').length;
  return rows;
}

// ---------------------------------------------------------------------------
// Tool block rendering
// ---------------------------------------------------------------------------

function renderToolBlock(messages: readonly Message[]): VNode {
  const children: VNode[] = [
    Text({ content: '── Tool Calls ──', dim: true, bold: true }),
  ];
  for (const msg of messages) children.push(renderMessage(msg));
  children.push(Text({ content: '── End Tools ──', dim: true }));
  return Box({ flexDirection: 'column', padding: 0 }, ...children);
}
