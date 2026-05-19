/**
 * Slice a string while preserving ANSI escape codes.
 * Thin wrapper over the slice-ansi npm package.
 */

import _sliceAnsi from 'slice-ansi'

const sliceAnsi: (str: string, start: number, end: number) => string =
  _sliceAnsi as unknown as (str: string, start: number, end: number) => string

export default sliceAnsi
