/**
 * Bash parser control structures and arithmetic expressions.
 *
 * Handles expansion rest parsing (parseExpansionRest, parseExpansionRegexSegmented),
 * backtick command substitution (parseBacktick), control structures (parseIf,
 * parseWhile, parseFor, parseDoGroup, parseCase, parseCaseItem, parseCasePattern,
 * parseFunction), declarations (parseDeclaration, parseUnset), test expressions
 * (parseTestExpr, parseTestOr, parseTestAnd, parseTestUnary, parseTestBinary),
 * and arithmetic parsing (parseArithExpr through isArithStop).
 *
 * Imports from all other parser modules.
 */

import type { TsNode, Token, Lexer } from './bash-tokenizer.js'
import { advance, peek, nextToken, skipBlanks, byteAt, isWordChar, isWordStart, isIdentStart, isIdentChar, isDigit, isHexDigit, isBaseDigit, SPECIAL_VARS, SHELL_KEYWORDS, makeLexer } from './bash-tokenizer.js'
import type { ParseState } from './bash-parser-core.js'
import { mk, leaf, checkBudget, sliceBytes, saveLex, restoreLex, parseStatements, parseAndOr, parsePipeline, parseCommand, parseSimpleCommand, skipNewlines } from './bash-parser-core.js'
import { parseWord, parseDoubleQuoted, parseDollarLike, parseProcessSub, parseExpansionBody, tryParseAssignment } from './bash-parser-word.js'

export function parseExpansionRest(
  P: ParseState,
  nodeType: string,
  stopAtSlash: boolean,
): TsNode | null {
  // Don't skipBlanks — `${var:- }` space IS the word. Stop at } or newline
  // (`${var:\n}` emits no word). stopAtSlash=true stops at `/` for pat/repl
  // split in ${var/pat/repl}. nodeType 'replword' is word-mode for the
  // replacement in `/` `//` — same as 'word' but `(` is NOT array.
  const start = P.L.b
  // Value-substitution RHS starting with `(` parses as array: ${var:-(x)} →
  // (expansion (variable_name) (array (word))). Only for 'word' context (not
  // pattern-matching operators which emit regex, and not 'replword' where `(`
  // is a regular char per grammar `_expansion_regex_replacement`).
  if (nodeType === 'word' && peek(P.L) === '(') {
    advance(P.L)
    const open = mk(P, '(', start, P.L.b, [])
    const elems: TsNode[] = [open]
    while (P.L.i < P.L.len) {
      skipBlanks(P.L)
      const c = peek(P.L)
      if (c === ')' || c === '}' || c === '\n' || c === '') break
      const wStart = P.L.b
      while (P.L.i < P.L.len) {
        const wc = peek(P.L)
        if (
          wc === ')' ||
          wc === '}' ||
          wc === ' ' ||
          wc === '\t' ||
          wc === '\n' ||
          wc === ''
        ) {
          break
        }
        advance(P.L)
      }
      if (P.L.b > wStart) elems.push(mk(P, 'word', wStart, P.L.b, []))
      else break
    }
    if (peek(P.L) === ')') {
      const cStart = P.L.b
      advance(P.L)
      elems.push(mk(P, ')', cStart, P.L.b, []))
    }
    while (peek(P.L) === '\n') advance(P.L)
    return mk(P, 'array', start, P.L.b, elems)
  }
  // REGEX mode: flat single-span scan. Quotes are opaque (skipped past so
  // `/` inside them doesn't break stopAtSlash), but NOT emitted as separate
  // nodes — the entire range becomes one regex node.
  if (nodeType === 'regex') {
    let braceDepth = 0
    while (P.L.i < P.L.len) {
      const c = peek(P.L)
      if (c === '\n') break
      if (braceDepth === 0) {
        if (c === '}') break
        if (stopAtSlash && c === '/') break
      }
      if (c === '\\' && P.L.i + 1 < P.L.len) {
        advance(P.L)
        advance(P.L)
        continue
      }
      if (c === '"' || c === "'") {
        advance(P.L)
        while (P.L.i < P.L.len && peek(P.L) !== c) {
          if (peek(P.L) === '\\' && P.L.i + 1 < P.L.len) advance(P.L)
          advance(P.L)
        }
        if (peek(P.L) === c) advance(P.L)
        continue
      }
      // Skip past nested ${...} $(...) $[...] so their } / don't terminate us
      if (c === '$') {
        const c1 = peek(P.L, 1)
        if (c1 === '{') {
          let d = 0
          advance(P.L)
          advance(P.L)
          d++
          while (P.L.i < P.L.len && d > 0) {
            const nc = peek(P.L)
            if (nc === '{') d++
            else if (nc === '}') d--
            advance(P.L)
          }
          continue
        }
        if (c1 === '(') {
          let d = 0
          advance(P.L)
          advance(P.L)
          d++
          while (P.L.i < P.L.len && d > 0) {
            const nc = peek(P.L)
            if (nc === '(') d++
            else if (nc === ')') d--
            advance(P.L)
          }
          continue
        }
      }
      if (c === '{') braceDepth++
      else if (c === '}' && braceDepth > 0) braceDepth--
      advance(P.L)
    }
    const end = P.L.b
    while (peek(P.L) === '\n') advance(P.L)
    if (end === start) return null
    return mk(P, 'regex', start, end, [])
  }
  // WORD mode: segmenting parser — recognize nested ${...}, $(...), $'...',
  // "...", '...', $ident, <(...)/>(...); bare chars accumulate into word
  // segments. Multiple parts → wrapped in concatenation.
  const parts: TsNode[] = []
  let segStart = P.L.b
  let braceDepth = 0
  const flushSeg = (): void => {
    if (P.L.b > segStart) {
      parts.push(mk(P, 'word', segStart, P.L.b, []))
    }
  }
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '\n') break
    if (braceDepth === 0) {
      if (c === '}') break
      if (stopAtSlash && c === '/') break
    }
    if (c === '\\' && P.L.i + 1 < P.L.len) {
      advance(P.L)
      advance(P.L)
      continue
    }
    const c1 = peek(P.L, 1)
    if (c === '$') {
      if (c1 === '{' || c1 === '(' || c1 === '[') {
        flushSeg()
        const exp = parseDollarLike(P)
        if (exp) parts.push(exp)
        segStart = P.L.b
        continue
      }
      if (c1 === "'") {
        // $'...' ANSI-C string
        flushSeg()
        const aStart = P.L.b
        advance(P.L)
        advance(P.L)
        while (P.L.i < P.L.len && peek(P.L) !== "'") {
          if (peek(P.L) === '\\' && P.L.i + 1 < P.L.len) advance(P.L)
          advance(P.L)
        }
        if (peek(P.L) === "'") advance(P.L)
        parts.push(mk(P, 'ansi_c_string', aStart, P.L.b, []))
        segStart = P.L.b
        continue
      }
      if (isIdentStart(c1) || isDigit(c1) || SPECIAL_VARS.has(c1)) {
        flushSeg()
        const exp = parseDollarLike(P)
        if (exp) parts.push(exp)
        segStart = P.L.b
        continue
      }
    }
    if (c === '"') {
      flushSeg()
      parts.push(parseDoubleQuoted(P))
      segStart = P.L.b
      continue
    }
    if (c === "'") {
      flushSeg()
      const rStart = P.L.b
      advance(P.L)
      while (P.L.i < P.L.len && peek(P.L) !== "'") advance(P.L)
      if (peek(P.L) === "'") advance(P.L)
      parts.push(mk(P, 'raw_string', rStart, P.L.b, []))
      segStart = P.L.b
      continue
    }
    if ((c === '<' || c === '>') && c1 === '(') {
      flushSeg()
      const ps = parseProcessSub(P)
      if (ps) parts.push(ps)
      segStart = P.L.b
      continue
    }
    if (c === '`') {
      flushSeg()
      const bt = parseBacktick(P)
      if (bt) parts.push(bt)
      segStart = P.L.b
      continue
    }
    // Brace tracking so nested {a,b} brace-expansion chars don't prematurely
    // terminate (rare, but the `?` in `${cond}? (` should be treated as word).
    if (c === '{') braceDepth++
    else if (c === '}' && braceDepth > 0) braceDepth--
    advance(P.L)
  }
  flushSeg()
  // Consume trailing newlines before } so caller sees }
  while (peek(P.L) === '\n') advance(P.L)
  // Tree-sitter skips leading whitespace (extras) in expansion RHS when
  // there's content after: `${2+ ${2}}` → just (expansion). But `${v:- }`
  // (space-only RHS) keeps the space as (word). So drop leading whitespace-
  // only word segment if it's NOT the only part.
  if (
    parts.length > 1 &&
    parts[0]!.type === 'word' &&
    /^[ \t]+$/.test(parts[0]!.text)
  ) {
    parts.shift()
  }
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]!
  // Multiple parts: wrap in concatenation (word mode keeps concat wrapping;
  // regex mode also concats per tree-sitter for mixed quote+glob patterns).
  const last = parts[parts.length - 1]!
  return mk(P, 'concatenation', parts[0]!.startIndex, last.endIndex, parts)
}

