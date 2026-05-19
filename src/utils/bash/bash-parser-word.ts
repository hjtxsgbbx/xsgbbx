/**
 * Bash parser word-level parsing: words, expansions, heredocs, redirects.
 *
 * Handles word tokenization (parseWord, parseBareWord), brace expressions,
 * string parsing (parseDoubleQuoted), dollar expansions (parseDollarLike,
 * parseExpansionBody), redirects (tryParseRedirect, maybeRedirect),
 * heredocs (scanHeredocBodies, parseHeredocBodyContent), and assignments.
 * Imports types from ./bash-tokenizer.js and core parse infrastructure
 * from ./bash-parser-core.js.
 */

import type { TsNode, Token, Lexer, HeredocPending } from './bash-tokenizer.js'
import { advance, peek, nextToken, skipBlanks, byteAt, isWordChar, isWordStart, isIdentStart, isIdentChar, isDigit, isHexDigit, isHeredocDelimChar, SPECIAL_VARS } from './bash-tokenizer.js'
import type { ParseState } from './bash-parser-core.js'
import { mk, leaf, checkBudget, sliceBytes, saveLex, restoreLex, parseCommand, parseStatements } from './bash-parser-core.js'
import { parseBacktick, parseArithExpr, parseArithCommaList, parseExpansionRest, parseExpansionRegexSegmented } from './bash-parser-ctrl.js'

export function maybeRedirect(
  P: ParseState,
  node: TsNode,
  allowHerestring = false,
): TsNode {
  const redirects: TsNode[] = []
  while (true) {
    skipBlanks(P.L)
    const save = saveLex(P.L)
    const r = tryParseRedirect(P)
    if (!r) break
    if (r.type === 'herestring_redirect' && !allowHerestring) {
      restoreLex(P.L, save)
      break
    }
    redirects.push(r)
  }
  if (redirects.length === 0) return node
  const last = redirects[redirects.length - 1]!
  return mk(P, 'redirected_statement', node.startIndex, last.endIndex, [
    node,
    ...redirects,
  ])
}

export function tryParseAssignment(P: ParseState): TsNode | null {
  const save = saveLex(P.L)
  skipBlanks(P.L)
  const startB = P.L.b
  // Must start with identifier
  if (!isIdentStart(peek(P.L))) {
    restoreLex(P.L, save)
    return null
  }
  while (isIdentChar(peek(P.L))) advance(P.L)
  const nameEnd = P.L.b
  // Optional subscript
  let subEnd = nameEnd
  if (peek(P.L) === '[') {
    advance(P.L)
    let depth = 1
    while (P.L.i < P.L.len && depth > 0) {
      const c = peek(P.L)
      if (c === '[') depth++
      else if (c === ']') depth--
      advance(P.L)
    }
    subEnd = P.L.b
  }
  const c = peek(P.L)
  const c1 = peek(P.L, 1)
  let op: string
  if (c === '=' && c1 !== '=') {
    op = '='
  } else if (c === '+' && c1 === '=') {
    op = '+='
  } else {
    restoreLex(P.L, save)
    return null
  }
  const nameNode = mk(P, 'variable_name', startB, nameEnd, [])
  // Subscript handling: wrap in subscript node if present
  let lhs: TsNode = nameNode
  if (subEnd > nameEnd) {
    const brOpen = mk(P, '[', nameEnd, nameEnd + 1, [])
    const idx = parseSubscriptIndex(P, nameEnd + 1, subEnd - 1)
    const brClose = mk(P, ']', subEnd - 1, subEnd, [])
    lhs = mk(P, 'subscript', startB, subEnd, [nameNode, brOpen, idx, brClose])
  }
  const opStart = P.L.b
  advance(P.L)
  if (op === '+=') advance(P.L)
  const opEnd = P.L.b
  const opNode = mk(P, op, opStart, opEnd, [])
  let val: TsNode | null = null
  if (peek(P.L) === '(') {
    // Array
    const aoTok = nextToken(P.L, 'cmd')
    const aOpen = leaf(P, '(', aoTok)
    const elems: TsNode[] = [aOpen]
    while (true) {
      skipBlanks(P.L)
      if (peek(P.L) === ')') break
      const e = parseWord(P, 'arg')
      if (!e) break
      elems.push(e)
    }
    const acTok = nextToken(P.L, 'cmd')
    const aClose =
      acTok.value === ')'
        ? leaf(P, ')', acTok)
        : mk(P, ')', aOpen.endIndex, aOpen.endIndex, [])
    elems.push(aClose)
    val = mk(P, 'array', aOpen.startIndex, aClose.endIndex, elems)
  } else {
    const c2 = peek(P.L)
    if (
      c2 &&
      c2 !== ' ' &&
      c2 !== '\t' &&
      c2 !== '\n' &&
      c2 !== ';' &&
      c2 !== '&' &&
      c2 !== '|' &&
      c2 !== ')' &&
      c2 !== '}'
    ) {
      val = parseWord(P, 'arg')
    }
  }
  const kids = val ? [lhs, opNode, val] : [lhs, opNode]
  const end = val ? val.endIndex : opEnd
  return mk(P, 'variable_assignment', startB, end, kids)
}

/**
 * Parse subscript index content. Parsed arithmetically per tree-sitter grammar:
 * `${a[1+2]}` → binary_expression; `${a[++i]}` → unary_expression(word);
 * `${a[(($n+1))]}` → compound_statement(binary_expression). Falls back to
 * simple patterns (@, *) as word.
 */
export function parseSubscriptIndexInline(P: ParseState): TsNode | null {
  skipBlanks(P.L)
  const c = peek(P.L)
  // @ or * alone → word (associative array all-keys)
  if ((c === '@' || c === '*') && peek(P.L, 1) === ']') {
    const s = P.L.b
    advance(P.L)
    return mk(P, 'word', s, P.L.b, [])
  }
  // ((expr)) → compound_statement wrapping the inner arithmetic
  if (c === '(' && peek(P.L, 1) === '(') {
    const oStart = P.L.b
    advance(P.L)
    advance(P.L)
    const open = mk(P, '((', oStart, P.L.b, [])
    const inner = parseArithExpr(P, '))', 'var')
    skipBlanks(P.L)
    let close: TsNode
    if (peek(P.L) === ')' && peek(P.L, 1) === ')') {
      const cs = P.L.b
      advance(P.L)
      advance(P.L)
      close = mk(P, '))', cs, P.L.b, [])
    } else {
      close = mk(P, '))', P.L.b, P.L.b, [])
    }
    const kids = inner ? [open, inner, close] : [open, close]
    return mk(P, 'compound_statement', open.startIndex, close.endIndex, kids)
  }
  // Arithmetic — but bare identifiers in subscript use 'word' mode per
  // tree-sitter (${words[++counter]} → unary_expression(word)).
  return parseArithExpr(P, ']', 'word')
}

