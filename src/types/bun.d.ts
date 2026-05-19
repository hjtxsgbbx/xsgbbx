/**
 * Minimal Bun type declarations for optional Bun runtime feature detection.
 * The actual code guards with `typeof Bun !== 'undefined'` at runtime,
 * so these types only exist so TypeScript doesn't error on the Bun name.
 */

declare var Bun: {
  stringWidth(str: string, opts?: { ambiguousIsNarrow?: boolean }): number
  wrapAnsi(input: string, columns: number, options?: Record<string, unknown>): string
} | undefined