// Pattern for # ## % %% operators — per grammar _expansion_regex:
// repeat(choice(regex, string, raw_string, ')', /\s+/→regex)). Each quote
// becomes a SIBLING node, not absorbed. `${f%'str'*}` → (raw_string)(regex).
export function parseExpansionRegexSegmented(P: ParseState): TsNode[] {
  const out: TsNode[] = []
  let segStart = P.L.b
  const flushRegex = (): void => {
    if (P.L.b > segStart) out.push(mk(P, 'regex', segStart, P.L.b, []))
  }
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '}' || c === '\n') break
    if (c === '\\' && P.L.i + 1 < P.L.len) {
      advance(P.L)
      advance(P.L)
      continue
    }
    if (c === '"') {
      flushRegex()
      out.push(parseDoubleQuoted(P))
      segStart = P.L.b
      continue
    }
    if (c === "'") {
      flushRegex()
      const rStart = P.L.b
      advance(P.L)
      while (P.L.i < P.L.len && peek(P.L) !== "'") advance(P.L)
      if (peek(P.L) === "'") advance(P.L)
      out.push(mk(P, 'raw_string', rStart, P.L.b, []))
      segStart = P.L.b
      continue
    }
    // Nested ${...} $(...) — opaque scan so their } doesn't terminate us
    if (c === '$') {
      const c1 = peek(P.L, 1)
      if (c1 === '{') {
        let d = 1
        advance(P.L)
        advance(P.L)
        while (P.L.i < P.L.len && d > 0) {
          const nc = peek(P.L)
          if (nc === '{') d++
          else if (nc === '}') d--
          advance(P.L)
        }
        continue
      }
      if (c1 === '(') {
        let d = 1
        advance(P.L)
        advance(P.L)
        while (P.L.i < P.L.len && d > 0) {
          const nc = peek(P.L)
          if (nc === '(') d++
          else if (nc === ')') d--
          advance(P.L)
        }
        continue
      }
    }
    advance(P.L)
  }
  flushRegex()
  while (peek(P.L) === '\n') advance(P.L)
  return out
}

export function parseBacktick(P: ParseState): TsNode | null {
  const start = P.L.b
  advance(P.L)
  const open = mk(P, '`', start, P.L.b, [])
  P.inBacktick++
  // Parse statements inline — stop at closing backtick
  const body: TsNode[] = []
  while (true) {
    skipBlanks(P.L)
    if (peek(P.L) === '`' || peek(P.L) === '') break
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type === 'EOF' || t.type === 'BACKTICK') {
      restoreLex(P.L, save)
      break
    }
    if (t.type === 'NEWLINE') continue
    restoreLex(P.L, save)
    const stmt = parseAndOr(P)
    if (!stmt) break
    body.push(stmt)
    skipBlanks(P.L)
    if (peek(P.L) === '`') break
    const save2 = saveLex(P.L)
    const sep = nextToken(P.L, 'cmd')
    if (sep.type === 'OP' && (sep.value === ';' || sep.value === '&')) {
      body.push(leaf(P, sep.value, sep))
    } else if (sep.type !== 'NEWLINE') {
      restoreLex(P.L, save2)
    }
  }
  P.inBacktick--
  let close: TsNode
  if (peek(P.L) === '`') {
    const cStart = P.L.b
    advance(P.L)
    close = mk(P, '`', cStart, P.L.b, [])
  } else {
    close = mk(P, '`', P.L.b, P.L.b, [])
  }
  // Empty backticks (whitespace/newline only) are elided entirely by
  // tree-sitter — used as a line-continuation hack: "foo"`<newline>`"bar"
  // → (concatenation (string) (string)) with no command_substitution.
  if (body.length === 0) return null
  return mk(P, 'command_substitution', start, close.endIndex, [
    open,
    ...body,
    close,
  ])
}

export function parseIf(P: ParseState, ifTok: Token): TsNode {
  const ifKw = leaf(P, 'if', ifTok)
  const kids: TsNode[] = [ifKw]
  const cond = parseStatements(P, null)
  kids.push(...cond)
  consumeKeyword(P, 'then', kids)
  const body = parseStatements(P, null)
  kids.push(...body)
  while (true) {
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type === 'WORD' && t.value === 'elif') {
      const eKw = leaf(P, 'elif', t)
      const eCond = parseStatements(P, null)
      const eKids: TsNode[] = [eKw, ...eCond]
      consumeKeyword(P, 'then', eKids)
      const eBody = parseStatements(P, null)
      eKids.push(...eBody)
      const last = eKids[eKids.length - 1]!
      kids.push(mk(P, 'elif_clause', eKw.startIndex, last.endIndex, eKids))
    } else if (t.type === 'WORD' && t.value === 'else') {
      const elKw = leaf(P, 'else', t)
      const elBody = parseStatements(P, null)
      const last = elBody.length > 0 ? elBody[elBody.length - 1]! : elKw
      kids.push(
        mk(P, 'else_clause', elKw.startIndex, last.endIndex, [elKw, ...elBody]),
      )
    } else {
      restoreLex(P.L, save)
      break
    }
  }
  consumeKeyword(P, 'fi', kids)
  const last = kids[kids.length - 1]!
  return mk(P, 'if_statement', ifKw.startIndex, last.endIndex, kids)
}