/** Legacy byte-range subscript index parser — kept for callers that pre-scan. */
export function parseSubscriptIndex(
  P: ParseState,
  startB: number,
  endB: number,
): TsNode {
  const text = sliceBytes(P, startB, endB)
  if (/^\d+$/.test(text)) return mk(P, 'number', startB, endB, [])
  const m = /^\$([a-zA-Z_]\w*)$/.exec(text)
  if (m) {
    const dollar = mk(P, '$', startB, startB + 1, [])
    const vn = mk(P, 'variable_name', startB + 1, endB, [])
    return mk(P, 'simple_expansion', startB, endB, [dollar, vn])
  }
  if (text.length === 2 && text[0] === '$' && SPECIAL_VARS.has(text[1]!)) {
    const dollar = mk(P, '$', startB, startB + 1, [])
    const vn = mk(P, 'special_variable_name', startB + 1, endB, [])
    return mk(P, 'simple_expansion', startB, endB, [dollar, vn])
  }
  return mk(P, 'word', startB, endB, [])
}

/**
 * Can the current position start a redirect destination literal?
 * Returns false at redirect ops, terminators, or file-descriptor-prefixed ops
 * so file_redirect's repeat1($._literal) stops at the right boundary.
 */
export function isRedirectLiteralStart(P: ParseState): boolean {
  const c = peek(P.L)
  if (c === '' || c === '\n') return false
  // Shell terminators and operators
  if (c === '|' || c === '&' || c === ';' || c === '(' || c === ')')
    return false
  // Redirect operators (< > with any suffix; <( >( handled by caller)
  if (c === '<' || c === '>') {
    // <( >( are process substitutions — those ARE literals
    return peek(P.L, 1) === '('
  }
  // N< N> file descriptor prefix — starts a new redirect, not a literal
  if (isDigit(c)) {
    let j = P.L.i
    while (j < P.L.len && isDigit(P.L.src[j]!)) j++
    const after = j < P.L.len ? P.L.src[j]! : ''
    if (after === '>' || after === '<') return false
  }
  // `}` only terminates if we're in a context where it's a closer — but
  // file_redirect sees `}` as word char (e.g., `>$HOME}` is valid path char).
  // Actually `}` at top level terminates compound_statement — need to stop.
  if (c === '}') return false
  // Test command closer — when parseSimpleCommand is called from `[` context,
  // `]` must terminate so parseCommand can return and `[` handler consume it.
  if (P.stopToken === ']' && c === ']') return false
  return true
}

/**
 * Parse a redirect operator + destination(s).
 * @param greedy When true, file_redirect consumes repeat1($._literal) per
 *   grammar's prec.left — `cmd >f a b c` attaches `a b c` to the redirect.
 *   When false (preRedirect context), takes only 1 destination because
 *   command's dynamic precedence beats redirected_statement's prec(-1).
 */
