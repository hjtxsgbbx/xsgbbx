/**
 * ScrollArea component — virtual scrolling for large output.
 *
 * Takes a large text block and only renders the portion visible within
 * the viewport.  Pure function that returns a VNode.
 */

import type { VNode } from '../ink/virtual-tree.js';
import { createElement, fragment } from '../ink/virtual-tree.js';
import type { BoxElement } from '../ink/dom.js';
import { defaultBoxElement } from '../ink/dom.js';
import { Box } from './box.js';
import { Text } from './text.js';

export interface ScrollAreaProps {
  /** The full text content to scroll through */
  readonly content: string;
  /** Number of visible rows in the viewport */
  readonly viewportHeight: number;
  /** Current scroll offset (rows from the top) */
  readonly scrollOffset?: number;
  /** Total number of lines in the content */
  readonly totalLines?: number;
  /** Whether to show a scrollbar indicator */
  readonly showScrollbar?: boolean;
  /** Key for diffing */
  readonly key?: string | number;
}

/**
 * Create a ScrollArea VNode.
 *
 * Only renders the lines that fit within `viewportHeight` starting from
 * `scrollOffset`.  Optionally shows a scrollbar thumb on the right side.
 */
export function ScrollArea(props: ScrollAreaProps): VNode {
  const allLines = props.content.split('\n');
  const totalLines = props.totalLines ?? allLines.length;
  const offset = Math.max(0, Math.min(props.scrollOffset ?? 0, totalLines - props.viewportHeight));
  const viewHeight = Math.min(props.viewportHeight, totalLines);

  // Slice visible lines
  const visibleLines = allLines.slice(offset, offset + viewHeight);

  const children: VNode[] = [];

  // Render each visible line
  for (let i = 0; i < visibleLines.length; i++) {
    const lineContent = visibleLines[i] ?? '';

    if (props.showScrollbar) {
      // Row with scrollbar gutter on the right
      const lineNum = offset + i;
      const thumbPos = totalLines > 0
        ? Math.round((lineNum / totalLines) * viewHeight)
        : 0;
      const isThumb = lineNum === offset + Math.round(
        (offset / Math.max(totalLines - viewHeight, 1)) * (viewHeight - 1),
      );

      children.push(
        Box({ flexDirection: 'row' },
          Text({ content: lineContent }),
          Text({
            content: isThumb ? '█' : '│',
            dim: !isThumb,
          }),
        ),
      );
    } else {
      children.push(Text({ content: lineContent }));
    }
  }

  // Overflow indicator
  if (offset > 0) {
    children.unshift(
      Text({ content: `... ${offset} lines above ...`, dim: true }),
    );
  }

  const remaining = totalLines - offset - viewHeight;
  if (remaining > 0) {
    children.push(
      Text({ content: `... ${remaining} lines below ...`, dim: true }),
    );
  }

  const element: BoxElement = defaultBoxElement({
    tag: 'box',
    flexDirection: 'column',
    visible: true,
  });

  return createElement(
    'ink-scroll-area',
    {
      key: props.key,
      element,
      viewportHeight: props.viewportHeight,
      scrollOffset: offset,
      totalLines,
    },
    ...children,
  );
}
