/**
 * Bash parser core: program, statements, and-or lists, pipelines, commands.
 *
 * Defines ParseState and the core parsing infrastructure: parseProgram,
 * parseStatements, parseAndOr, parsePipeline, parseCommand, parseSimpleCommand.
 * Uses the tokenizer from ./bash-tokenizer.js.
 */

import type { TsNode, Token, Lexer } from './bash-tokenizer.js'
import { makeLexer, advance, peek, nextToken, skipBlanks, byteAt, isDigit, PARSE_TIMEOUT_MS, MAX_NODES } from './bash-tokenizer.js'
import { SHELL_KEYWORDS, DECL_KEYWORDS } from './bash-tokenizer.js'
import { maybeRedirect, parseWord, tryParseAssignment, tryParseRedirect, parseProcessSub, scanHeredocBodies, parseHeredocBodyContent, restoreLexToByte } from './bash-parser-word.js'
import { parseIf, parseWhile, parseFor, parseCase, parseFunction, parseDeclaration, parseUnset, parseTestExpr, parseArithCommaList } from './bash-parser-ctrl.js'

// ───────────────────────────── Parser ─────────────────────────────

export type ParseState = {
  L: Lexer
  src: string
  srcBytes: number
  /** True when byte offsets == char indices (no multi-byte UTF-8) */
  isAscii: boolean
  nodeCount: number
  deadline: number
  aborted: boolean
  /** Depth of backtick nesting — inside `...`, ` terminates words */
  inBacktick: number
  /** When set, parseSimpleCommand stops at this token (for `[` backtrack) */
  stopToken: string | null
}

export function parseSource(source: string, timeoutMs?: number): TsNode | null {
  const L = makeLexer(source)
  const srcBytes = byteLengthUtf8(source)
  const P: ParseState = {
    L,
    src: source,
    srcBytes,
    isAscii: srcBytes === source.length,
    nodeCount: 0,
    deadline: performance.now() + (timeoutMs ?? PARSE_TIMEOUT_MS),
    aborted: false,
    inBacktick: 0,
    stopToken: null,
  }
  try {
    const program = parseProgram(P)
    if (P.aborted) return null
    return program
  } catch {
    return null
  }
}

export function byteLengthUtf8(s: string): number {
  let b = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) b++
    else if (c < 0x800) b += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      b += 4
      i++
    } else b += 3
  }
  return b
}

export function checkBudget(P: ParseState): void {
  P.nodeCount++
  if (P.nodeCount > MAX_NODES) {
    P.aborted = true
    throw new Error('budget')
  }
  if ((P.nodeCount & 0x7f) === 0 && performance.now() > P.deadline) {
    P.aborted = true
    throw new Error('timeout')
  }
}

/** Build a node. Slices text from source by byte range via char-index lookup. */
export function mk(
  P: ParseState,
  type: string,
  start: number,
  end: number,
  children: TsNode[],
): TsNode {
  checkBudget(P)
  return {
    type,
    text: sliceBytes(P, start, end),
    startIndex: start,
    endIndex: end,
    children,
  }
}

export function sliceBytes(P: ParseState, startByte: number, endByte: number): string {
  if (P.isAscii) return P.src.slice(startByte, endByte)
  // Find char indices for byte offsets. Build byte table if needed.
  const L = P.L
  if (!L.byteTable) byteAt(L, 0)
  const t = L.byteTable!
  // Binary search for char index where byte offset matches
  let lo = 0
  let hi = P.src.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (t[m]! < startByte) lo = m + 1
    else hi = m
  }
  const sc = lo
  lo = sc
  hi = P.src.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (t[m]! < endByte) lo = m + 1
    else hi = m
  }
  return P.src.slice(sc, lo)
}

export function leaf(P: ParseState, type: string, tok: Token): TsNode {
  return mk(P, type, tok.start, tok.end, [])
}