export function parseWhile(P: ParseState, kwTok: Token): TsNode {
  const kw = leaf(P, kwTok.value, kwTok)
  const kids: TsNode[] = [kw]
  const cond = parseStatements(P, null)
  kids.push(...cond)
  const dg = parseDoGroup(P)
  if (dg) kids.push(dg)
  const last = kids[kids.length - 1]!
  return mk(P, 'while_statement', kw.startIndex, last.endIndex, kids)
}

export function parseFor(P: ParseState, forTok: Token): TsNode {
  const forKw = leaf(P, forTok.value, forTok)
  skipBlanks(P.L)
  // C-style for (( ; ; )) — only for `for`, not `select`
  if (forTok.value === 'for' && peek(P.L) === '(' && peek(P.L, 1) === '(') {
    const oStart = P.L.b
    advance(P.L)
    advance(P.L)
    const open = mk(P, '((', oStart, P.L.b, [])
    const kids: TsNode[] = [forKw, open]
    // init; cond; update — all three use 'assign' mode so `c = expr` emits
    // variable_assignment, while bare idents (c in `c<=5`) → word. Each
    // clause may be a comma-separated list.
    for (let k = 0; k < 3; k++) {
      skipBlanks(P.L)
      const es = parseArithCommaList(P, k < 2 ? ';' : '))', 'assign')
      kids.push(...es)
      if (k < 2) {
        if (peek(P.L) === ';') {
          const s = P.L.b
          advance(P.L)
          kids.push(mk(P, ';', s, P.L.b, []))
        }
      }
    }
    skipBlanks(P.L)
    if (peek(P.L) === ')' && peek(P.L, 1) === ')') {
      const cStart = P.L.b
      advance(P.L)
      advance(P.L)
      kids.push(mk(P, '))', cStart, P.L.b, []))
    }
    // Optional ; or newline
    const save = saveLex(P.L)
    const sep = nextToken(P.L, 'cmd')
    if (sep.type === 'OP' && sep.value === ';') {
      kids.push(leaf(P, ';', sep))
    } else if (sep.type !== 'NEWLINE') {
      restoreLex(P.L, save)
    }
    const dg = parseDoGroup(P)
    if (dg) {
      kids.push(dg)
    } else {
      // C-style for can also use `{ ... }` body instead of `do ... done`
      skipNewlines(P)
      skipBlanks(P.L)
      if (peek(P.L) === '{') {
        const bOpen = P.L.b
        advance(P.L)
        const brace = mk(P, '{', bOpen, P.L.b, [])
        const body = parseStatements(P, '}')
        let bClose: TsNode
        if (peek(P.L) === '}') {
          const cs = P.L.b
          advance(P.L)
          bClose = mk(P, '}', cs, P.L.b, [])
        } else {
          bClose = mk(P, '}', P.L.b, P.L.b, [])
        }
        kids.push(
          mk(P, 'compound_statement', brace.startIndex, bClose.endIndex, [
            brace,
            ...body,
            bClose,
          ]),
        )
      }
    }
    const last = kids[kids.length - 1]!
    return mk(P, 'c_style_for_statement', forKw.startIndex, last.endIndex, kids)
  }
  // Regular for VAR in words; do ... done
  const kids: TsNode[] = [forKw]
  const varTok = nextToken(P.L, 'arg')
  kids.push(mk(P, 'variable_name', varTok.start, varTok.end, []))
  skipBlanks(P.L)
  const save = saveLex(P.L)
  const inTok = nextToken(P.L, 'arg')
  if (inTok.type === 'WORD' && inTok.value === 'in') {
    kids.push(leaf(P, 'in', inTok))
    while (true) {
      skipBlanks(P.L)
      const c = peek(P.L)
      if (c === ';' || c === '\n' || c === '') break
      const w = parseWord(P, 'arg')
      if (!w) break
      kids.push(w)
    }
  } else {
    restoreLex(P.L, save)
  }
  // Separator
  const save2 = saveLex(P.L)
  const sep = nextToken(P.L, 'cmd')
  if (sep.type === 'OP' && sep.value === ';') {
    kids.push(leaf(P, ';', sep))
  } else if (sep.type !== 'NEWLINE') {
    restoreLex(P.L, save2)
  }
  const dg = parseDoGroup(P)
  if (dg) kids.push(dg)
  const last = kids[kids.length - 1]!
  return mk(P, 'for_statement', forKw.startIndex, last.endIndex, kids)
}

export function parseDoGroup(P: ParseState): TsNode | null {
  skipNewlines(P)
  const save = saveLex(P.L)
  const doTok = nextToken(P.L, 'cmd')
  if (doTok.type !== 'WORD' || doTok.value !== 'do') {
    restoreLex(P.L, save)
    return null
  }
  const doKw = leaf(P, 'do', doTok)
  const body = parseStatements(P, null)
  const kids: TsNode[] = [doKw, ...body]
  consumeKeyword(P, 'done', kids)
  const last = kids[kids.length - 1]!
  return mk(P, 'do_group', doKw.startIndex, last.endIndex, kids)
}

export function parseCase(P: ParseState, caseTok: Token): TsNode {
  const caseKw = leaf(P, 'case', caseTok)
  const kids: TsNode[] = [caseKw]
  skipBlanks(P.L)
  const word = parseWord(P, 'arg')
  if (word) kids.push(word)
  skipBlanks(P.L)
  consumeKeyword(P, 'in', kids)
  skipNewlines(P)
  while (true) {
    skipBlanks(P.L)
    skipNewlines(P)
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'arg')
    if (t.type === 'WORD' && t.value === 'esac') {
      kids.push(leaf(P, 'esac', t))
      break
    }
    if (t.type === 'EOF') break
    restoreLex(P.L, save)
    const item = parseCaseItem(P)
    if (!item) break
    kids.push(item)
  }
  const last = kids[kids.length - 1]!
  return mk(P, 'case_statement', caseKw.startIndex, last.endIndex, kids)
}

