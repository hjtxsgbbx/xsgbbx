/**
 * Cached line width calculation using the same algorithm as string-width.
 * The original implementation memoizes stringWidth results per unique string.
 * This shim delegates to the stringWidth module for correctness.
 */

import { stringWidth } from './string-width.js'

export function lineWidth(line: string): number {
  return stringWidth(line)
}
