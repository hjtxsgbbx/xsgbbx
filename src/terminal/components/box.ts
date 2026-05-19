/**
 * Box component — flexible container with borders, padding, and
 * flex-direction layout.  Pure function that returns a VNode.
 */

import type { VNode } from '../ink/virtual-tree.js';
import { createElement } from '../ink/virtual-tree.js';
import type { BoxElement, BorderStyle, FlexDirection } from '../ink/dom.js';
import { defaultBoxElement } from '../ink/dom.js';

export interface BoxProps {
  readonly width?: number | 'auto' | 'fill';
  readonly height?: number | 'auto' | 'fill';
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly padding?: number;
  readonly margin?: number;
  readonly borderStyle?: BorderStyle;
  readonly flexDirection?: FlexDirection;
  readonly justifyContent?: 'start' | 'center' | 'end' | 'space-between';
  readonly alignItems?: 'start' | 'center' | 'end';
  readonly backgroundColor?: string;
  readonly visible?: boolean;
  readonly key?: string | number;
  readonly children?: readonly VNode[];
}

/**
 * Create a Box VNode.
 *
 * Box is the primary layout primitive.  Its children are laid out
 * according to `flexDirection` (default: column).
 */
export function Box(props: BoxProps, ...restChildren: VNode[]): VNode {
  const element: BoxElement = defaultBoxElement({
    width: props.width ?? 'auto',
    height: props.height ?? 'auto',
    minWidth: props.minWidth,
    minHeight: props.minHeight,
    maxWidth: props.maxWidth,
    maxHeight: props.maxHeight,
    padding: props.padding ?? 0,
    margin: props.margin ?? 0,
    borderStyle: props.borderStyle ?? 'none',
    flexDirection: props.flexDirection ?? 'column',
    justifyContent: props.justifyContent ?? 'start',
    alignItems: props.alignItems ?? 'start',
    backgroundColor: props.backgroundColor,
    visible: props.visible ?? true,
  });

  const children = props.children
    ? [...(props.children ?? []), ...restChildren]
    : restChildren;

  return createElement(
    'ink-box',
    { key: props.key, element },
    ...children,
  );
}