export function parseProgram(P: ParseState): TsNode {
  const children: TsNode[] = []
  // Skip leading whitespace & newlines — program start is first content byte
  skipBlanks(P.L)
  while (true) {
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type === 'NEWLINE') {
      skipBlanks(P.L)
      continue
    }
    restoreLex(P.L, save)
    break
  }
  const progStart = P.L.b
  while (P.L.i < P.L.len) {
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type === 'EOF') break
    if (t.type === 'NEWLINE') continue
    if (t.type === 'COMMENT') {
      children.push(leaf(P, 'comment', t))
      continue
    }
    restoreLex(P.L, save)
    const stmts = parseStatements(P, null)
    for (const s of stmts) children.push(s)
    if (stmts.length === 0) {
      // Couldn't parse — emit ERROR and skip one token
      const errTok = nextToken(P.L, 'cmd')
      if (errTok.type === 'EOF') break
      // Stray `;;` at program level (e.g., `var=;;` outside case) — tree-sitter
      // silently elides. Keep leading `;` as ERROR (security: paste artifact).
      if (
        errTok.type === 'OP' &&
        errTok.value === ';;' &&
        children.length > 0
      ) {
        continue
      }
      children.push(mk(P, 'ERROR', errTok.start, errTok.end, []))
    }
  }
  // tree-sitter includes trailing whitespace in program extent
  const progEnd = children.length > 0 ? P.srcBytes : progStart
  return mk(P, 'program', progStart, progEnd, children)
}

/** Packed as (b << 16) | i — avoids heap alloc on every backtrack. */
export type LexSave = number
export function saveLex(L: Lexer): LexSave {
  return L.b * 0x10000 + L.i
}
export function restoreLex(L: Lexer, s: LexSave): void {
  L.i = s & 0xffff
  L.b = s >>> 16
}

/**
 * Parse a sequence of statements separated by ; & newline. Returns a flat list
 * where ; and & are sibling leaves (NOT wrapped in 'list' — only && || get
 * that). Stops at terminator or EOF.
 */
export function parseStatements(P: ParseState, terminator: string | null): TsNode[] {
  const out: TsNode[] = []
  while (true) {
    skipBlanks(P.L)
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type === 'EOF') {
      restoreLex(P.L, save)
      break
    }
    if (t.type === 'NEWLINE') {
      // Process pending heredocs
      if (P.L.heredocs.length > 0) {
        scanHeredocBodies(P)
      }
      continue
    }
    if (t.type === 'COMMENT') {
      out.push(leaf(P, 'comment', t))
      continue
    }
    if (terminator && t.type === 'OP' && t.value === terminator) {
      restoreLex(P.L, save)
      break
    }
    if (
      t.type === 'OP' &&
      (t.value === ')' ||
        t.value === '}' ||
        t.value === ';;' ||
        t.value === ';&' ||
        t.value === ';;&' ||
        t.value === '))' ||
        t.value === ']]' ||
        t.value === ']')
    ) {
      restoreLex(P.L, save)
      break
    }
    if (t.type === 'BACKTICK' && P.inBacktick > 0) {
      restoreLex(P.L, save)
      break
    }
    if (
      t.type === 'WORD' &&
      (t.value === 'then' ||
        t.value === 'elif' ||
        t.value === 'else' ||
        t.value === 'fi' ||
        t.value === 'do' ||
        t.value === 'done' ||
        t.value === 'esac')
    ) {
      restoreLex(P.L, save)
      break
    }
    restoreLex(P.L, save)
    const stmt = parseAndOr(P)
    if (!stmt) break
    out.push(stmt)
    // Look for separator
    skipBlanks(P.L)
    const save2 = saveLex(P.L)
    const sep = nextToken(P.L, 'cmd')
    if (sep.type === 'OP' && (sep.value === ';' || sep.value === '&')) {
      // Check if terminator follows — if so, emit separator but stop
      const save3 = saveLex(P.L)
      const after = nextToken(P.L, 'cmd')
      restoreLex(P.L, save3)
      out.push(leaf(P, sep.value, sep))
      if (
        after.type === 'EOF' ||
        (after.type === 'OP' &&
          (after.value === ')' ||
            after.value === '}' ||
            after.value === ';;' ||
            after.value === ';&' ||
            after.value === ';;&')) ||
        (after.type === 'WORD' &&
          (after.value === 'then' ||
            after.value === 'elif' ||
            after.value === 'else' ||
            after.value === 'fi' ||
            after.value === 'do' ||
            after.value === 'done' ||
            after.value === 'esac'))
      ) {
        // Trailing separator — don't include it at program level unless
        // there's content after. But at inner levels we keep it.
        continue
      }
    } else if (sep.type === 'NEWLINE') {
      if (P.L.heredocs.length > 0) {
        scanHeredocBodies(P)
      }
      continue
    } else {
      restoreLex(P.L, save2)
    }
  }
  // Trim trailing separator if at program level
  return out
}