export function parseCaseItem(P: ParseState): TsNode | null {
  skipBlanks(P.L)
  const start = P.L.b
  const kids: TsNode[] = []
  // Optional leading '(' before pattern — bash allows (pattern) syntax
  if (peek(P.L) === '(') {
    const s = P.L.b
    advance(P.L)
    kids.push(mk(P, '(', s, P.L.b, []))
  }
  // Pattern(s)
  let isFirstAlt = true
  while (true) {
    skipBlanks(P.L)
    const c = peek(P.L)
    if (c === ')' || c === '') break
    const pats = parseCasePattern(P)
    if (pats.length === 0) break
    // tree-sitter quirk: first alternative with quotes is inlined as flat
    // siblings; subsequent alternatives are wrapped in (concatenation) with
    // `word` instead of `extglob_pattern` for bare segments.
    if (!isFirstAlt && pats.length > 1) {
      const rewritten = pats.map(p =>
        p.type === 'extglob_pattern'
          ? mk(P, 'word', p.startIndex, p.endIndex, [])
          : p,
      )
      const first = rewritten[0]!
      const last = rewritten[rewritten.length - 1]!
      kids.push(
        mk(P, 'concatenation', first.startIndex, last.endIndex, rewritten),
      )
    } else {
      kids.push(...pats)
    }
    isFirstAlt = false
    skipBlanks(P.L)
    // \<newline> line continuation between alternatives
    if (peek(P.L) === '\\' && peek(P.L, 1) === '\n') {
      advance(P.L)
      advance(P.L)
      skipBlanks(P.L)
    }
    if (peek(P.L) === '|') {
      const s = P.L.b
      advance(P.L)
      kids.push(mk(P, '|', s, P.L.b, []))
      // \<newline> after | is also a line continuation
      if (peek(P.L) === '\\' && peek(P.L, 1) === '\n') {
        advance(P.L)
        advance(P.L)
      }
    } else {
      break
    }
  }
  if (peek(P.L) === ')') {
    const s = P.L.b
    advance(P.L)
    kids.push(mk(P, ')', s, P.L.b, []))
  }
  const body = parseStatements(P, null)
  kids.push(...body)
  const save = saveLex(P.L)
  const term = nextToken(P.L, 'cmd')
  if (
    term.type === 'OP' &&
    (term.value === ';;' || term.value === ';&' || term.value === ';;&')
  ) {
    kids.push(leaf(P, term.value, term))
  } else {
    restoreLex(P.L, save)
  }
  if (kids.length === 0) return null
  // tree-sitter quirk: case_item with EMPTY body and a single pattern matching
  // extglob-operator-char-prefix (no actual glob metachars) downgrades to word.
  // `-o) owner=$2 ;;` (has body) → extglob_pattern; `-g) ;;` (empty) → word.
  if (body.length === 0) {
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i]!
      if (k.type !== 'extglob_pattern') continue
      const text = sliceBytes(P, k.startIndex, k.endIndex)
      if (/^[-+?*@!][a-zA-Z]/.test(text) && !/[*?(]/.test(text)) {
        kids[i] = mk(P, 'word', k.startIndex, k.endIndex, [])
      }
    }
  }
  const last = kids[kids.length - 1]!
  return mk(P, 'case_item', start, last.endIndex, kids)
}

export function parseCasePattern(P: ParseState): TsNode[] {
  skipBlanks(P.L)
  const save = saveLex(P.L)
  const start = P.L.b
  const startI = P.L.i
  let parenDepth = 0
  let hasDollar = false
  let hasBracketOutsideParen = false
  let hasQuote = false
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '\\' && P.L.i + 1 < P.L.len) {
      // Escaped char — consume both (handles `bar\ baz` as single pattern)
      // \<newline> is a line continuation; eat it but stay in pattern.
      advance(P.L)
      advance(P.L)
      continue
    }
    if (c === '"' || c === "'") {
      hasQuote = true
      // Skip past the quoted segment so its content (spaces, |, etc.) doesn't
      // break the peek-ahead scan.
      advance(P.L)
      while (P.L.i < P.L.len && peek(P.L) !== c) {
        if (peek(P.L) === '\\' && P.L.i + 1 < P.L.len) advance(P.L)
        advance(P.L)
      }
      if (peek(P.L) === c) advance(P.L)
      continue
    }
    // Paren counting: any ( inside pattern opens a scope; don't break at ) or |
    // until balanced. Handles extglob *(a|b) and nested shapes *([0-9])([0-9]).
    if (c === '(') {
      parenDepth++
      advance(P.L)
      continue
    }
    if (parenDepth > 0) {
      if (c === ')') {
        parenDepth--
        advance(P.L)
        continue
      }
      if (c === '\n') break
      advance(P.L)
      continue
    }
    if (c === ')' || c === '|' || c === ' ' || c === '\t' || c === '\n') break
    if (c === '$') hasDollar = true
    if (c === '[') hasBracketOutsideParen = true
    advance(P.L)
  }
  if (P.L.b === start) return []
  const text = P.src.slice(startI, P.L.i)
  const hasExtglobParen = /[*?+@!]\(/.test(text)
  // Quoted segments in pattern: tree-sitter splits at quote boundaries into
  // multiple sibling nodes. `*"foo"*` → (extglob_pattern)(string)(extglob_pattern).
  // Re-scan with a segmenting pass.
  if (hasQuote && !hasExtglobParen) {
    restoreLex(P.L, save)
    return parseCasePatternSegmented(P)
  }
  // tree-sitter splits patterns with [ or $ into concatenation via word parsing
  // UNLESS pattern has extglob parens (those override and emit extglob_pattern).
  // `*.[1357]` → concat(word word number word); `${PN}.pot` → concat(expansion word);
  // but `*([0-9])` → extglob_pattern (has extglob paren).
  if (!hasExtglobParen && (hasDollar || hasBracketOutsideParen)) {
    restoreLex(P.L, save)
    const w = parseWord(P, 'arg')
    return w ? [w] : []
  }
  // Patterns starting with extglob operator chars (+ - ? * @ !) followed by
  // identifier chars are extglob_pattern per tree-sitter, even without parens
  // or glob metachars. `-o)` → extglob_pattern; plain `foo)` → word.
  const type =
    hasExtglobParen || /[*?]/.test(text) || /^[-+?*@!][a-zA-Z]/.test(text)
      ? 'extglob_pattern'
      : 'word'
  return [mk(P, type, start, P.L.b, [])]
}

// Segmented scan for case patterns containing quotes: `*"foo"*` →
// [extglob_pattern, string, extglob_pattern]. Bare segments → extglob_pattern
// if they have */?, else word. Stops at ) | space tab newline outside quotes.
export function parseCasePatternSegmented(P: ParseState): TsNode[] {
  const parts: TsNode[] = []
  let segStart = P.L.b
  let segStartI = P.L.i
  const flushSeg = (): void => {
    if (P.L.i > segStartI) {
      const t = P.src.slice(segStartI, P.L.i)
      const type = /[*?]/.test(t) ? 'extglob_pattern' : 'word'
      parts.push(mk(P, type, segStart, P.L.b, []))
    }
  }
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '\\' && P.L.i + 1 < P.L.len) {
      advance(P.L)
      advance(P.L)
      continue
    }
    if (c === '"') {
      flushSeg()
      parts.push(parseDoubleQuoted(P))
      segStart = P.L.b
      segStartI = P.L.i
      continue
    }
    if (c === "'") {
      flushSeg()
      const tok = nextToken(P.L, 'arg')
      parts.push(leaf(P, 'raw_string', tok))
      segStart = P.L.b
      segStartI = P.L.i
      continue
    }
    if (c === ')' || c === '|' || c === ' ' || c === '\t' || c === '\n') break
    advance(P.L)
  }
  flushSeg()
  return parts
}

export function parseFunction(P: ParseState, fnTok: Token): TsNode {
  const fnKw = leaf(P, 'function', fnTok)
  skipBlanks(P.L)
  const nameTok = nextToken(P.L, 'arg')
  const name = mk(P, 'word', nameTok.start, nameTok.end, [])
  const kids: TsNode[] = [fnKw, name]
  skipBlanks(P.L)
  if (peek(P.L) === '(' && peek(P.L, 1) === ')') {
    const o = nextToken(P.L, 'cmd')
    const c = nextToken(P.L, 'cmd')
    kids.push(leaf(P, '(', o))
    kids.push(leaf(P, ')', c))
  }
  skipBlanks(P.L)
  skipNewlines(P)
  const body = parseCommand(P)
  if (body) {
    // Hoist redirects from redirected_statement(compound_statement, ...) to
    // function_definition level per tree-sitter grammar
    if (
      body.type === 'redirected_statement' &&
      body.children.length >= 2 &&
      body.children[0]!.type === 'compound_statement'
    ) {
      kids.push(...body.children)
    } else {
      kids.push(body)
    }
  }
  const last = kids[kids.length - 1]!
  return mk(P, 'function_definition', fnKw.startIndex, last.endIndex, kids)
}

