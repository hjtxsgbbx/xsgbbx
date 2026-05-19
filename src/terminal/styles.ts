/**
 * Terminal style types used by colorize.ts and wrap-text.ts.
 */

export type Color = string

export interface TextStyles {
  inverse?: boolean
  strikethrough?: boolean
  underline?: boolean
  italic?: boolean
  bold?: boolean
  dim?: boolean
  color?: Color
  backgroundColor?: Color
}

export interface Styles {
  textWrap?: 'wrap' | 'wrap-trim' | 'nowrap' | 'truncate' | 'truncate-start' | 'truncate-middle' | 'truncate-end'
}