export function tryParseRedirect(P: ParseState, greedy = false): TsNode | null {
  const save = saveLex(P.L)
  skipBlanks(P.L)
  // File descriptor prefix?
  let fd: TsNode | null = null
  if (isDigit(peek(P.L))) {
    const startB = P.L.b
    let j = P.L.i
    while (j < P.L.len && isDigit(P.L.src[j]!)) j++
    const after = j < P.L.len ? P.L.src[j]! : ''
    if (after === '>' || after === '<') {
      while (P.L.i < j) advance(P.L)
      fd = mk(P, 'file_descriptor', startB, P.L.b, [])
    }
  }
  const t = nextToken(P.L, 'arg')
  if (t.type !== 'OP') {
    restoreLex(P.L, save)
    return null
  }
  const v = t.value
  if (v === '<<<') {
    const op = leaf(P, '<<<', t)
    skipBlanks(P.L)
    const target = parseWord(P, 'arg')
    const end = target ? target.endIndex : op.endIndex
    const kids = target ? [op, target] : [op]
    return mk(
      P,
      'herestring_redirect',
      fd ? fd.startIndex : op.startIndex,
      end,
      fd ? [fd, ...kids] : kids,
    )
  }
  if (v === '<<' || v === '<<-') {
    const op = leaf(P, v, t)
    // Heredoc start — delimiter word (may be quoted)
    skipBlanks(P.L)
    const dStart = P.L.b
    let quoted = false
    let delim = ''
    const dc = peek(P.L)
    if (dc === "'" || dc === '"') {
      quoted = true
      advance(P.L)
      while (P.L.i < P.L.len && peek(P.L) !== dc) {
        delim += peek(P.L)
        advance(P.L)
      }
      if (P.L.i < P.L.len) advance(P.L)
    } else if (dc === '\\') {
      // Backslash-escaped delimiter: \X — exactly one escaped char, body is
      // quoted (literal). Covers <<\EOF <<\' <<\\ etc.
      quoted = true
      advance(P.L)
      if (P.L.i < P.L.len && peek(P.L) !== '\n') {
        delim += peek(P.L)
        advance(P.L)
      }
      // May be followed by more ident chars (e.g. <<\EOF → delim "EOF")
      while (P.L.i < P.L.len && isIdentChar(peek(P.L))) {
        delim += peek(P.L)
        advance(P.L)
      }
    } else {
      // Unquoted delimiter: bash accepts most non-metacharacters (not just
      // identifiers). Allow !, -, ., etc. — stop at shell metachars.
      while (P.L.i < P.L.len && isHeredocDelimChar(peek(P.L))) {
        delim += peek(P.L)
        advance(P.L)
      }
    }
    const dEnd = P.L.b
    const startNode = mk(P, 'heredoc_start', dStart, dEnd, [])
    // Register pending heredoc — body scanned at next newline
    P.L.heredocs.push({
      delim,
      stripTabs: v === '<<-',
      quoted,
      bodyStart: 0,
      bodyEnd: 0,
      endStart: 0,
      endEnd: 0,
    })
    const kids = fd ? [fd, op, startNode] : [op, startNode]
    const startIdx = fd ? fd.startIndex : op.startIndex
    // SECURITY: tree-sitter nests any pipeline/list/file_redirect appearing
    // between heredoc_start and the newline as a CHILD of heredoc_redirect.
    // `ls <<'EOF' | rm -rf /tmp/evil` must not silently drop the rm. Parse
    // trailing words and file_redirects properly (ast.ts walkHeredocRedirect
    // fails closed on any unrecognized child via tooComplex). Pipeline / list
    // operators (| && || ;) are structurally complex — emit ERROR so the same
    // fail-closed path rejects them.
    while (true) {
      skipBlanks(P.L)
      const tc = peek(P.L)
      if (tc === '\n' || tc === '' || P.L.i >= P.L.len) break
      // File redirect after delimiter: cat <<EOF > out.txt
      if (tc === '>' || tc === '<' || isDigit(tc)) {
        const rSave = saveLex(P.L)
        const r = tryParseRedirect(P)
        if (r && r.type === 'file_redirect') {
          kids.push(r)
          continue
        }
        restoreLex(P.L, rSave)
      }
      // Pipeline after heredoc_start: `one <<EOF | grep two` — tree-sitter
      // nests the pipeline as a child of heredoc_redirect. ast.ts
      // walkHeredocRedirect fails closed on pipeline/command via tooComplex.
      if (tc === '|' && peek(P.L, 1) !== '|') {
        advance(P.L)
        skipBlanks(P.L)
        const pipeCmds: TsNode[] = []
        while (true) {
          const cmd = parseCommand(P)
          if (!cmd) break
          pipeCmds.push(cmd)
          skipBlanks(P.L)
          if (peek(P.L) === '|' && peek(P.L, 1) !== '|') {
            const ps = P.L.b
            advance(P.L)
            pipeCmds.push(mk(P, '|', ps, P.L.b, []))
            skipBlanks(P.L)
            continue
          }
          break
        }
        if (pipeCmds.length > 0) {
          const pl = pipeCmds[pipeCmds.length - 1]!
          // tree-sitter always wraps in pipeline after `|`, even single command
          kids.push(
            mk(P, 'pipeline', pipeCmds[0]!.startIndex, pl.endIndex, pipeCmds),
          )
        }
        continue
      }
      // && / || after heredoc_start: `cat <<-EOF || die "..."` — tree-sitter
      // nests just the RHS command (not a list) as a child of heredoc_redirect.
      if (
        (tc === '&' && peek(P.L, 1) === '&') ||
        (tc === '|' && peek(P.L, 1) === '|')
      ) {
        advance(P.L)
        advance(P.L)
        skipBlanks(P.L)
        const rhs = parseCommand(P)
        if (rhs) kids.push(rhs)
        continue
      }
      // Terminator / unhandled metachar — consume rest of line as ERROR so
      // ast.ts rejects it. Covers ; & ( )
      if (tc === '&' || tc === ';' || tc === '(' || tc === ')') {
        const eStart = P.L.b
        while (P.L.i < P.L.len && peek(P.L) !== '\n') advance(P.L)
        kids.push(mk(P, 'ERROR', eStart, P.L.b, []))
        break
      }
      // Trailing word argument: newins <<-EOF - org.freedesktop.service
      const w = parseWord(P, 'arg')
      if (w) {
        kids.push(w)
        continue
      }
      // Unrecognized — consume rest of line as ERROR
      const eStart = P.L.b
      while (P.L.i < P.L.len && peek(P.L) !== '\n') advance(P.L)
      if (P.L.b > eStart) kids.push(mk(P, 'ERROR', eStart, P.L.b, []))
      break
    }
    return mk(P, 'heredoc_redirect', startIdx, P.L.b, kids)
  }
  // Close-fd variants: `<&-` `>&-` have OPTIONAL destination (0 or 1)
  if (v === '<&-' || v === '>&-') {
    const op = leaf(P, v, t)
    const kids: TsNode[] = []
    if (fd) kids.push(fd)
    kids.push(op)
    // Optional single destination — only consume if next is a literal
    skipBlanks(P.L)
    const dSave = saveLex(P.L)
    const dest = isRedirectLiteralStart(P) ? parseWord(P, 'arg') : null
    if (dest) {
      kids.push(dest)
    } else {
      restoreLex(P.L, dSave)
    }
    const startIdx = fd ? fd.startIndex : op.startIndex
    const end = dest ? dest.endIndex : op.endIndex
    return mk(P, 'file_redirect', startIdx, end, kids)
  }
  if (
    v === '>' ||
    v === '>>' ||
    v === '>&' ||
    v === '>|' ||
    v === '&>' ||
    v === '&>>' ||
    v === '<' ||
    v === '<&'
  ) {
    const op = leaf(P, v, t)
    const kids: TsNode[] = []
    if (fd) kids.push(fd)
    kids.push(op)
    // Grammar: destination is repeat1($._literal) — greedily consume literals
    // until a non-literal (redirect op, terminator, etc). tree-sitter's
    // prec.left makes `cmd >f a b c` attach `a b c` to the file_redirect,
    // NOT to the command. Structural quirk but required for corpus parity.
    // In preRedirect context (greedy=false), take only 1 literal because
    // command's dynamic precedence beats redirected_statement's prec(-1).
    let end = op.endIndex
    let taken = 0
    while (true) {
      skipBlanks(P.L)
      if (!isRedirectLiteralStart(P)) break
      if (!greedy && taken >= 1) break
      const tc = peek(P.L)
      const tc1 = peek(P.L, 1)
      let target: TsNode | null = null
      if ((tc === '<' || tc === '>') && tc1 === '(') {
        target = parseProcessSub(P)
      } else {
        target = parseWord(P, 'arg')
      }
      if (!target) break
      kids.push(target)
      end = target.endIndex
      taken++
    }
    const startIdx = fd ? fd.startIndex : op.startIndex
    return mk(P, 'file_redirect', startIdx, end, kids)
  }
  restoreLex(P.L, save)
  return null
}

export function parseProcessSub(P: ParseState): TsNode | null {
  const c = peek(P.L)
  if ((c !== '<' && c !== '>') || peek(P.L, 1) !== '(') return null
  const start = P.L.b
  advance(P.L)
  advance(P.L)
  const open = mk(P, c + '(', start, P.L.b, [])
  const body = parseStatements(P, ')')
  skipBlanks(P.L)
  let close: TsNode
  if (peek(P.L) === ')') {
    const cs = P.L.b
    advance(P.L)
    close = mk(P, ')', cs, P.L.b, [])
  } else {
    close = mk(P, ')', P.L.b, P.L.b, [])
  }
  return mk(P, 'process_substitution', start, close.endIndex, [
    open,
    ...body,
    close,
  ])
}