export function parseDeclaration(P: ParseState, kwTok: Token): TsNode {
  const kw = leaf(P, kwTok.value, kwTok)
  const kids: TsNode[] = [kw]
  while (true) {
    skipBlanks(P.L)
    const c = peek(P.L)
    if (
      c === '' ||
      c === '\n' ||
      c === ';' ||
      c === '&' ||
      c === '|' ||
      c === ')' ||
      c === '<' ||
      c === '>'
    ) {
      break
    }
    const a = tryParseAssignment(P)
    if (a) {
      kids.push(a)
      continue
    }
    // Quoted string or concatenation: `export "FOO=bar"`, `export 'X'`
    if (c === '"' || c === "'" || c === '$') {
      const w = parseWord(P, 'arg')
      if (w) {
        kids.push(w)
        continue
      }
      break
    }
    // Flag like -a or bare variable name
    const save = saveLex(P.L)
    const tok = nextToken(P.L, 'arg')
    if (tok.type === 'WORD' || tok.type === 'NUMBER') {
      if (tok.value.startsWith('-')) {
        kids.push(leaf(P, 'word', tok))
      } else if (isIdentStart(tok.value[0] ?? '')) {
        kids.push(mk(P, 'variable_name', tok.start, tok.end, []))
      } else {
        kids.push(leaf(P, 'word', tok))
      }
    } else {
      restoreLex(P.L, save)
      break
    }
  }
  const last = kids[kids.length - 1]!
  return mk(P, 'declaration_command', kw.startIndex, last.endIndex, kids)
}

export function parseUnset(P: ParseState, kwTok: Token): TsNode {
  const kw = leaf(P, 'unset', kwTok)
  const kids: TsNode[] = [kw]
  while (true) {
    skipBlanks(P.L)
    const c = peek(P.L)
    if (
      c === '' ||
      c === '\n' ||
      c === ';' ||
      c === '&' ||
      c === '|' ||
      c === ')' ||
      c === '<' ||
      c === '>'
    ) {
      break
    }
    // SECURITY: use parseWord (not raw nextToken) so quoted strings like
    // `unset 'a[$(id)]'` emit a raw_string child that ast.ts can reject.
    // Previously `break` silently dropped non-WORD args — hiding the
    // arithmetic-subscript code-exec vector from the security walker.
    const arg = parseWord(P, 'arg')
    if (!arg) break
    if (arg.type === 'word') {
      if (arg.text.startsWith('-')) {
        kids.push(arg)
      } else {
        kids.push(mk(P, 'variable_name', arg.startIndex, arg.endIndex, []))
      }
    } else {
      kids.push(arg)
    }
  }
  const last = kids[kids.length - 1]!
  return mk(P, 'unset_command', kw.startIndex, last.endIndex, kids)
}

export function consumeKeyword(P: ParseState, name: string, kids: TsNode[]): void {
  skipNewlines(P)
  const save = saveLex(P.L)
  const t = nextToken(P.L, 'cmd')
  if (t.type === 'WORD' && t.value === name) {
    kids.push(leaf(P, name, t))
  } else {
    restoreLex(P.L, save)
  }
}

// ───────────────────── Test & Arithmetic Expressions ─────────────────────

export function parseTestExpr(P: ParseState, closer: string): TsNode | null {
  return parseTestOr(P, closer)
}

export function parseTestOr(P: ParseState, closer: string): TsNode | null {
  let left = parseTestAnd(P, closer)
  if (!left) return null
  while (true) {
    skipBlanks(P.L)
    const save = saveLex(P.L)
    if (peek(P.L) === '|' && peek(P.L, 1) === '|') {
      const s = P.L.b
      advance(P.L)
      advance(P.L)
      const op = mk(P, '||', s, P.L.b, [])
      const right = parseTestAnd(P, closer)
      if (!right) {
        restoreLex(P.L, save)
        break
      }
      left = mk(P, 'binary_expression', left.startIndex, right.endIndex, [
        left,
        op,
        right,
      ])
    } else {
      break
    }
  }
  return left
}

export function parseTestAnd(P: ParseState, closer: string): TsNode | null {
  let left = parseTestUnary(P, closer)
  if (!left) return null
  while (true) {
    skipBlanks(P.L)
    if (peek(P.L) === '&' && peek(P.L, 1) === '&') {
      const s = P.L.b
      advance(P.L)
      advance(P.L)
      const op = mk(P, '&&', s, P.L.b, [])
      const right = parseTestUnary(P, closer)
      if (!right) break
      left = mk(P, 'binary_expression', left.startIndex, right.endIndex, [
        left,
        op,
        right,
      ])
    } else {
      break
    }
  }
  return left
}

export function parseTestUnary(P: ParseState, closer: string): TsNode | null {
  skipBlanks(P.L)
  const c = peek(P.L)
  if (c === '(') {
    const s = P.L.b
    advance(P.L)
    const open = mk(P, '(', s, P.L.b, [])
    const inner = parseTestOr(P, closer)
    skipBlanks(P.L)
    let close: TsNode
    if (peek(P.L) === ')') {
      const cs = P.L.b
      advance(P.L)
      close = mk(P, ')', cs, P.L.b, [])
    } else {
      close = mk(P, ')', P.L.b, P.L.b, [])
    }
    const kids = inner ? [open, inner, close] : [open, close]
    return mk(
      P,
      'parenthesized_expression',
      open.startIndex,
      close.endIndex,
      kids,
    )
  }
  return parseTestBinary(P, closer)
}

/**
 * Parse `!`-negated or test-operator (`-f`) or parenthesized primary — but NOT
 * a binary comparison. Used as LHS of binary_expression so `! x =~ y` binds
 * `!` to `x` only, not the whole `x =~ y`.
 */
export function parseTestNegatablePrimary(
  P: ParseState,
  closer: string,
): TsNode | null {
  skipBlanks(P.L)
  const c = peek(P.L)
  if (c === '!') {
    const s = P.L.b
    advance(P.L)
    const bang = mk(P, '!', s, P.L.b, [])
    const inner = parseTestNegatablePrimary(P, closer)
    if (!inner) return bang
    return mk(P, 'unary_expression', bang.startIndex, inner.endIndex, [
      bang,
      inner,
    ])
  }
  if (c === '-' && isIdentStart(peek(P.L, 1))) {
    const s = P.L.b
    advance(P.L)
    while (isIdentChar(peek(P.L))) advance(P.L)
    const op = mk(P, 'test_operator', s, P.L.b, [])
    skipBlanks(P.L)
    const arg = parseTestPrimary(P, closer)
    if (!arg) return op
    return mk(P, 'unary_expression', op.startIndex, arg.endIndex, [op, arg])
  }
  return parseTestPrimary(P, closer)
}

