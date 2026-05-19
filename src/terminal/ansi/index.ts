/**
 * ANSI Terminal Parser — Barrel Export
 *
 * A streaming parser for ANSI escape sequences (CSI, OSC, SGR, DEC, etc.)
 * that produces semantic actions. Ported from Claude Code's internal
 * termio library with minor import adaptations for standalone use.
 */

// Control characters and escape sequence introducers
export { C0, ESC, BEL, SEP, ESC_TYPE, isC0, isEscFinal } from './ansi.js'

// CSI (Control Sequence Introducer) types and generators
export {
  CSI_PREFIX,
  CSI_RANGE,
  isCSIParam,
  isCSIIntermediate,
  isCSIFinal,
  csi,
  CSI,
  ERASE_DISPLAY,
  ERASE_LINE_REGION,
  CURSOR_STYLES,
  cursorUp,
  cursorDown,
  cursorForward,
  cursorBack,
  cursorTo,
  CURSOR_LEFT,
  cursorPosition,
  CURSOR_HOME,
  cursorMove,
  CURSOR_SAVE,
  CURSOR_RESTORE,
  eraseToEndOfLine,
  eraseToStartOfLine,
  eraseLine,
  ERASE_LINE,
  eraseToEndOfScreen,
  eraseToStartOfScreen,
  eraseScreen,
  ERASE_SCREEN,
  ERASE_SCROLLBACK,
  eraseLines,
  scrollUp,
  scrollDown,
  setScrollRegion,
  RESET_SCROLL_REGION,
  PASTE_START,
  PASTE_END,
  FOCUS_IN,
  FOCUS_OUT,
  ENABLE_KITTY_KEYBOARD,
  DISABLE_KITTY_KEYBOARD,
  ENABLE_MODIFY_OTHER_KEYS,
  DISABLE_MODIFY_OTHER_KEYS,
} from './csi.js'
export type { CursorStyle } from './csi.js'

// DEC private mode sequences
export {
  DEC,
  decset,
  decreset,
  BSU,
  ESU,
  EBP,
  DBP,
  EFE,
  DFE,
  SHOW_CURSOR,
  HIDE_CURSOR,
  ENTER_ALT_SCREEN,
  EXIT_ALT_SCREEN,
  ENABLE_MOUSE_TRACKING,
  DISABLE_MOUSE_TRACKING,
} from './dec.js'

// ESC sequence parser
export { parseEsc } from './esc.js'

// OSC (Operating System Command) types, parser, and generators
export {
  OSC_PREFIX,
  ST,
  osc,
  wrapForMultiplexer,
  getClipboardPath,
  tmuxLoadBuffer,
  setClipboard,
  _resetLinuxCopyCache,
  OSC,
  parseOSC,
  parseOscColor,
  link,
  LINK_END,
  ITERM2,
  PROGRESS,
  CLEAR_ITERM2_PROGRESS,
  CLEAR_TERMINAL_TITLE,
  CLEAR_TAB_STATUS,
  supportsTabStatus,
  tabStatus,
} from './osc.js'
export type { ClipboardPath } from './osc.js'

// SGR (Select Graphic Rendition) parser
export { applySGR } from './sgr.js'

// Input tokenizer (escape sequence boundary detection)
export { createTokenizer } from './tokenize.js'
export type { Token, Tokenizer } from './tokenize.js'

// Semantic types
export {
  defaultStyle,
  stylesEqual,
  colorsEqual,
} from './types.js'
export type {
  NamedColor,
  Color,
  UnderlineStyle,
  TextStyle,
  CursorDirection,
  CursorAction,
  EraseAction,
  ScrollAction,
  ModeAction,
  LinkAction,
  TitleAction,
  TabStatusAction,
  TextSegment,
  Grapheme,
  Action,
} from './types.js'

// Main streaming parser
export { Parser } from './parser.js'