export function scanHeredocBodies(P: ParseState): void {
  // Skip to newline if not already there
  while (P.L.i < P.L.len && P.L.src[P.L.i] !== '\n') advance(P.L)
  if (P.L.i < P.L.len) advance(P.L)
  for (const hd of P.L.heredocs) {
    hd.bodyStart = P.L.b
    const delimLen = hd.delim.length
    while (P.L.i < P.L.len) {
      const lineStart = P.L.i
      const lineStartB = P.L.b
      // Skip leading tabs if <<-
      let checkI = lineStart
      if (hd.stripTabs) {
        while (checkI < P.L.len && P.L.src[checkI] === '\t') checkI++
      }
      // Check if this line is the delimiter
      if (
        P.L.src.startsWith(hd.delim, checkI) &&
        (checkI + delimLen >= P.L.len ||
          P.L.src[checkI + delimLen] === '\n' ||
          P.L.src[checkI + delimLen] === '\r')
      ) {
        hd.bodyEnd = lineStartB
        // Advance past tabs
        while (P.L.i < checkI) advance(P.L)
        hd.endStart = P.L.b
        // Advance past delimiter
        for (let k = 0; k < delimLen; k++) advance(P.L)
        hd.endEnd = P.L.b
        // Skip trailing newline
        if (P.L.i < P.L.len && P.L.src[P.L.i] === '\n') advance(P.L)
        return
      }
      // Consume line
      while (P.L.i < P.L.len && P.L.src[P.L.i] !== '\n') advance(P.L)
      if (P.L.i < P.L.len) advance(P.L)
    }
    // Unterminated
    hd.bodyEnd = P.L.b
    hd.endStart = P.L.b
    hd.endEnd = P.L.b
  }
}

export function parseHeredocBodyContent(
  P: ParseState,
  start: number,
  end: number,
): TsNode[] {
  // Parse expansions inside an unquoted heredoc body.
  const saved = saveLex(P.L)
  // Position lexer at body start
  restoreLexToByte(P, start)
  const out: TsNode[] = []
  let contentStart = P.L.b
  // tree-sitter-bash's heredoc_body rule hides the initial text segment
  // (_heredoc_body_beginning) — only content AFTER the first expansion is
  // emitted as heredoc_content. Track whether we've seen an expansion yet.
  let sawExpansion = false
  while (P.L.b < end) {
    const c = peek(P.L)
    // Backslash escapes suppress expansion: \$ \` stay literal in heredoc.
    if (c === '\\') {
      const nxt = peek(P.L, 1)
      if (nxt === '$' || nxt === '`' || nxt === '\\') {
        advance(P.L)
        advance(P.L)
        continue
      }
      advance(P.L)
      continue
    }
    if (c === '$' || c === '`') {
      const preB = P.L.b
      const exp = parseDollarLike(P)
      // Bare `$` followed by non-name (e.g. `$'` in a regex) returns a lone
      // '$' leaf, not an expansion — treat as literal content, don't split.
      if (
        exp &&
        (exp.type === 'simple_expansion' ||
          exp.type === 'expansion' ||
          exp.type === 'command_substitution' ||
          exp.type === 'arithmetic_expansion')
      ) {
        if (sawExpansion && preB > contentStart) {
          out.push(mk(P, 'heredoc_content', contentStart, preB, []))
        }
        out.push(exp)
        contentStart = P.L.b
        sawExpansion = true
      }
      continue
    }
    advance(P.L)
  }
  // Only emit heredoc_content children if there were expansions — otherwise
  // the heredoc_body is a leaf node (tree-sitter convention).
  if (sawExpansion) {
    out.push(mk(P, 'heredoc_content', contentStart, end, []))
  }
  restoreLex(P.L, saved)
  return out
}

export function restoreLexToByte(P: ParseState, targetByte: number): void {
  if (!P.L.byteTable) byteAt(P.L, 0)
  const t = P.L.byteTable!
  let lo = 0
  let hi = P.src.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (t[m]! < targetByte) lo = m + 1
    else hi = m
  }
  P.L.i = lo
  P.L.b = targetByte
}

/**
 * Parse a word-position element: bare word, string, expansion, or concatenation
 * thereof. Returns a single node; if multiple adjacent fragments, wraps in
 * concatenation.
 */
