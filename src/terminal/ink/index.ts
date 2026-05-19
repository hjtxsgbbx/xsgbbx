/**
 * Terminal UI lightweight framework — barrel export.
 *
 * Built on top of the existing `src/terminal/` utilities (string-width,
 * colorize, wrap-ansi, bidi, etc.) to provide a React-free terminal
 * rendering pipeline.
 */

// Virtual DOM
export {
  createElement,
  h,
  fragment,
  isFragment,
  hasLayout,
  walkTree,
} from './virtual-tree.js';
export type {
  VNodeType,
  VNodeProps,
  VNode,
  VNodeWithLayout,
} from './virtual-tree.js';

// Element types
export {
  defaultBoxElement,
  defaultTextElement,
  defaultInputElement,
  defaultSelectElement,
  elementContentSize,
} from './dom.js';
export type {
  BorderStyle,
  FlexDirection,
  TextAlign,
  ValidationState,
  BoxElement,
  TextElement,
  InputElement,
  SelectElement,
  TerminalElement,
} from './dom.js';

// Style system
export { applyStyles, mergeStyles, textOnly, defaultStyle } from './styles.js';
export type { Style } from './styles.js';

// Measurement
export {
  measureText,
  measurePlainText,
  measureWidestLine,
  measureLines,
  truncateText,
} from './measure-text.js';
export {
  measureElement,
  measurePreferred,
  outerSize,
} from './measure-element.js';

// Layout
export { computeLayout } from './layout/engine.js';
export type { LayoutResult, LayoutNode } from './layout/engine.js';
export {
  point,
  size,
  zeroRect,
  rectFrom,
  rectContains,
  rectInset,
} from './layout/geometry.js';
export type { Point, Size, Rect } from './layout/geometry.js';

// Renderer
export { renderToString } from './renderer.js';
export type { RenderOptions, RenderOutput } from './renderer.js';

// Output / screen
export {
  writeToTerminal,
  writeLine,
  cursorTo,
  cursorUp,
  cursorDown,
  cursorForward,
  cursorBack,
  HIDE_CURSOR,
  SHOW_CURSOR,
  SAVE_CURSOR,
  RESTORE_CURSOR,
  CLEAR_SCREEN,
  CLEAR_TO_END,
  CLEAR_LINE_TO_END,
  CLEAR_LINE,
  clearLines,
  terminalWidth,
  terminalHeight,
} from './output.js';
export {
  createScreen,
  updateBackBuffer,
  swap,
  resizeScreen,
  clearScreen,
} from './screen.js';
export type { ScreenBuffer, Screen } from './screen.js';

// Focus
export {
  createFocusManager,
  registerElements,
  focusNext,
  focusPrev,
  focusById,
  blurAll,
  collectFocusable,
} from './focus.js';
export type { FocusableElement, FocusState } from './focus.js';