export function parseTestBinary(P: ParseState, closer: string): TsNode | null {
  skipBlanks(P.L)
  // `!` in test context binds tighter than =~/==.
  // `[[ ! "x" =~ y ]]` → (binary_expression (unary_expression (string)) (regex))
  // `[[ ! -f x ]]` → (unary_expression ! (unary_expression (test_operator) (word)))
  const left = parseTestNegatablePrimary(P, closer)
  if (!left) return null
  skipBlanks(P.L)
  // Binary comparison: == != =~ -eq -lt etc.
  const c = peek(P.L)
  const c1 = peek(P.L, 1)
  let op: TsNode | null = null
  const os = P.L.b
  if (c === '=' && c1 === '=') {
    advance(P.L)
    advance(P.L)
    op = mk(P, '==', os, P.L.b, [])
  } else if (c === '!' && c1 === '=') {
    advance(P.L)
    advance(P.L)
    op = mk(P, '!=', os, P.L.b, [])
  } else if (c === '=' && c1 === '~') {
    advance(P.L)
    advance(P.L)
    op = mk(P, '=~', os, P.L.b, [])
  } else if (c === '=' && c1 !== '=') {
    advance(P.L)
    op = mk(P, '=', os, P.L.b, [])
  } else if (c === '<' && c1 !== '<') {
    advance(P.L)
    op = mk(P, '<', os, P.L.b, [])
  } else if (c === '>' && c1 !== '>') {
    advance(P.L)
    op = mk(P, '>', os, P.L.b, [])
  } else if (c === '-' && isIdentStart(c1)) {
    advance(P.L)
    while (isIdentChar(peek(P.L))) advance(P.L)
    op = mk(P, 'test_operator', os, P.L.b, [])
  }
  if (!op) return left
  skipBlanks(P.L)
  // In [[ ]], RHS of ==/!=/=/=~ gets special pattern parsing: paren counting
  // so @(a|b|c) doesn't break on |, and segments become extglob_pattern/regex.
  if (closer === ']]') {
    const opText = op.type
    if (opText === '=~') {
      skipBlanks(P.L)
      // If the ENTIRE RHS is a quoted string, emit string/raw_string not
      // regex: `[[ "$x" =~ "$y" ]]` → (binary_expression (string) (string)).
      // If there's content after the quote (`' boop '(.*)$`), the whole RHS
      // stays a single (regex). Peek past the quote to check.
      const rc = peek(P.L)
      let rhs: TsNode | null = null
      if (rc === '"' || rc === "'") {
        const save = saveLex(P.L)
        const quoted =
          rc === '"'
            ? parseDoubleQuoted(P)
            : leaf(P, 'raw_string', nextToken(P.L, 'arg'))
        // Check if RHS ends here: only whitespace then ]] or &&/|| or newline
        let j = P.L.i
        while (j < P.L.len && (P.src[j] === ' ' || P.src[j] === '\t')) j++
        const nc = P.src[j] ?? ''
        const nc1 = P.src[j + 1] ?? ''
        if (
          (nc === ']' && nc1 === ']') ||
          (nc === '&' && nc1 === '&') ||
          (nc === '|' && nc1 === '|') ||
          nc === '\n' ||
          nc === ''
        ) {
          rhs = quoted
        } else {
          restoreLex(P.L, save)
        }
      }
      if (!rhs) rhs = parseTestRegexRhs(P)
      if (!rhs) return left
      return mk(P, 'binary_expression', left.startIndex, rhs.endIndex, [
        left,
        op,
        rhs,
      ])
    }
    // Single `=` emits (regex) per tree-sitter; `==` and `!=` emit extglob_pattern
    if (opText === '=') {
      const rhs = parseTestRegexRhs(P)
      if (!rhs) return left
      return mk(P, 'binary_expression', left.startIndex, rhs.endIndex, [
        left,
        op,
        rhs,
      ])
    }
    if (opText === '==' || opText === '!=') {
      const parts = parseTestExtglobRhs(P)
      if (parts.length === 0) return left
      const last = parts[parts.length - 1]!
      return mk(P, 'binary_expression', left.startIndex, last.endIndex, [
        left,
        op,
        ...parts,
      ])
    }
  }
  const right = parseTestPrimary(P, closer)
  if (!right) return left
  return mk(P, 'binary_expression', left.startIndex, right.endIndex, [
    left,
    op,
    right,
  ])
}

// RHS of =~ in [[ ]] — scan as single (regex) node with paren/bracket counting
// so | ( ) inside the regex don't break parsing. Stop at ]] or ws+&&/||.
export function parseTestRegexRhs(P: ParseState): TsNode | null {
  skipBlanks(P.L)
  const start = P.L.b
  let parenDepth = 0
  let bracketDepth = 0
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '\\' && P.L.i + 1 < P.L.len) {
      advance(P.L)
      advance(P.L)
      continue
    }
    if (c === '\n') break
    if (parenDepth === 0 && bracketDepth === 0) {
      if (c === ']' && peek(P.L, 1) === ']') break
      if (c === ' ' || c === '\t') {
        // Peek past blanks for ]] or &&/||
        let j = P.L.i
        while (j < P.L.len && (P.L.src[j] === ' ' || P.L.src[j] === '\t')) j++
        const nc = P.L.src[j] ?? ''
        const nc1 = P.L.src[j + 1] ?? ''
        if (
          (nc === ']' && nc1 === ']') ||
          (nc === '&' && nc1 === '&') ||
          (nc === '|' && nc1 === '|')
        ) {
          break
        }
        advance(P.L)
        continue
      }
    }
    if (c === '(') parenDepth++
    else if (c === ')' && parenDepth > 0) parenDepth--
    else if (c === '[') bracketDepth++
    else if (c === ']' && bracketDepth > 0) bracketDepth--
    advance(P.L)
  }
  if (P.L.b === start) return null
  return mk(P, 'regex', start, P.L.b, [])
}

// RHS of ==/!=/= in [[ ]] — returns array of parts. Bare text → extglob_pattern
// (with paren counting for @(a|b)); $(...)/${}/quoted → proper node types.
// Multiple parts become flat children of binary_expression per tree-sitter.
export function parseTestExtglobRhs(P: ParseState): TsNode[] {
  skipBlanks(P.L)
  const parts: TsNode[] = []
  let segStart = P.L.b
  let segStartI = P.L.i
  let parenDepth = 0
  const flushSeg = () => {
    if (P.L.i > segStartI) {
      const text = P.src.slice(segStartI, P.L.i)
      // Pure number stays number; everything else is extglob_pattern
      const type = /^\d+$/.test(text) ? 'number' : 'extglob_pattern'
      parts.push(mk(P, type, segStart, P.L.b, []))
    }
  }
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '\\' && P.L.i + 1 < P.L.len) {
      advance(P.L)
      advance(P.L)
      continue
    }
    if (c === '\n') break
    if (parenDepth === 0) {
      if (c === ']' && peek(P.L, 1) === ']') break
      if (c === ' ' || c === '\t') {
        let j = P.L.i
        while (j < P.L.len && (P.L.src[j] === ' ' || P.L.src[j] === '\t')) j++
        const nc = P.L.src[j] ?? ''
        const nc1 = P.L.src[j + 1] ?? ''
        if (
          (nc === ']' && nc1 === ']') ||
          (nc === '&' && nc1 === '&') ||
          (nc === '|' && nc1 === '|')
        ) {
          break
        }
        advance(P.L)
        continue
      }
    }
    // $ " ' must be parsed even inside @( ) extglob parens — parseDollarLike
    // consumes matching ) so parenDepth stays consistent.
    if (c === '$') {
      const c1 = peek(P.L, 1)
      if (
        c1 === '(' ||
        c1 === '{' ||
        isIdentStart(c1) ||
        SPECIAL_VARS.has(c1)
      ) {
        flushSeg()
        const exp = parseDollarLike(P)
        if (exp) parts.push(exp)
        segStart = P.L.b
        segStartI = P.L.i
        continue
      }
    }
    if (c === '"') {
      flushSeg()
      parts.push(parseDoubleQuoted(P))
      segStart = P.L.b
      segStartI = P.L.i
      continue
    }
    if (c === "'") {
      flushSeg()
      const tok = nextToken(P.L, 'arg')
      parts.push(leaf(P, 'raw_string', tok))
      segStart = P.L.b
      segStartI = P.L.i
      continue
    }
    if (c === '(') parenDepth++
    else if (c === ')' && parenDepth > 0) parenDepth--
    advance(P.L)
  }
  flushSeg()
  return parts
}