export function parseWord(P: ParseState, _ctx: 'cmd' | 'arg'): TsNode | null {
  skipBlanks(P.L)
  const parts: TsNode[] = []
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (
      c === ' ' ||
      c === '\t' ||
      c === '\n' ||
      c === '\r' ||
      c === '' ||
      c === '|' ||
      c === '&' ||
      c === ';' ||
      c === '(' ||
      c === ')'
    ) {
      break
    }
    // < > are redirect operators unless <( >( (process substitution)
    if (c === '<' || c === '>') {
      if (peek(P.L, 1) === '(') {
        const ps = parseProcessSub(P)
        if (ps) parts.push(ps)
        continue
      }
      break
    }
    if (c === '"') {
      parts.push(parseDoubleQuoted(P))
      continue
    }
    if (c === "'") {
      const tok = nextToken(P.L, 'arg')
      parts.push(leaf(P, 'raw_string', tok))
      continue
    }
    if (c === '$') {
      const c1 = peek(P.L, 1)
      if (c1 === "'") {
        const tok = nextToken(P.L, 'arg')
        parts.push(leaf(P, 'ansi_c_string', tok))
        continue
      }
      if (c1 === '"') {
        // Translated string: emit $ leaf + string node
        const dTok: Token = {
          type: 'DOLLAR',
          value: '$',
          start: P.L.b,
          end: P.L.b + 1,
        }
        advance(P.L)
        parts.push(leaf(P, '$', dTok))
        parts.push(parseDoubleQuoted(P))
        continue
      }
      if (c1 === '`') {
        // `$` followed by backtick — tree-sitter elides the $ entirely
        // and emits just (command_substitution). Consume $ and let next
        // iteration handle the backtick.
        advance(P.L)
        continue
      }
      const exp = parseDollarLike(P)
      if (exp) parts.push(exp)
      continue
    }
    if (c === '`') {
      if (P.inBacktick > 0) break
      const bt = parseBacktick(P)
      if (bt) parts.push(bt)
      continue
    }
    // Brace expression {1..5} or {a,b,c} — only if looks like one
    if (c === '{') {
      const be = tryParseBraceExpr(P)
      if (be) {
        parts.push(be)
        continue
      }
      // SECURITY: if `{` is immediately followed by a command terminator
      // (; | & newline or EOF), it's a standalone word — don't slurp the
      // rest of the line via tryParseBraceLikeCat. `echo {;touch /tmp/evil`
      // must split on `;` so the security walker sees `touch`.
      const nc = peek(P.L, 1)
      if (
        nc === ';' ||
        nc === '|' ||
        nc === '&' ||
        nc === '\n' ||
        nc === '' ||
        nc === ')' ||
        nc === ' ' ||
        nc === '\t'
      ) {
        const bStart = P.L.b
        advance(P.L)
        parts.push(mk(P, 'word', bStart, P.L.b, []))
        continue
      }
      // Otherwise treat { and } as word fragments
      const cat = tryParseBraceLikeCat(P)
      if (cat) {
        for (const p of cat) parts.push(p)
        continue
      }
    }
    // Standalone `}` in arg position is a word (e.g., `echo }foo`).
    // parseBareWord breaks on `}` so handle it here.
    if (c === '}') {
      const bStart = P.L.b
      advance(P.L)
      parts.push(mk(P, 'word', bStart, P.L.b, []))
      continue
    }
    // `[` and `]` are single-char word fragments (tree-sitter splits at
    // brackets: `[:lower:]` → `[` `:lower:` `]`, `{o[k]}` → 6 words).
    if (c === '[' || c === ']') {
      const bStart = P.L.b
      advance(P.L)
      parts.push(mk(P, 'word', bStart, P.L.b, []))
      continue
    }
    // Bare word fragment
    const frag = parseBareWord(P)
    if (!frag) break
    // `NN#${...}` or `NN#$(...)` → (number (expansion|command_substitution)).
    // Grammar: number can be seq(/-?(0x)?[0-9]+#/, choice(expansion, cmd_sub)).
    // `10#${cmd}` must NOT be concatenation — it's a single number node with
    // the expansion as child. Detect here: frag ends with `#`, next is $ {/(.
    if (
      frag.type === 'word' &&
      /^-?(0x)?[0-9]+#$/.test(frag.text) &&
      peek(P.L) === '$' &&
      (peek(P.L, 1) === '{' || peek(P.L, 1) === '(')
    ) {
      const exp = parseDollarLike(P)
      if (exp) {
        // Prefix `NN#` is an anonymous pattern in grammar — only the
        // expansion/cmd_sub is a named child.
        parts.push(mk(P, 'number', frag.startIndex, exp.endIndex, [exp]))
        continue
      }
    }
    parts.push(frag)
  }
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]!
  // Concatenation
  const first = parts[0]!
  const last = parts[parts.length - 1]!
  return mk(P, 'concatenation', first.startIndex, last.endIndex, parts)
}

export function parseBareWord(P: ParseState): TsNode | null {
  const start = P.L.b
  const startI = P.L.i
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '\\') {
      if (P.L.i + 1 >= P.L.len) {
        // Trailing unpaired `\` at true EOF — tree-sitter emits word WITHOUT
        // the `\` plus a sibling ERROR node. Stop here; caller emits ERROR.
        break
      }
      const nx = P.L.src[P.L.i + 1]
      if (nx === '\n' || (nx === '\r' && P.L.src[P.L.i + 2] === '\n')) {
        // Line continuation BREAKS the word (tree-sitter quirk) — handles \r?\n
        break
      }
      advance(P.L)
      advance(P.L)
      continue
    }
    if (
      c === ' ' ||
      c === '\t' ||
      c === '\n' ||
      c === '\r' ||
      c === '' ||
      c === '|' ||
      c === '&' ||
      c === ';' ||
      c === '(' ||
      c === ')' ||
      c === '<' ||
      c === '>' ||
      c === '"' ||
      c === "'" ||
      c === '$' ||
      c === '`' ||
      c === '{' ||
      c === '}' ||
      c === '[' ||
      c === ']'
    ) {
      break
    }
    advance(P.L)
  }
  if (P.L.b === start) return null
  const text = P.src.slice(startI, P.L.i)
  const type = /^-?\d+$/.test(text) ? 'number' : 'word'
  return mk(P, type, start, P.L.b, [])
}

export function tryParseBraceExpr(P: ParseState): TsNode | null {
  // {N..M} where N, M are numbers or single chars
  const save = saveLex(P.L)
  if (peek(P.L) !== '{') return null
  const oStart = P.L.b
  advance(P.L)
  const oEnd = P.L.b
  // First part
  const p1Start = P.L.b
  while (isDigit(peek(P.L)) || isIdentStart(peek(P.L))) advance(P.L)
  const p1End = P.L.b
  if (p1End === p1Start || peek(P.L) !== '.' || peek(P.L, 1) !== '.') {
    restoreLex(P.L, save)
    return null
  }
  const dotStart = P.L.b
  advance(P.L)
  advance(P.L)
  const dotEnd = P.L.b
  const p2Start = P.L.b
  while (isDigit(peek(P.L)) || isIdentStart(peek(P.L))) advance(P.L)
  const p2End = P.L.b
  if (p2End === p2Start || peek(P.L) !== '}') {
    restoreLex(P.L, save)
    return null
  }
  const cStart = P.L.b
  advance(P.L)
  const cEnd = P.L.b
  const p1Text = sliceBytes(P, p1Start, p1End)
  const p2Text = sliceBytes(P, p2Start, p2End)
  const p1IsNum = /^\d+$/.test(p1Text)
  const p2IsNum = /^\d+$/.test(p2Text)
  // Valid brace expression: both numbers OR both single chars. Mixed = reject.
  if (p1IsNum !== p2IsNum) {
    restoreLex(P.L, save)
    return null
  }
  if (!p1IsNum && (p1Text.length !== 1 || p2Text.length !== 1)) {
    restoreLex(P.L, save)
    return null
  }
  const p1Type = p1IsNum ? 'number' : 'word'
  const p2Type = p2IsNum ? 'number' : 'word'
  return mk(P, 'brace_expression', oStart, cEnd, [
    mk(P, '{', oStart, oEnd, []),
    mk(P, p1Type, p1Start, p1End, []),
    mk(P, '..', dotStart, dotEnd, []),
    mk(P, p2Type, p2Start, p2End, []),
    mk(P, '}', cStart, cEnd, []),
  ])
}