/**
 * Parse pipeline chains joined by && ||. Left-associative nesting.
 * tree-sitter quirk: trailing redirect on the last pipeline wraps the ENTIRE
 * list in a redirected_statement — `a > x && b > y` becomes
 * redirected_statement(list(redirected_statement(a,>x), &&, b), >y).
 */
export function parseAndOr(P: ParseState): TsNode | null {
  let left = parsePipeline(P)
  if (!left) return null
  while (true) {
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type === 'OP' && (t.value === '&&' || t.value === '||')) {
      const op = leaf(P, t.value, t)
      skipNewlines(P)
      const right = parsePipeline(P)
      if (!right) {
        left = mk(P, 'list', left.startIndex, op.endIndex, [left, op])
        break
      }
      // If right is a redirected_statement, hoist its redirects to wrap the list.
      if (right.type === 'redirected_statement' && right.children.length >= 2) {
        const inner = right.children[0]!
        const redirs = right.children.slice(1)
        const listNode = mk(P, 'list', left.startIndex, inner.endIndex, [
          left,
          op,
          inner,
        ])
        const lastR = redirs[redirs.length - 1]!
        left = mk(
          P,
          'redirected_statement',
          listNode.startIndex,
          lastR.endIndex,
          [listNode, ...redirs],
        )
      } else {
        left = mk(P, 'list', left.startIndex, right.endIndex, [left, op, right])
      }
    } else {
      restoreLex(P.L, save)
      break
    }
  }
  return left
}

export function skipNewlines(P: ParseState): void {
  while (true) {
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type !== 'NEWLINE') {
      restoreLex(P.L, save)
      break
    }
  }
}

/**
 * Parse commands joined by | or |&. Flat children with operator leaves.
 * tree-sitter quirk: `a | b 2>nul | c` hoists the redirect on `b` to wrap
 * the preceding pipeline fragment — pipeline(redirected_statement(
 * pipeline(a,|,b), 2>nul), |, c).
 */
export function parsePipeline(P: ParseState): TsNode | null {
  let first = parseCommand(P)
  if (!first) return null
  const parts: TsNode[] = [first]
  while (true) {
    const save = saveLex(P.L)
    const t = nextToken(P.L, 'cmd')
    if (t.type === 'OP' && (t.value === '|' || t.value === '|&')) {
      const op = leaf(P, t.value, t)
      skipNewlines(P)
      const next = parseCommand(P)
      if (!next) {
        parts.push(op)
        break
      }
      // Hoist trailing redirect on `next` to wrap current pipeline fragment
      if (
        next.type === 'redirected_statement' &&
        next.children.length >= 2 &&
        parts.length >= 1
      ) {
        const inner = next.children[0]!
        const redirs = next.children.slice(1)
        // Wrap existing parts + op + inner as a pipeline
        const pipeKids = [...parts, op, inner]
        const pipeNode = mk(
          P,
          'pipeline',
          pipeKids[0]!.startIndex,
          inner.endIndex,
          pipeKids,
        )
        const lastR = redirs[redirs.length - 1]!
        const wrapped = mk(
          P,
          'redirected_statement',
          pipeNode.startIndex,
          lastR.endIndex,
          [pipeNode, ...redirs],
        )
        parts.length = 0
        parts.push(wrapped)
        first = wrapped
        continue
      }
      parts.push(op, next)
    } else {
      restoreLex(P.L, save)
      break
    }
  }
  if (parts.length === 1) return parts[0]!
  const last = parts[parts.length - 1]!
  return mk(P, 'pipeline', parts[0]!.startIndex, last.endIndex, parts)
}

