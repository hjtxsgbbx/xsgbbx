/**
 * Text component — styled text with color, bold, italic support.
 * Pure function that returns a VNode.
 */

import type { VNode } from '../ink/virtual-tree.js';
import { createElement } from '../ink/virtual-tree.js';
import type { TextElement, TextAlign } from '../ink/dom.js';
import { defaultTextElement } from '../ink/dom.js';

export interface TextProps {
  readonly content: string;
  readonly color?: string;
  readonly backgroundColor?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly dim?: boolean;
  readonly inverse?: boolean;
  readonly align?: TextAlign;
  readonly wrap?: 'nowrap' | 'wrap' | 'truncate' | 'truncate-middle' | 'truncate-end';
  readonly key?: string | number;
}

/**
 * Create a Text VNode.
 *
 * Renders a single block of styled text.  Supports all ANSI-compatible
 * styling attributes plus text alignment and wrapping.
 */
export function Text(props: TextProps): VNode {
  const element: TextElement = defaultTextElement({
    content: props.content,
    color: props.color,
    backgroundColor: props.backgroundColor,
    bold: props.bold ?? false,
    italic: props.italic ?? false,
    underline: props.underline ?? false,
    dim: props.dim ?? false,
    inverse: props.inverse ?? false,
    align: props.align ?? 'left',
    wrap: props.wrap ?? 'nowrap',
  });

  return createElement('ink-text', { key: props.key, element });
}