export function tryParseBraceLikeCat(P: ParseState): TsNode[] | null {
  // {a,b,c} or {} → split into word fragments like tree-sitter does
  if (peek(P.L) !== '{') return null
  const oStart = P.L.b
  advance(P.L)
  const oEnd = P.L.b
  const inner: TsNode[] = [mk(P, 'word', oStart, oEnd, [])]
  while (P.L.i < P.L.len) {
    const bc = peek(P.L)
    // SECURITY: stop at command terminators so `{foo;rm x` splits correctly.
    if (
      bc === '}' ||
      bc === '\n' ||
      bc === ';' ||
      bc === '|' ||
      bc === '&' ||
      bc === ' ' ||
      bc === '\t' ||
      bc === '<' ||
      bc === '>' ||
      bc === '(' ||
      bc === ')'
    ) {
      break
    }
    // `[` and `]` are single-char words: {o[k]} → { o [ k ] }
    if (bc === '[' || bc === ']') {
      const bStart = P.L.b
      advance(P.L)
      inner.push(mk(P, 'word', bStart, P.L.b, []))
      continue
    }
    const midStart = P.L.b
    while (P.L.i < P.L.len) {
      const mc = peek(P.L)
      if (
        mc === '}' ||
        mc === '\n' ||
        mc === ';' ||
        mc === '|' ||
        mc === '&' ||
        mc === ' ' ||
        mc === '\t' ||
        mc === '<' ||
        mc === '>' ||
        mc === '(' ||
        mc === ')' ||
        mc === '[' ||
        mc === ']'
      ) {
        break
      }
      advance(P.L)
    }
    const midEnd = P.L.b
    if (midEnd > midStart) {
      const midText = sliceBytes(P, midStart, midEnd)
      const midType = /^-?\d+$/.test(midText) ? 'number' : 'word'
      inner.push(mk(P, midType, midStart, midEnd, []))
    } else {
      break
    }
  }
  if (peek(P.L) === '}') {
    const cStart = P.L.b
    advance(P.L)
    inner.push(mk(P, 'word', cStart, P.L.b, []))
  }
  return inner
}

export function parseDoubleQuoted(P: ParseState): TsNode {
  const qStart = P.L.b
  advance(P.L)
  const qEnd = P.L.b
  const openQ = mk(P, '"', qStart, qEnd, [])
  const parts: TsNode[] = [openQ]
  let contentStart = P.L.b
  let contentStartI = P.L.i
  const flushContent = (): void => {
    if (P.L.b > contentStart) {
      // Tree-sitter's extras rule /\s/ has higher precedence than
      // string_content (prec -1), so whitespace-only segments are elided.
      // `" ${x} "` → (string (expansion)) not (string (string_content)(expansion)(string_content)).
      // Note: this intentionally diverges from preserving all content — cc
      // tests relying on whitespace-only string_content need updating
      // (CCReconcile).
      const txt = P.src.slice(contentStartI, P.L.i)
      if (!/^[ \t]+$/.test(txt)) {
        parts.push(mk(P, 'string_content', contentStart, P.L.b, []))
      }
    }
  }
  while (P.L.i < P.L.len) {
    const c = peek(P.L)
    if (c === '"') break
    if (c === '\\' && P.L.i + 1 < P.L.len) {
      advance(P.L)
      advance(P.L)
      continue
    }
    if (c === '\n') {
      // Split string_content at newline
      flushContent()
      advance(P.L)
      contentStart = P.L.b
      contentStartI = P.L.i
      continue
    }
    if (c === '$') {
      const c1 = peek(P.L, 1)
      if (
        c1 === '(' ||
        c1 === '{' ||
        isIdentStart(c1) ||
        SPECIAL_VARS.has(c1) ||
        isDigit(c1)
      ) {
        flushContent()
        const exp = parseDollarLike(P)
        if (exp) parts.push(exp)
        contentStart = P.L.b
        contentStartI = P.L.i
        continue
      }
      // Bare $ not at end-of-string: tree-sitter emits it as an anonymous
      // '$' token, which splits string_content. $ immediately before the
      // closing " is absorbed into the preceding string_content.
      if (c1 !== '"' && c1 !== '') {
        flushContent()
        const dS = P.L.b
        advance(P.L)
        parts.push(mk(P, '$', dS, P.L.b, []))
        contentStart = P.L.b
        contentStartI = P.L.i
        continue
      }
    }
    if (c === '`') {
      flushContent()
      const bt = parseBacktick(P)
      if (bt) parts.push(bt)
      contentStart = P.L.b
      contentStartI = P.L.i
      continue
    }
    advance(P.L)
  }
  flushContent()
  let close: TsNode
  if (peek(P.L) === '"') {
    const cStart = P.L.b
    advance(P.L)
    close = mk(P, '"', cStart, P.L.b, [])
  } else {
    close = mk(P, '"', P.L.b, P.L.b, [])
  }
  parts.push(close)
  return mk(P, 'string', qStart, close.endIndex, parts)
}