/** Parse a single command: simple, compound, or control structure. */
export function parseCommand(P: ParseState): TsNode | null {
  skipBlanks(P.L)
  const save = saveLex(P.L)
  const t = nextToken(P.L, 'cmd')

  if (t.type === 'EOF') {
    restoreLex(P.L, save)
    return null
  }

  // Negation — tree-sitter wraps just the command, redirects go outside.
  // `! cmd > out` → redirected_statement(negated_command(!, cmd), >out)
  if (t.type === 'OP' && t.value === '!') {
    const bang = leaf(P, '!', t)
    const inner = parseCommand(P)
    if (!inner) {
      restoreLex(P.L, save)
      return null
    }
    // If inner is a redirected_statement, hoist redirects outside negation
    if (inner.type === 'redirected_statement' && inner.children.length >= 2) {
      const cmd = inner.children[0]!
      const redirs = inner.children.slice(1)
      const neg = mk(P, 'negated_command', bang.startIndex, cmd.endIndex, [
        bang,
        cmd,
      ])
      const lastR = redirs[redirs.length - 1]!
      return mk(P, 'redirected_statement', neg.startIndex, lastR.endIndex, [
        neg,
        ...redirs,
      ])
    }
    return mk(P, 'negated_command', bang.startIndex, inner.endIndex, [
      bang,
      inner,
    ])
  }

  if (t.type === 'OP' && t.value === '(') {
    const open = leaf(P, '(', t)
    const body = parseStatements(P, ')')
    const closeTok = nextToken(P.L, 'cmd')
    const close =
      closeTok.type === 'OP' && closeTok.value === ')'
        ? leaf(P, ')', closeTok)
        : mk(P, ')', open.endIndex, open.endIndex, [])
    const node = mk(P, 'subshell', open.startIndex, close.endIndex, [
      open,
      ...body,
      close,
    ])
    return maybeRedirect(P, node)
  }

  if (t.type === 'OP' && t.value === '((') {
    const open = leaf(P, '((', t)
    const exprs = parseArithCommaList(P, '))', 'var')
    const closeTok = nextToken(P.L, 'cmd')
    const close =
      closeTok.value === '))'
        ? leaf(P, '))', closeTok)
        : mk(P, '))', open.endIndex, open.endIndex, [])
    return mk(P, 'compound_statement', open.startIndex, close.endIndex, [
      open,
      ...exprs,
      close,
    ])
  }

  if (t.type === 'OP' && t.value === '{') {
    const open = leaf(P, '{', t)
    const body = parseStatements(P, '}')
    const closeTok = nextToken(P.L, 'cmd')
    const close =
      closeTok.type === 'OP' && closeTok.value === '}'
        ? leaf(P, '}', closeTok)
        : mk(P, '}', open.endIndex, open.endIndex, [])
    const node = mk(P, 'compound_statement', open.startIndex, close.endIndex, [
      open,
      ...body,
      close,
    ])
    return maybeRedirect(P, node)
  }

  if (t.type === 'OP' && (t.value === '[' || t.value === '[[')) {
    const open = leaf(P, t.value, t)
    const closer = t.value === '[' ? ']' : ']]'
    // Grammar: `[` can contain choice(_expression, redirected_statement).
    // Try _expression first; if we don't reach `]`, backtrack and parse as
    // redirected_statement (handles `[ ! cmd -v go &>/dev/null ]`).
    const exprSave = saveLex(P.L)
    let expr = parseTestExpr(P, closer)
    skipBlanks(P.L)
    if (t.value === '[' && peek(P.L) !== ']') {
      // Expression parse didn't reach `]` — try as redirected_statement.
      // Thread `]` stop-token so parseSimpleCommand doesn't eat it as arg.
      restoreLex(P.L, exprSave)
      const prevStop = P.stopToken
      P.stopToken = ']'
      const rstmt = parseCommand(P)
      P.stopToken = prevStop
      if (rstmt && rstmt.type === 'redirected_statement') {
        expr = rstmt
      } else {
        // Neither worked — restore and keep the expression result
        restoreLex(P.L, exprSave)
        expr = parseTestExpr(P, closer)
      }
      skipBlanks(P.L)
    }
    const closeTok = nextToken(P.L, 'arg')
    let close: TsNode
    if (closeTok.value === closer) {
      close = leaf(P, closer, closeTok)
    } else {
      close = mk(P, closer, open.endIndex, open.endIndex, [])
    }
    const kids = expr ? [open, expr, close] : [open, close]
    return mk(P, 'test_command', open.startIndex, close.endIndex, kids)
  }

  if (t.type === 'WORD') {
    if (t.value === 'if') return maybeRedirect(P, parseIf(P, t), true)
    if (t.value === 'while' || t.value === 'until')
      return maybeRedirect(P, parseWhile(P, t), true)
    if (t.value === 'for') return maybeRedirect(P, parseFor(P, t), true)
    if (t.value === 'select') return maybeRedirect(P, parseFor(P, t), true)
    if (t.value === 'case') return maybeRedirect(P, parseCase(P, t), true)
    if (t.value === 'function') return parseFunction(P, t)
    if (DECL_KEYWORDS.has(t.value))
      return maybeRedirect(P, parseDeclaration(P, t))
    if (t.value === 'unset' || t.value === 'unsetenv') {
      return maybeRedirect(P, parseUnset(P, t))
    }
  }

  restoreLex(P.L, save)
  return parseSimpleCommand(P)
}