export function parseTestPrimary(P: ParseState, closer: string): TsNode | null {
  skipBlanks(P.L)
  // Stop at closer
  if (closer === ']' && peek(P.L) === ']') return null
  if (closer === ']]' && peek(P.L) === ']' && peek(P.L, 1) === ']') return null
  return parseWord(P, 'arg')
}

/**
 * Arithmetic context modes:
 * - 'var': bare identifiers → variable_name (default, used in $((..)), ((..)))
 * - 'word': bare identifiers → word (c-style for head condition/update clauses)
 * - 'assign': identifiers with = → variable_assignment (c-style for init clause)
 */
export type ArithMode = 'var' | 'word' | 'assign'

/** Operator precedence table (higher = tighter binding). */
export const ARITH_PREC: Record<string, number> = {
  '=': 2,
  '+=': 2,
  '-=': 2,
  '*=': 2,
  '/=': 2,
  '%=': 2,
  '<<=': 2,
  '>>=': 2,
  '&=': 2,
  '^=': 2,
  '|=': 2,
  '||': 4,
  '&&': 5,
  '|': 6,
  '^': 7,
  '&': 8,
  '==': 9,
  '!=': 9,
  '<': 10,
  '>': 10,
  '<=': 10,
  '>=': 10,
  '<<': 11,
  '>>': 11,
  '+': 12,
  '-': 12,
  '*': 13,
  '/': 13,
  '%': 13,
  '**': 14,
}

/** Right-associative operators (assignment and exponent). */
export const ARITH_RIGHT_ASSOC = new Set([
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '<<=',
  '>>=',
  '&=',
  '^=',
  '|=',
  '**',
])

export function parseArithExpr(
  P: ParseState,
  stop: string,
  mode: ArithMode = 'var',
): TsNode | null {
  return parseArithTernary(P, stop, mode)
}

/** Top-level: comma-separated list. arithmetic_expansion emits multiple children. */
export function parseArithCommaList(
  P: ParseState,
  stop: string,
  mode: ArithMode = 'var',
): TsNode[] {
  const out: TsNode[] = []
  while (true) {
    const e = parseArithTernary(P, stop, mode)
    if (e) out.push(e)
    skipBlanks(P.L)
    if (peek(P.L) === ',' && !isArithStop(P, stop)) {
      advance(P.L)
      continue
    }
    break
  }
  return out
}

export function parseArithTernary(
  P: ParseState,
  stop: string,
  mode: ArithMode,
): TsNode | null {
  const cond = parseArithBinary(P, stop, 0, mode)
  if (!cond) return null
  skipBlanks(P.L)
  if (peek(P.L) === '?') {
    const qs = P.L.b
    advance(P.L)
    const q = mk(P, '?', qs, P.L.b, [])
    const t = parseArithBinary(P, ':', 0, mode)
    skipBlanks(P.L)
    let colon: TsNode
    if (peek(P.L) === ':') {
      const cs = P.L.b
      advance(P.L)
      colon = mk(P, ':', cs, P.L.b, [])
    } else {
      colon = mk(P, ':', P.L.b, P.L.b, [])
    }
    const f = parseArithTernary(P, stop, mode)
    const last = f ?? colon
    const kids: TsNode[] = [cond, q]
    if (t) kids.push(t)
    kids.push(colon)
    if (f) kids.push(f)
    return mk(P, 'ternary_expression', cond.startIndex, last.endIndex, kids)
  }
  return cond
}

/** Scan next arithmetic binary operator; returns [text, length] or null. */
export function scanArithOp(P: ParseState): [string, number] | null {
  const c = peek(P.L)
  const c1 = peek(P.L, 1)
  const c2 = peek(P.L, 2)
  // 3-char: <<= >>=
  if (c === '<' && c1 === '<' && c2 === '=') return ['<<=', 3]
  if (c === '>' && c1 === '>' && c2 === '=') return ['>>=', 3]
  // 2-char
  if (c === '*' && c1 === '*') return ['**', 2]
  if (c === '<' && c1 === '<') return ['<<', 2]
  if (c === '>' && c1 === '>') return ['>>', 2]
  if (c === '=' && c1 === '=') return ['==', 2]
  if (c === '!' && c1 === '=') return ['!=', 2]
  if (c === '<' && c1 === '=') return ['<=', 2]
  if (c === '>' && c1 === '=') return ['>=', 2]
  if (c === '&' && c1 === '&') return ['&&', 2]
  if (c === '|' && c1 === '|') return ['||', 2]
  if (c === '+' && c1 === '=') return ['+=', 2]
  if (c === '-' && c1 === '=') return ['-=', 2]
  if (c === '*' && c1 === '=') return ['*=', 2]
  if (c === '/' && c1 === '=') return ['/=', 2]
  if (c === '%' && c1 === '=') return ['%=', 2]
  if (c === '&' && c1 === '=') return ['&=', 2]
  if (c === '^' && c1 === '=') return ['^=', 2]
  if (c === '|' && c1 === '=') return ['|=', 2]
  // 1-char — but NOT ++ -- (those are pre/postfix)
  if (c === '+' && c1 !== '+') return ['+', 1]
  if (c === '-' && c1 !== '-') return ['-', 1]
  if (c === '*') return ['*', 1]
  if (c === '/') return ['/', 1]
  if (c === '%') return ['%', 1]
  if (c === '<') return ['<', 1]
  if (c === '>') return ['>', 1]
  if (c === '&') return ['&', 1]
  if (c === '|') return ['|', 1]
  if (c === '^') return ['^', 1]
  if (c === '=') return ['=', 1]
  return null
}

