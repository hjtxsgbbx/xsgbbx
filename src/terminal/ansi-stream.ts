/**
 * ANSI streaming output parser.
 *
 * Uses the existing ANSI parser at `src/terminal/ansi/` to consume
 * streaming chunks of terminal output and produce arrays of styled
 * `ParsedChunk` objects.  Designed for real-time output rendering
 * (e.g. streaming LLM responses, build logs, shell output).
 */

import { Parser } from './ansi/parser.js';
import type { Action, TextStyle, TextSegment, Grapheme } from './ansi/types.js';
import { defaultStyle, stylesEqual } from './ansi/types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Style information for a single parsed chunk. */
export interface ParsedStyle {
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly inverse: boolean;
  readonly strikethrough: boolean;
  readonly fgColor: string | null;
  readonly bgColor: string | null;
}

/** A single styled output segment produced by the parser. */
export interface ParsedChunk {
  /** The text content of this chunk */
  readonly text: string;
  /** The style applied to this chunk */
  readonly style: ParsedStyle;
  /** Type of this chunk */
  readonly type: 'text' | 'newline' | 'bell' | 'reset';
}

/** Accumulated state across feed() calls. */
export interface ParserState {
  /** The underlying ANSI parser instance */
  readonly parser: Parser;
  /** Current accumulated text since last flush */
  readonly buffer: string;
  /** Current active style */
  readonly style: TextStyle;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new ParserState for streaming ANSI output parsing.
 */
export function createParserState(): ParserState {
  const parser = new Parser();
  return {
    parser,
    buffer: '',
    style: defaultStyle(),
  };
}

/**
 * Reset a ParserState to its initial condition.
 */
export function resetParserState(state: ParserState): ParserState {
  state.parser.reset();
  return {
    parser: state.parser,
    buffer: '',
    style: defaultStyle(),
  };
}

// ---------------------------------------------------------------------------
// Main parsing entry point
// ---------------------------------------------------------------------------

/**
 * Feed a chunk of raw terminal text (possibly containing ANSI escapes)
 * into the parser and receive an array of styled `ParsedChunk` objects.
 *
 * Accumulates partial text across calls — only complete segments are
 * emitted.  The returned `newState` should be passed into the next call.
 *
 * Example:
 * ```ts
 * let state = createParserState()
 * state = parseStreamingOutput('\x1b[31mhello ', state)
 * for (const chunk of state.emitted) { ... }
 * ```
 */
export function parseStreamingOutput(
  chunk: string,
  state: ParserState,
): ParsedChunk[] {
  const actions = state.parser.feed(chunk);
  const results: ParsedChunk[] = [];
  let currentStyle = state.style;

  for (const action of actions) {
    switch (action.type) {
      case 'text': {
        // A segment of styled text
        const segmentStyle = action.style;
        if (!stylesEqual(segmentStyle, currentStyle)) {
          currentStyle = segmentStyle;
        }
        const text = graphemesToString(action.graphemes);

        // Split by newlines to emit per-line chunks
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]!.length > 0) {
            results.push({
              text: lines[i]!,
              style: textStyleToParsed(segmentStyle),
              type: 'text',
            });
          }
          if (i < lines.length - 1) {
            results.push({
              text: '',
              style: textStyleToParsed(segmentStyle),
              type: 'newline',
            });
          }
        }
        break;
      }

      case 'sgr': {
        // SGR updates are handled internally by Parser; we track the
        // new style for subsequent text segments.
        currentStyle = state.parser.style;
        break;
      }

      case 'bell': {
        results.push({
          text: '\x07',
          style: textStyleToParsed(currentStyle),
          type: 'bell',
        });
        break;
      }

      case 'reset': {
        currentStyle = defaultStyle();
        results.push({
          text: '',
          style: textStyleToParsed(currentStyle),
          type: 'reset',
        });
        break;
      }

      // Cursor, erase, scroll, mode, link, title, tabStatus actions
      // are structural — they don't produce output text, so we skip them.
      default:
        break;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/**
 * Convert the internal `TextStyle` (from the ANSI parser) to a simplified
 * `ParsedStyle` suitable for the rendering pipeline.
 */
function textStyleToParsed(style: TextStyle): ParsedStyle {
  return {
    bold: style.bold,
    dim: style.dim,
    italic: style.italic,
    underline: style.underline !== 'none',
    inverse: style.inverse,
    strikethrough: style.strikethrough,
    fgColor: colorToString(style.fg),
    bgColor: colorToString(style.bg),
  };
}

/**
 * Convert an internal `Color` union to a string that the `colorize.ts`
 * pipeline can handle (ansi:, #hex, rgb(), or null).
 */
function colorToString(color: TextStyle['fg']): string | null {
  switch (color.type) {
    case 'named':
      return `ansi:${color.name}`;
    case 'indexed':
      return `ansi256(${color.index})`;
    case 'rgb':
      return `rgb(${color.r},${color.g},${color.b})`;
    case 'default':
      return null;
  }
}

/**
 * Join an array of Graphemes back into a plain string.
 */
function graphemesToString(graphemes: readonly Grapheme[]): string {
  return graphemes.map((g) => g.value).join('');
}
