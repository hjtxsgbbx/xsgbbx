/**
 * Tokenizer used for tab-stop expansion.
 * Splits text into sequences and raw text segments so the tab expander
 * can skip ANSI/OSC sequences while expanding '\t' characters.
 */

interface Token {
  type: 'sequence' | 'text'
  value: string
}

interface Tokenizer {
  feed(text: string): Token[]
  flush(): Token[]
}

/**
 * Create a tokenizer that categorizes terminal output into sequence tokens
 * (ANSI escapes, OSC sequences) and text tokens.
 */
export function createTokenizer(): Tokenizer {
  const tokens: Token[] = []

  const feed = (text: string): Token[] => {
    const result: Token[] = []
    let i = 0

    while (i < text.length) {
      if (text[i] === '\x1b') {
        const start = i
        i++
        // Consume CSI sequences: ESC [
        if (i < text.length && text[i] === '[') {
          i++
          while (i < text.length && text.charCodeAt(i) >= 0x30 && text.charCodeAt(i) <= 0x3f) i++
          while (i < text.length && text.charCodeAt(i) >= 0x20 && text.charCodeAt(i) <= 0x2f) i++
          if (i < text.length && text.charCodeAt(i) >= 0x40 && text.charCodeAt(i) <= 0x7e) i++
        }
        // Consume OSC sequences: ESC ]
        else if (i < text.length && text[i] === ']') {
          i++
          while (i < text.length && text[i] !== '\x07' && text[i] !== '\x1b') i++
          if (i < text.length && text[i] === '\x07') i++
        }
        result.push({ type: 'sequence', value: text.substring(start, i) })
      } else {
        const start = i
        while (i < text.length && text[i] !== '\x1b') i++
        result.push({ type: 'text', value: text.substring(start, i) })
      }
    }

    return result
  }

  const flush = (): Token[] => {
    const remaining = [...tokens]
    tokens.length = 0
    return remaining
  }

  return { feed, flush }
}