/** Precedence-climbing binary expression parser. */
export function parseArithBinary(
  P: ParseState,
  stop: string,
  minPrec: number,
  mode: ArithMode,
): TsNode | null {
  let left = parseArithUnary(P, stop, mode)
  if (!left) return null
  while (true) {
    skipBlanks(P.L)
    if (isArithStop(P, stop)) break
    if (peek(P.L) === ',') break
    const opInfo = scanArithOp(P)
    if (!opInfo) break
    const [opText, opLen] = opInfo
    const prec = ARITH_PREC[opText]
    if (prec === undefined || prec < minPrec) break
    const os = P.L.b
    for (let k = 0; k < opLen; k++) advance(P.L)
    const op = mk(P, opText, os, P.L.b, [])
    const nextMin = ARITH_RIGHT_ASSOC.has(opText) ? prec : prec + 1
    const right = parseArithBinary(P, stop, nextMin, mode)
    if (!right) break
    left = mk(P, 'binary_expression', left.startIndex, right.endIndex, [
      left,
      op,
      right,
    ])
  }
  return left
}

export function parseArithUnary(
  P: ParseState,
  stop: string,
  mode: ArithMode,
): TsNode | null {
  skipBlanks(P.L)
  if (isArithStop(P, stop)) return null
  const c = peek(P.L)
  const c1 = peek(P.L, 1)
  // Prefix ++ --
  if ((c === '+' && c1 === '+') || (c === '-' && c1 === '-')) {
    const s = P.L.b
    advance(P.L)
    advance(P.L)
    const op = mk(P, c + c1, s, P.L.b, [])
    const inner = parseArithUnary(P, stop, mode)
    if (!inner) return op
    return mk(P, 'unary_expression', op.startIndex, inner.endIndex, [op, inner])
  }
  if (c === '-' || c === '+' || c === '!' || c === '~') {
    // In 'word'/'assign' mode (c-style for head), `-N` is a single number
    // literal per tree-sitter, not unary_expression. 'var' mode uses unary.
    if (mode !== 'var' && c === '-' && isDigit(c1)) {
      const s = P.L.b
      advance(P.L)
      while (isDigit(peek(P.L))) advance(P.L)
      return mk(P, 'number', s, P.L.b, [])
    }
    const s = P.L.b
    advance(P.L)
    const op = mk(P, c, s, P.L.b, [])
    const inner = parseArithUnary(P, stop, mode)
    if (!inner) return op
    return mk(P, 'unary_expression', op.startIndex, inner.endIndex, [op, inner])
  }
  return parseArithPostfix(P, stop, mode)
}

export function parseArithPostfix(
  P: ParseState,
  stop: string,
  mode: ArithMode,
): TsNode | null {
  const prim = parseArithPrimary(P, stop, mode)
  if (!prim) return null
  const c = peek(P.L)
  const c1 = peek(P.L, 1)
  if ((c === '+' && c1 === '+') || (c === '-' && c1 === '-')) {
    const s = P.L.b
    advance(P.L)
    advance(P.L)
    const op = mk(P, c + c1, s, P.L.b, [])
    return mk(P, 'postfix_expression', prim.startIndex, op.endIndex, [prim, op])
  }
  return prim
}

export function parseArithPrimary(
  P: ParseState,
  stop: string,
  mode: ArithMode,
): TsNode | null {
  skipBlanks(P.L)
  if (isArithStop(P, stop)) return null
  const c = peek(P.L)
  if (c === '(') {
    const s = P.L.b
    advance(P.L)
    const open = mk(P, '(', s, P.L.b, [])
    // Parenthesized expression may contain comma-separated exprs
    const inners = parseArithCommaList(P, ')', mode)
    skipBlanks(P.L)
    let close: TsNode
    if (peek(P.L) === ')') {
      const cs = P.L.b
      advance(P.L)
      close = mk(P, ')', cs, P.L.b, [])
    } else {
      close = mk(P, ')', P.L.b, P.L.b, [])
    }
    return mk(P, 'parenthesized_expression', open.startIndex, close.endIndex, [
      open,
      ...inners,
      close,
    ])
  }
  if (c === '"') {
    return parseDoubleQuoted(P)
  }
  if (c === '$') {
    return parseDollarLike(P)
  }
  if (isDigit(c)) {
    const s = P.L.b
    while (isDigit(peek(P.L))) advance(P.L)
    // Hex: 0x1f
    if (
      P.L.b - s === 1 &&
      c === '0' &&
      (peek(P.L) === 'x' || peek(P.L) === 'X')
    ) {
      advance(P.L)
      while (isHexDigit(peek(P.L))) advance(P.L)
    }
    // Base notation: BASE#DIGITS e.g. 2#1010, 16#ff
    else if (peek(P.L) === '#') {
      advance(P.L)
      while (isBaseDigit(peek(P.L))) advance(P.L)
    }
    return mk(P, 'number', s, P.L.b, [])
  }
  if (isIdentStart(c)) {
    const s = P.L.b
    while (isIdentChar(peek(P.L))) advance(P.L)
    const nc = peek(P.L)
    // Assignment in 'assign' mode (c-style for init): emit variable_assignment
    // so chained `a = b = c = 1` nests correctly. Other modes treat `=` as a
    // binary_expression operator via the precedence table.
    if (mode === 'assign') {
      skipBlanks(P.L)
      const ac = peek(P.L)
      const ac1 = peek(P.L, 1)
      if (ac === '=' && ac1 !== '=') {
        const vn = mk(P, 'variable_name', s, P.L.b, [])
        const es = P.L.b
        advance(P.L)
        const eq = mk(P, '=', es, P.L.b, [])
        // RHS may itself be another assignment (chained)
        const val = parseArithTernary(P, stop, mode)
        const end = val ? val.endIndex : eq.endIndex
        const kids = val ? [vn, eq, val] : [vn, eq]
        return mk(P, 'variable_assignment', s, end, kids)
      }
    }
    // Subscript
    if (nc === '[') {
      const vn = mk(P, 'variable_name', s, P.L.b, [])
      const brS = P.L.b
      advance(P.L)
      const brOpen = mk(P, '[', brS, P.L.b, [])
      const idx = parseArithTernary(P, ']', 'var') ?? parseDollarLike(P)
      skipBlanks(P.L)
      let brClose: TsNode
      if (peek(P.L) === ']') {
        const cs = P.L.b
        advance(P.L)
        brClose = mk(P, ']', cs, P.L.b, [])
      } else {
        brClose = mk(P, ']', P.L.b, P.L.b, [])
      }
      const kids = idx ? [vn, brOpen, idx, brClose] : [vn, brOpen, brClose]
      return mk(P, 'subscript', s, brClose.endIndex, kids)
    }
    // Bare identifier: variable_name in 'var' mode, word in 'word'/'assign' mode.
    // 'assign' mode falls through to word when no `=` follows (c-style for
    // cond/update clauses: `c<=5` → binary_expression(word, number)).
    const identType = mode === 'var' ? 'variable_name' : 'word'
    return mk(P, identType, s, P.L.b, [])
  }
  return null
}

export function isArithStop(P: ParseState, stop: string): boolean {
  const c = peek(P.L)
  if (stop === '))') return c === ')' && peek(P.L, 1) === ')'
  if (stop === ')') return c === ')'
  if (stop === ';') return c === ';'
  if (stop === ':') return c === ':'
  if (stop === ']') return c === ']'
  if (stop === '}') return c === '}'
  if (stop === ':}') return c === ':' || c === '}'
  return c === '' || c === '\n'
}
