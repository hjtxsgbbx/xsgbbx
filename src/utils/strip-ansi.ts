/**
 * Strip ANSI escape codes from a string.
 * Thin wrapper over the strip-ansi npm package.
 */

import _stripAnsi from 'strip-ansi'

const stripAnsi: (str: string) => string = _stripAnsi

export default stripAnsi
