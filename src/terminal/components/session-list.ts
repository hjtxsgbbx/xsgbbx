/**
 * Session List component — displays recent chat sessions with
 * metadata summaries and keyboard navigation support.
 *
 * Pure function that returns a VNode tree.
 */

import type { VNode } from '../ink/virtual-tree.js';
import { Box } from './box.js';
import { Text } from './text.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly messageCount: number;
  readonly preview: string;
  readonly active: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a list of chat sessions.
 *
 * Active session is highlighted.  Each entry shows the title, date,
 * message count, and a truncated preview of the last message.
 */
export function renderSessionList(
  sessions: readonly SessionSummary[],
): VNode {
  const children: VNode[] = [
    Text({
      content: ' Sessions',
      bold: true,
      color: 'ansi:white',
    }),
    Text({ content: '' }),
  ];

  if (sessions.length === 0) {
    children.push(
      Text({
        content: '  No sessions found.',
        dim: true,
      }),
    );
  } else {
    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i]!;
      children.push(renderSessionEntry(session, i));
    }
  }

  return Box(
    {
      flexDirection: 'column',
      padding: 1,
      margin: 0,
      borderStyle: 'single',
    },
    ...children,
  );
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function renderSessionEntry(
  session: SessionSummary,
  index: number,
): VNode {
  const isActive = session.active;
  const prefix = isActive ? '●' : '○';
  const nameColor = isActive ? 'ansi:cyan' : undefined;

  const children: VNode[] = [
    // Title row
    Box(
      { flexDirection: 'row', padding: 0 },
      Text({
        content: ` ${prefix} `,
        color: isActive ? 'ansi:green' : 'ansi:blackBright',
        bold: isActive,
      }),
      Text({
        content: session.title,
        bold: isActive,
        color: nameColor,
      }),
    ),
    // Metadata row
    Box(
      { flexDirection: 'row', padding: 0 },
      Text({
        content: `    ${session.date}`,
        dim: true,
      }),
      Text({
        content: `  ${session.messageCount} msgs`,
        dim: true,
      }),
    ),
    // Preview row
    Box(
      { flexDirection: 'row', padding: 0 },
      Text({
        content: `    ${truncate(session.preview, 60)}`,
        dim: true,
      }),
    ),
    Text({ content: '' }),
  ];

  return Box(
    {
      flexDirection: 'column',
      padding: 0,
      margin: 0,
    },
    ...children,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
