/**
 * LSPService (STUB)
 *
 * Language Server Protocol integration stub. Returns empty / unavailable
 * results for all queries. Full LSP integration requires spawning language
 * server processes, negotiating capabilities, and handling workspace
 * synchronization — all complex, provider-specific operations.
 *
 * This stub provides the correct API surface so callers can integrate
 * without conditional checks. Replace method bodies with real
 * implementations when you integrate an LSP client library.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LSPPosition {
  line: number;   // 0-based
  character: number;  // 0-based
}

export interface LSPRange {
  start: LSPPosition;
  end: LSPPosition;
}

export interface LSPDiagnostic {
  range: LSPRange;
  severity: DiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
}

export type DiagnosticSeverity = 1 | 2 | 3 | 4;
// 1 = Error, 2 = Warning, 3 = Information, 4 = Hint

export interface LSPHoverResult {
  contents: string;
  range?: LSPRange;
}

export interface LSPCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
}

// ---------------------------------------------------------------------------
// LSPService
// ---------------------------------------------------------------------------

export class LSPService {
  private available: boolean;

  constructor() {
    this.available = false;
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /**
   * Whether a language server is currently available.
   * Always returns false in this stub.
   *
   * Real implementation should check:
   *  - Is there a registered language server for this file type?
   *  - Is the server process running and responsive?
   *  - Are capabilities negotiated successfully?
   */
  isAvailable(): boolean {
    return this.available;
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  /**
   * Get diagnostics (errors, warnings) for a given file.
   *
   * Returns an empty array in this stub. Real implementation would:
   *  1. Determine the language server for the file extension
   *  2. Send a textDocument/didOpen or didChange notification
   *  3. Collect published diagnostics from the server
   *  4. Return the diagnostic list
   */
  getDiagnostics(_filePath: string): LSPDiagnostic[] {
    return [];
  }

  // -------------------------------------------------------------------------
  // Hover
  // -------------------------------------------------------------------------

  /**
   * Get hover information at a specific position in a file.
   *
   * Returns null in this stub. Real implementation would:
   *  1. Send a textDocument/hover request
   *  2. Parse the MarkupContent or MarkedString response
   *  3. Return formatted hover contents
   */
  getHover(_filePath: string, _position: LSPPosition): LSPHoverResult | null {
    return null;
  }

  // -------------------------------------------------------------------------
  // Completions
  // -------------------------------------------------------------------------

  /**
   * Get completion items at a position.
   *
   * Returns an empty array in this stub. Real implementation would:
   *  1. Send a textDocument/completion request
   *  2. Resolve additional details for each item if needed
   *  3. Return the completion list
   */
  getCompletions(_filePath: string, _position: LSPPosition): LSPCompletionItem[] {
    return [];
  }

  // -------------------------------------------------------------------------
  // Go-to-definition
  // -------------------------------------------------------------------------

  /**
   * Get the definition location for a symbol at a position.
   *
   * Returns null in this stub. Real implementation would:
   *  1. Send a textDocument/definition request
   *  2. Parse the Location or LocationLink response
   *  3. Return the target location
   */
  getDefinition(
    _filePath: string,
    _position: LSPPosition,
  ): { uri: string; range: LSPRange } | null {
    return null;
  }

  // -------------------------------------------------------------------------
  // References
  // -------------------------------------------------------------------------

  /**
   * Find all references to a symbol.
   *
   * Returns empty array in this stub.
   */
  getReferences(
    _filePath: string,
    _position: LSPPosition,
  ): Array<{ uri: string; range: LSPRange }> {
    return [];
  }
}