/**
 * Parse a simple command: [assignment]* word [arg|redirect]*
 * Returns variable_assignment if only one assignment and no command.
 */
export function parseSimpleCommand(P: ParseState): TsNode | null {
  const start = P.L.b
  const assignments: TsNode[] = []
  const preRedirects: TsNode[] = []

  while (true) {
    skipBlanks(P.L)
    const a = tryParseAssignment(P)
    if (a) {
      assignments.push(a)
      continue
    }
    const r = tryParseRedirect(P)
    if (r) {
      preRedirects.push(r)
      continue
    }
    break
  }

  skipBlanks(P.L)
  const save = saveLex(P.L)
  const nameTok = nextToken(P.L, 'cmd')
  if (
    nameTok.type === 'EOF' ||
    nameTok.type === 'NEWLINE' ||
    nameTok.type === 'COMMENT' ||
    (nameTok.type === 'OP' &&
      nameTok.value !== '{' &&
      nameTok.value !== '[' &&
      nameTok.value !== '[[') ||
    (nameTok.type === 'WORD' &&
      SHELL_KEYWORDS.has(nameTok.value) &&
      nameTok.value !== 'in')
  ) {
    restoreLex(P.L, save)
    // No command — standalone assignment(s) or redirect
    if (assignments.length === 1 && preRedirects.length === 0) {
      return assignments[0]!
    }
    if (preRedirects.length > 0 && assignments.length === 0) {
      // Bare redirect → redirected_statement with just file_redirect children
      const last = preRedirects[preRedirects.length - 1]!
      return mk(
        P,
        'redirected_statement',
        preRedirects[0]!.startIndex,
        last.endIndex,
        preRedirects,
      )
    }
    if (assignments.length > 1 && preRedirects.length === 0) {
      // `A=1 B=2` with no command → variable_assignments (plural)
      const last = assignments[assignments.length - 1]!
      return mk(
        P,
        'variable_assignments',
        assignments[0]!.startIndex,
        last.endIndex,
        assignments,
      )
    }
    if (assignments.length > 0 || preRedirects.length > 0) {
      const all = [...assignments, ...preRedirects]
      const last = all[all.length - 1]!
      return mk(P, 'command', start, last.endIndex, all)
    }
    return null
  }
  restoreLex(P.L, save)

  // Check for function definition: name() { ... }
  const fnSave = saveLex(P.L)
  const nm = parseWord(P, 'cmd')
  if (nm && nm.type === 'word') {
    skipBlanks(P.L)
    if (peek(P.L) === '(' && peek(P.L, 1) === ')') {
      const oTok = nextToken(P.L, 'cmd')
      const cTok = nextToken(P.L, 'cmd')
      const oParen = leaf(P, '(', oTok)
      const cParen = leaf(P, ')', cTok)
      skipBlanks(P.L)
      skipNewlines(P)
      const body = parseCommand(P)
      if (body) {
        // If body is redirected_statement(compound_statement, file_redirect...),
        // hoist redirects to function_definition level per tree-sitter grammar
        let bodyKids: TsNode[] = [body]
        if (
          body.type === 'redirected_statement' &&
          body.children.length >= 2 &&
          body.children[0]!.type === 'compound_statement'
        ) {
          bodyKids = body.children
        }
        const last = bodyKids[bodyKids.length - 1]!
        return mk(P, 'function_definition', nm.startIndex, last.endIndex, [
          nm,
          oParen,
          cParen,
          ...bodyKids,
        ])
      }
    }
  }
  restoreLex(P.L, fnSave)

  const nameArg = parseWord(P, 'cmd')
  if (!nameArg) {
    if (assignments.length === 1) return assignments[0]!
    return null
  }

  const cmdName = mk(P, 'command_name', nameArg.startIndex, nameArg.endIndex, [
    nameArg,
  ])

  const args: TsNode[] = []
  const redirects: TsNode[] = []
  let heredocRedirect: TsNode | null = null

  while (true) {
    skipBlanks(P.L)
    // Post-command redirects are greedy (repeat1 $._literal) — once a redirect
    // appears after command_name, subsequent literals attach to it per grammar's
    // prec.left. `grep 2>/dev/null -q foo` → file_redirect eats `-q foo`.
    // Args parsed BEFORE the first redirect still go to command (cat a b > out).
    const r = tryParseRedirect(P, true)
    if (r) {
      if (r.type === 'heredoc_redirect') {
        heredocRedirect = r
      } else if (r.type === 'herestring_redirect') {
        args.push(r)
      } else {
        redirects.push(r)
      }
      continue
    }
    // Once a file_redirect has been seen, command args are done — grammar's
    // command rule doesn't allow file_redirect in its post-name choice, so
    // anything after belongs to redirected_statement's file_redirect children.
    if (redirects.length > 0) break
    // `[` test_command backtrack — stop at `]` so outer handler can consume it
    if (P.stopToken === ']' && peek(P.L) === ']') break
    const save2 = saveLex(P.L)
    const pk = nextToken(P.L, 'arg')
    if (
      pk.type === 'EOF' ||
      pk.type === 'NEWLINE' ||
      pk.type === 'COMMENT' ||
      (pk.type === 'OP' &&
        (pk.value === '|' ||
          pk.value === '|&' ||
          pk.value === '&&' ||
          pk.value === '||' ||
          pk.value === ';' ||
          pk.value === ';;' ||
          pk.value === ';&' ||
          pk.value === ';;&' ||
          pk.value === '&' ||
          pk.value === ')' ||
          pk.value === '}' ||
          pk.value === '))'))
    ) {
      restoreLex(P.L, save2)
      break
    }
    restoreLex(P.L, save2)
    const arg = parseWord(P, 'arg')
    if (!arg) {
      // Lone `(` in arg position — tree-sitter parses this as subshell arg
      // e.g., `echo =(cmd)` → command has ERROR(=), subshell(cmd) as args
      if (peek(P.L) === '(') {
        const oTok = nextToken(P.L, 'cmd')
        const open = leaf(P, '(', oTok)
        const body = parseStatements(P, ')')
        const cTok = nextToken(P.L, 'cmd')
        const close =
          cTok.type === 'OP' && cTok.value === ')'
            ? leaf(P, ')', cTok)
            : mk(P, ')', open.endIndex, open.endIndex, [])
        args.push(
          mk(P, 'subshell', open.startIndex, close.endIndex, [
            open,
            ...body,
            close,
          ]),
        )
        continue
      }
      break
    }
    // Lone `=` in arg position is a parse error in bash — tree-sitter wraps
    // it in ERROR for recovery. Happens in `echo =(cmd)` (zsh process-sub).
    if (arg.type === 'word' && arg.text === '=') {
      args.push(mk(P, 'ERROR', arg.startIndex, arg.endIndex, [arg]))
      continue
    }
    // Word immediately followed by `(` (no whitespace) is a parse error —
    // bash doesn't allow glob-then-subshell adjacency. tree-sitter wraps the
    // word in ERROR. Catches zsh glob qualifiers like `*.(e:'cmd':)`.
    if (
      (arg.type === 'word' || arg.type === 'concatenation') &&
      peek(P.L) === '(' &&
      P.L.b === arg.endIndex
    ) {
      args.push(mk(P, 'ERROR', arg.startIndex, arg.endIndex, [arg]))
      continue
    }
    args.push(arg)
  }

  // preRedirects (e.g., `2>&1 cat`, `<<<str cmd`) go INSIDE the command node
  // before command_name per tree-sitter grammar, not in redirected_statement
  const cmdChildren = [...assignments, ...preRedirects, cmdName, ...args]
  const cmdEnd =
    cmdChildren.length > 0
      ? cmdChildren[cmdChildren.length - 1]!.endIndex
      : cmdName.endIndex
  const cmdStart = cmdChildren[0]!.startIndex
  const cmd = mk(P, 'command', cmdStart, cmdEnd, cmdChildren)

  if (heredocRedirect) {
    // Scan heredoc body now
    scanHeredocBodies(P)
    const hd = P.L.heredocs.shift()
    if (hd && heredocRedirect.children.length >= 2) {
      const bodyNode = mk(
        P,
        'heredoc_body',
        hd.bodyStart,
        hd.bodyEnd,
        hd.quoted ? [] : parseHeredocBodyContent(P, hd.bodyStart, hd.bodyEnd),
      )
      const endNode = mk(P, 'heredoc_end', hd.endStart, hd.endEnd, [])
      heredocRedirect.children.push(bodyNode, endNode)
      heredocRedirect.endIndex = hd.endEnd
      heredocRedirect.text = sliceBytes(
        P,
        heredocRedirect.startIndex,
        hd.endEnd,
      )
    }
    const allR = [...preRedirects, heredocRedirect, ...redirects]
    const rStart =
      preRedirects.length > 0
        ? Math.min(cmd.startIndex, preRedirects[0]!.startIndex)
        : cmd.startIndex
    return mk(P, 'redirected_statement', rStart, heredocRedirect.endIndex, [
      cmd,
      ...allR,
    ])
  }

  if (redirects.length > 0) {
    const last = redirects[redirects.length - 1]!
    return mk(P, 'redirected_statement', cmd.startIndex, last.endIndex, [
      cmd,
      ...redirects,
    ])
  }

  return cmd
}