export function parseDollarLike(P: ParseState): TsNode | null {
  const c1 = peek(P.L, 1)
  const dStart = P.L.b
  if (c1 === '(' && peek(P.L, 2) === '(') {
    // $(( arithmetic ))
    advance(P.L)
    advance(P.L)
    advance(P.L)
    const open = mk(P, '$((', dStart, P.L.b, [])
    const exprs = parseArithCommaList(P, '))', 'var')
    skipBlanks(P.L)
    let close: TsNode
    if (peek(P.L) === ')' && peek(P.L, 1) === ')') {
      const cStart = P.L.b
      advance(P.L)
      advance(P.L)
      close = mk(P, '))', cStart, P.L.b, [])
    } else {
      close = mk(P, '))', P.L.b, P.L.b, [])
    }
    return mk(P, 'arithmetic_expansion', dStart, close.endIndex, [
      open,
      ...exprs,
      close,
    ])
  }
  if (c1 === '[') {
    // $[ arithmetic ] — legacy bash syntax, same as $((...))
    advance(P.L)
    advance(P.L)
    const open = mk(P, '$[', dStart, P.L.b, [])
    const exprs = parseArithCommaList(P, ']', 'var')
    skipBlanks(P.L)
    let close: TsNode
    if (peek(P.L) === ']') {
      const cStart = P.L.b
      advance(P.L)
      close = mk(P, ']', cStart, P.L.b, [])
    } else {
      close = mk(P, ']', P.L.b, P.L.b, [])
    }
    return mk(P, 'arithmetic_expansion', dStart, close.endIndex, [
      open,
      ...exprs,
      close,
    ])
  }
  if (c1 === '(') {
    advance(P.L)
    advance(P.L)
    const open = mk(P, '$(', dStart, P.L.b, [])
    let body = parseStatements(P, ')')
    skipBlanks(P.L)
    let close: TsNode
    if (peek(P.L) === ')') {
      const cStart = P.L.b
      advance(P.L)
      close = mk(P, ')', cStart, P.L.b, [])
    } else {
      close = mk(P, ')', P.L.b, P.L.b, [])
    }
    // $(< file) shorthand: unwrap redirected_statement → bare file_redirect
    // tree-sitter emits (command_substitution (file_redirect (word))) directly
    if (
      body.length === 1 &&
      body[0]!.type === 'redirected_statement' &&
      body[0]!.children.length === 1 &&
      body[0]!.children[0]!.type === 'file_redirect'
    ) {
      body = body[0]!.children
    }
    return mk(P, 'command_substitution', dStart, close.endIndex, [
      open,
      ...body,
      close,
    ])
  }
  if (c1 === '{') {
    advance(P.L)
    advance(P.L)
    const open = mk(P, '${', dStart, P.L.b, [])
    const inner = parseExpansionBody(P)
    let close: TsNode
    if (peek(P.L) === '}') {
      const cStart = P.L.b
      advance(P.L)
      close = mk(P, '}', cStart, P.L.b, [])
    } else {
      close = mk(P, '}', P.L.b, P.L.b, [])
    }
    return mk(P, 'expansion', dStart, close.endIndex, [open, ...inner, close])
  }
  // Simple expansion $VAR or $? $$ $@ etc
  advance(P.L)
  const dEnd = P.L.b
  const dollar = mk(P, '$', dStart, dEnd, [])
  const nc = peek(P.L)
  // $_ is special_variable_name only when not followed by more ident chars
  if (nc === '_' && !isIdentChar(peek(P.L, 1))) {
    const vStart = P.L.b
    advance(P.L)
    const vn = mk(P, 'special_variable_name', vStart, P.L.b, [])
    return mk(P, 'simple_expansion', dStart, P.L.b, [dollar, vn])
  }
  if (isIdentStart(nc)) {
    const vStart = P.L.b
    while (isIdentChar(peek(P.L))) advance(P.L)
    const vn = mk(P, 'variable_name', vStart, P.L.b, [])
    return mk(P, 'simple_expansion', dStart, P.L.b, [dollar, vn])
  }
  if (isDigit(nc)) {
    const vStart = P.L.b
    advance(P.L)
    const vn = mk(P, 'variable_name', vStart, P.L.b, [])
    return mk(P, 'simple_expansion', dStart, P.L.b, [dollar, vn])
  }
  if (SPECIAL_VARS.has(nc)) {
    const vStart = P.L.b
    advance(P.L)
    const vn = mk(P, 'special_variable_name', vStart, P.L.b, [])
    return mk(P, 'simple_expansion', dStart, P.L.b, [dollar, vn])
  }
  // Bare $ — just a $ leaf (tree-sitter treats trailing $ as literal)
  return dollar
}

