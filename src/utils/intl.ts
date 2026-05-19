/**
 * Internationalization utilities for grapheme segmentation.
 * Uses Intl.Segmenter with lazy initialization for performance.
 */

let segmenter: Intl.Segmenter | undefined

export function getGraphemeSegmenter(): Intl.Segmenter {
  if (!segmenter) {
    segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
  }
  return segmenter
}
