/**
 * Virtual DOM element types for terminal UI.
 *
 * Defines the concrete element interfaces that components produce.
 * Each element has position, size, and style properties that feed
 * into the layout engine and renderer.
 */

import type { Size } from './layout/geometry.js';

// ---------------------------------------------------------------------------
// Shared style types
// ---------------------------------------------------------------------------

/** Border style for box elements */
export type BorderStyle = 'single' | 'double' | 'rounded' | 'none';

/** Flex direction for box layout */
export type FlexDirection = 'row' | 'column';

/** Text alignment within a block */
export type TextAlign = 'left' | 'center' | 'right';

/** Input validation state */
export type ValidationState = 'valid' | 'invalid' | 'pending';

// ---------------------------------------------------------------------------
// Element interfaces
// ---------------------------------------------------------------------------

/** Flexible container element with borders and flex layout. */
export interface BoxElement {
  readonly tag: 'box';
  readonly width?: number | 'auto' | 'fill';
  readonly height?: number | 'auto' | 'fill';
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly padding: number;
  readonly margin: number;
  readonly borderStyle: BorderStyle;
  readonly flexDirection: FlexDirection;
  readonly justifyContent: 'start' | 'center' | 'end' | 'space-between';
  readonly alignItems: 'start' | 'center' | 'end';
  readonly backgroundColor?: string;
  readonly visible: boolean;
}

/** Shared dimension constraints for layout. */
export interface ElementDimensions {
  readonly width?: number | 'auto' | 'fill';
  readonly height?: number | 'auto' | 'fill';
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
}

/** Styled text element. */
export interface TextElement extends ElementDimensions {
  readonly tag: 'text';
  readonly content: string;
  readonly color?: string;
  readonly backgroundColor?: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly dim: boolean;
  readonly inverse: boolean;
  readonly align: TextAlign;
  readonly wrap: 'nowrap' | 'wrap' | 'truncate' | 'truncate-middle' | 'truncate-end';
}

/** Text input element. */
export interface InputElement extends ElementDimensions {
  readonly tag: 'input';
  readonly value: string;
  readonly placeholder: string;
  readonly cursorOffset: number;
  readonly focus: boolean;
  readonly color?: string;
  readonly invalid: boolean;
  readonly maxLength: number;
}

/** Select / dropdown element. */
export interface SelectElement extends ElementDimensions {
  readonly tag: 'select';
  readonly items: readonly string[];
  readonly selectedIndex: number;
  readonly focus: boolean;
  readonly expanded: boolean;
  readonly color?: string;
  readonly placeholder: string;
}

/** Union of all terminal element types */
export type TerminalElement =
  | BoxElement
  | TextElement
  | InputElement
  | SelectElement;

// ---------------------------------------------------------------------------
// Defaults helpers — pure functions that return default configs
// ---------------------------------------------------------------------------

export function defaultBoxElement(overrides?: Partial<BoxElement>): BoxElement {
  return {
    tag: 'box',
    width: 'auto',
    height: 'auto',
    minWidth: 0,
    minHeight: 0,
    maxWidth: Infinity,
    maxHeight: Infinity,
    padding: 0,
    margin: 0,
    borderStyle: 'none',
    flexDirection: 'column',
    justifyContent: 'start',
    alignItems: 'start',
    visible: true,
    ...overrides,
  };
}

export function defaultTextElement(
  overrides?: Partial<TextElement>,
): TextElement {
  return {
    tag: 'text',
    content: '',
    bold: false,
    italic: false,
    underline: false,
    dim: false,
    inverse: false,
    align: 'left',
    wrap: 'nowrap',
    ...overrides,
  };
}

export function defaultInputElement(
  overrides?: Partial<InputElement>,
): InputElement {
  return {
    tag: 'input',
    value: '',
    placeholder: '',
    cursorOffset: 0,
    focus: false,
    invalid: false,
    maxLength: 1024,
    ...overrides,
  };
}

export function defaultSelectElement(
  overrides?: Partial<SelectElement>,
): SelectElement {
  return {
    tag: 'select',
    items: [],
    selectedIndex: -1,
    focus: false,
    expanded: false,
    placeholder: 'Select...',
    ...overrides,
  };
}

/** Calculate the content size for a given element (excludes margins). */
export function elementContentSize(
  el: TerminalElement,
  size: Size,
): Size {
  if (el.tag === 'box') {
    const b = borderWidth(el.borderStyle);
    return {
      width: Math.max(0, size.width - 2 * el.padding - 2 * b),
      height: Math.max(0, size.height - 2 * el.padding - 2 * b),
    };
  }
  return size;
}

/** Return the character width of the border for a given style. */
function borderWidth(style: BorderStyle): number {
  return style === 'none' ? 0 : 1;
}