export function parseExpansionBody(P: ParseState): TsNode[] {
  const out: TsNode[] = []
  skipBlanks(P.L)
  // Bizarre cases: ${#!} ${!#} ${!##} ${!# } ${!## } all emit empty (expansion)
  // — both # and ! become anonymous nodes when only combined with each other
  // and optional trailing space before }. Note ${!##/} does NOT match (has
  // content after), so it parses normally as (special_variable_name)(regex).
  {
    const c0 = peek(P.L)
    const c1 = peek(P.L, 1)
    if (c0 === '#' && c1 === '!' && peek(P.L, 2) === '}') {
      advance(P.L)
      advance(P.L)
      return out
    }
    if (c0 === '!' && c1 === '#') {
      // ${!#} ${!##} with optional trailing space then }
      let j = 2
      if (peek(P.L, j) === '#') j++
      if (peek(P.L, j) === ' ') j++
      if (peek(P.L, j) === '}') {
        while (j-- > 0) advance(P.L)
        return out
      }
    }
  }
  // Optional # prefix for length
  if (peek(P.L) === '#') {
    const s = P.L.b
    advance(P.L)
    out.push(mk(P, '#', s, P.L.b, []))
  }
  // Optional ! prefix for indirect expansion: ${!varname} ${!prefix*} ${!prefix@}
  // Only when followed by an identifier — ${!} alone is special var $!
  // Also = ~ prefixes (zsh-style ${=var} ${~var})
  const pc = peek(P.L)
  if (
    (pc === '!' || pc === '=' || pc === '~') &&
    (isIdentStart(peek(P.L, 1)) || isDigit(peek(P.L, 1)))
  ) {
    const s = P.L.b
    advance(P.L)
    out.push(mk(P, pc, s, P.L.b, []))
  }
  skipBlanks(P.L)
  // Variable name
  if (isIdentStart(peek(P.L))) {
    const s = P.L.b
    while (isIdentChar(peek(P.L))) advance(P.L)
    out.push(mk(P, 'variable_name', s, P.L.b, []))
  } else if (isDigit(peek(P.L))) {
    const s = P.L.b
    while (isDigit(peek(P.L))) advance(P.L)
    out.push(mk(P, 'variable_name', s, P.L.b, []))
  } else if (SPECIAL_VARS.has(peek(P.L))) {
    const s = P.L.b
    advance(P.L)
    out.push(mk(P, 'special_variable_name', s, P.L.b, []))
  }
  // Optional subscript [idx] — parsed arithmetically
  if (peek(P.L) === '[') {
    const varNode = out[out.length - 1]
    const brOpen = P.L.b
    advance(P.L)
    const brOpenNode = mk(P, '[', brOpen, P.L.b, [])
    const idx = parseSubscriptIndexInline(P)
    skipBlanks(P.L)
    const brClose = P.L.b
    if (peek(P.L) === ']') advance(P.L)
    const brCloseNode = mk(P, ']', brClose, P.L.b, [])
    if (varNode) {
      const kids = idx
        ? [varNode, brOpenNode, idx, brCloseNode]
        : [varNode, brOpenNode, brCloseNode]
      out[out.length - 1] = mk(P, 'subscript', varNode.startIndex, P.L.b, kids)
    }
  }
  skipBlanks(P.L)
  // Trailing * or @ for indirect expansion (${!prefix*} ${!prefix@}) or
  // @operator for parameter transformation (${var@U} ${var@Q}) — anonymous
  const tc = peek(P.L)
  if ((tc === '*' || tc === '@') && peek(P.L, 1) === '}') {
    const s = P.L.b
    advance(P.L)
    out.push(mk(P, tc, s, P.L.b, []))
    return out
  }
  if (tc === '@' && isIdentStart(peek(P.L, 1))) {
    // ${var@U} transformation — @ is anonymous, consume op char(s)
    const s = P.L.b
    advance(P.L)
    out.push(mk(P, '@', s, P.L.b, []))
    while (isIdentChar(peek(P.L))) advance(P.L)
    return out
  }
  // Operator :- := :? :+ - = ? + # ## % %% / // ^ ^^ , ,, etc.
  const c = peek(P.L)
  // Bare `:` substring operator ${var:off:len} — offset and length parsed
  // arithmetically. Must come BEFORE the generic operator handling so `(` after
  // `:` goes to parenthesized_expression not the array path. `:-` `:=` `:?`
  // `:+` (no space) remain default-value operators; `: -1` (with space before
  // -1) is substring with negative offset.
  if (c === ':') {
    const c1 = peek(P.L, 1)
    // `:\n` or `:}` — empty substring expansion, emits nothing (variable_name only)
    if (c1 === '\n' || c1 === '}') {
      advance(P.L)
      while (peek(P.L) === '\n') advance(P.L)
      return out
    }
    if (c1 !== '-' && c1 !== '=' && c1 !== '?' && c1 !== '+') {
      advance(P.L)
      skipBlanks(P.L)
      // Offset — arithmetic. `-N` at top level is a single number node per
      // tree-sitter; inside parens it's unary_expression(number).
      const offC = peek(P.L)
      let off: TsNode | null
      if (offC === '-' && isDigit(peek(P.L, 1))) {
        const ns = P.L.b
        advance(P.L)
        while (isDigit(peek(P.L))) advance(P.L)
        off = mk(P, 'number', ns, P.L.b, [])
      } else {
        off = parseArithExpr(P, ':}', 'var')
      }
      if (off) out.push(off)
      skipBlanks(P.L)
      if (peek(P.L) === ':') {
        advance(P.L)
        skipBlanks(P.L)
        const lenC = peek(P.L)
        let len: TsNode | null
        if (lenC === '-' && isDigit(peek(P.L, 1))) {
          const ns = P.L.b
          advance(P.L)
          while (isDigit(peek(P.L))) advance(P.L)
          len = mk(P, 'number', ns, P.L.b, [])
        } else {
          len = parseArithExpr(P, '}', 'var')
        }
        if (len) out.push(len)
      }
      return out
    }
  }
  if (
    c === ':' ||
    c === '#' ||
    c === '%' ||
    c === '/' ||
    c === '^' ||
    c === ',' ||
    c === '-' ||
    c === '=' ||
    c === '?' ||
    c === '+'
  ) {
    const s = P.L.b
    const c1 = peek(P.L, 1)
    let op = c
    if (c === ':' && (c1 === '-' || c1 === '=' || c1 === '?' || c1 === '+')) {
      advance(P.L)
      advance(P.L)
      op = c + c1
    } else if (
      (c === '#' || c === '%' || c === '/' || c === '^' || c === ',') &&
      c1 === c
    ) {
      // Doubled operators: ## %% // ^^ ,,
      advance(P.L)
      advance(P.L)
      op = c + c
    } else {
      advance(P.L)
    }
    out.push(mk(P, op, s, P.L.b, []))
    // Rest is the default/replacement — parse as word or regex until }
    // Pattern-matching operators (# ## % %% / // ^ ^^ , ,,) emit regex;
    // value-substitution operators (:- := :? :+ - = ? + :) emit word.
    // `/` and `//` split at next `/` into (regex)+(word) for pat/repl.
    const isPattern =
      op === '#' ||
      op === '##' ||
      op === '%' ||
      op === '%%' ||
      op === '/' ||
      op === '//' ||
      op === '^' ||
      op === '^^' ||
      op === ',' ||
      op === ',,'
    if (op === '/' || op === '//') {
      // Optional /# or /% anchor prefix — anonymous node
      const ac = peek(P.L)
      if (ac === '#' || ac === '%') {
        const aStart = P.L.b
        advance(P.L)
        out.push(mk(P, ac, aStart, P.L.b, []))
      }
      // Pattern: per grammar _expansion_regex_replacement, pattern is
      // choice(regex, string, cmd_sub, seq(string, regex)). If it STARTS
      // with ", emit (string) and any trailing chars become (regex).
      // `${v//"${old}"/}` → (string(expansion)); `${v//"${c}"\//}` →
      // (string)(regex).
      if (peek(P.L) === '"') {
        out.push(parseDoubleQuoted(P))
        const tail = parseExpansionRest(P, 'regex', true)
        if (tail) out.push(tail)
      } else {
        const regex = parseExpansionRest(P, 'regex', true)
        if (regex) out.push(regex)
      }
      if (peek(P.L) === '/') {
        const sepStart = P.L.b
        advance(P.L)
        out.push(mk(P, '/', sepStart, P.L.b, []))
        // Replacement: per grammar, choice includes `seq(cmd_sub, word)`
        // which emits TWO siblings (not concatenation). Also `(` at start
        // of replacement is a regular word char, NOT array — unlike `:-`
        // default-value context. `${v/(/(Gentoo ${x}, }` replacement
        // `(Gentoo ${x}, ` is (concatenation (word)(expansion)(word)).
        const repl = parseExpansionRest(P, 'replword', false)
        if (repl) {
          // seq(cmd_sub, word) special case → siblings. Detected when
          // replacement is a concatenation of exactly 2 parts with first
          // being command_substitution.
          if (
            repl.type === 'concatenation' &&
            repl.children.length === 2 &&
            repl.children[0]!.type === 'command_substitution'
          ) {
            out.push(repl.children[0]!)
            out.push(repl.children[1]!)
          } else {
            out.push(repl)
          }
        }
      }
    } else if (op === '#' || op === '##' || op === '%' || op === '%%') {
      // Pattern-removal: per grammar _expansion_regex, pattern is
      // repeat(choice(regex, string, raw_string, ')')). Each quote/string
      // is a SIBLING, not absorbed into one regex. `${f%'str'*}` →
      // (raw_string)(regex); `${f/'str'*}` (slash) stays single regex.
      for (const p of parseExpansionRegexSegmented(P)) out.push(p)
    } else {
      const rest = parseExpansionRest(P, isPattern ? 'regex' : 'word', false)
      if (rest) out.push(rest)
    }
  }
  return out
}
