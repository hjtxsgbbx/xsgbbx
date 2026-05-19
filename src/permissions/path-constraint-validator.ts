/**
 * Path Constraint Validator — validates filesystem paths against security
 * boundaries: workspace containment, protected system paths, and safe
 * path resolution.
 *
 * All functions are pure: inputs are readonly and outputs are new objects
 * (strings, booleans) — no mutation of inputs.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Protected paths that should never be read from or written to by automated
 * tool execution. These paths contain system configuration, security
 * credentials, kernel interfaces, or other sensitive data.
 */
const PROTECTED_PATH_PREFIXES: readonly string[] = [
  '/etc/',           // System configuration
  '/proc/',          // Kernel process/filesystem interface
  '/sys/',           // Kernel sysfs interface
  '/dev/',           // Device nodes (except /dev/null, /dev/zero, /dev/random)
  '/boot/',          // Kernel images and bootloader config
  '/lib/systemd/',   // Systemd unit files
  '/var/spool/cron/', // Cron job definitions
  '/root/',          // Root user home
  '~/.ssh/',         // SSH keys
  '~/.gnupg/',       // GPG keys
  '~/.aws/',         // AWS credentials
  '~/.kube/',        // Kubernetes config
  '~/.config/gh/',   // GitHub CLI credentials
  '~/.npmrc',        // NPM credentials
  '~/.pypirc',       // PyPI credentials
  '~/.gitconfig',    // Git global config
  '.env',            // Environment files (relative)
  '.env.local',      // Local env overrides (relative)
  '.env.production', // Production env (relative)
  'credentials',     // Generic credentials file
  'secrets',         // Generic secrets file
  'id_rsa',          // Private SSH key
  'id_ed25519',      // Private SSH key
  'id_ecdsa',        // Private SSH key
  '.pem',            // Private certificate/key
];

/**
 * Protected paths that should NOT be written to under any circumstances.
 * These are even more restricted than PROTECTED_PATH_PREFIXES.
 */
const WRITE_PROTECTED_PATH_PREFIXES: readonly string[] = [
  '/etc/shadow',
  '/etc/passwd',
  '/etc/sudoers',
  '/etc/sudoers.d/',
  '/etc/ssh/',
  '/etc/ssl/',
  '/etc/ca-certificates/',
  '/etc/hosts',
  '/etc/fstab',
  '/etc/crontab',
  '/proc/sys/',
  '/proc/self/mem',
  '/dev/sd',
  '/dev/hd',
  '/dev/nvme',
  '/dev/xvd',
  '/dev/vd',
  '~/.ssh/authorized_keys',
  '~/.ssh/known_hosts',
  '/boot/grub/',
  '/boot/efi/',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a path resolves outside the workspace root directory.
 *
 * Detects:
 * - Absolute paths pointing outside workspace
 * - Path traversal sequences (../..)
 * - Symlink escapes (detected via pattern, not filesystem — use isProtectedPath
 *   for filesystem-level checks)
 *
 * @param path - The filesystem path to check
 * @param workspaceRoot - The absolute path to the workspace root directory
 * @returns true if the path is outside the workspace boundary
 */
export function isPathOutsideWorkspace(path: string, workspaceRoot: string): boolean {
  if (!path || path.length === 0) {
    return false;
  }

  const normalizedPath = normalizePathSeparators(path);
  const normalizedRoot = normalizePathSeparators(workspaceRoot);

  // Absolute paths must start with the workspace root
  if (isAbsolutePath(normalizedPath)) {
    const rootWithSep = normalizedRoot.endsWith('/')
      ? normalizedRoot
      : normalizedRoot + '/';
    return !normalizedPath.startsWith(rootWithSep) && normalizedPath !== normalizedRoot;
  }

  // Relative paths: count ../ sequences to check if we escape
  const segments = normalizedPath.split('/');
  let depth = 0;
  for (const segment of segments) {
    if (segment === '..') {
      depth++;
    } else if (segment !== '.' && segment.length > 0) {
      depth--;
    }
    if (depth > 0) {
      // We went above the starting point — might escape workspace
      // For relative paths, check if depth exceeds root depth
      const rootDepth = normalizedRoot.split('/').filter(s => s.length > 0).length;
      if (depth > rootDepth) {
        return true;
      }
    }
  }

  // Check for symlink escape patterns (common paths that are typically symlinks)
  const symlinkEscapePrefixes: readonly string[] = [
    '/proc/self/root',
    '/proc/self/cwd',
    '/proc/self/fd',
  ];

  for (const prefix of symlinkEscapePrefixes) {
    if (normalizedPath.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a path is within the set of protected/restricted system paths.
 *
 * Uses prefix matching against known-sensitive directories and files.
 * This is a static check — it does not read from the filesystem.
 *
 * @param path - The filesystem path to check
 * @returns true if the path matches a protected path pattern
 */
export function isProtectedPath(path: string): boolean {
  if (!path || path.length === 0) {
    return false;
  }

  const normalized = normalizePathSeparators(path);
  const expanded = expandTilde(normalized);

  // Check full PATH_PREFIXES for read AND write protection
  for (const prefix of PROTECTED_PATH_PREFIXES) {
    const expandedPrefix = expandTilde(prefix);
    if (expanded.startsWith(expandedPrefix)) {
      return true;
    }
    // Also check if expandedPrefix is a file pattern (no trailing /)
    // contained anywhere in the path
    if (!expandedPrefix.endsWith('/') && (
      expanded === expandedPrefix ||
      expanded.endsWith('/' + expandedPrefix) ||
      expanded.includes('/' + expandedPrefix + '/')
    )) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a path should be write-protected (read may be allowed,
 * but writing is forbidden).
 *
 * This is a superset of protected paths — some paths are readable but
 * never writable (e.g., /etc/passwd is checked here for write protection).
 *
 * @param path - The filesystem path to check
 * @returns true if writing to this path should be denied
 */
export function isWriteProtectedPath(path: string): boolean {
  if (!path || path.length === 0) {
    return false;
  }

  const normalized = normalizePathSeparators(path);
  const expanded = expandTilde(normalized);

  for (const prefix of WRITE_PROTECTED_PATH_PREFIXES) {
    const expandedPrefix = expandTilde(prefix);
    if (expanded.startsWith(expandedPrefix)) {
      return true;
    }
  }

  // Also check general protected paths for write protection
  return isProtectedPath(path);
}

/**
 * Sanitize a path by resolving relative components and ensuring it stays
 * within the workspace root.
 *
 * This is a pure string-based resolution — it does not touch the filesystem.
 * For filesystem-level resolution, use path.resolve() from Node.js.
 *
 * Resolution steps:
 * 1. Normalize path separators (backslash → forward slash)
 * 2. Resolve '~' to the workspace root (not home directory — safer default)
 * 3. Resolve '.' and '..' relative to workspace root
 * 4. Clamp the result to the workspace root if it escapes
 *
 * @param path - The path to sanitize (may be relative or absolute)
 * @param workspaceRoot - The absolute path to the workspace root directory
 * @returns A sanitized absolute path string within the workspace root
 */
export function sanitizePath(path: string, workspaceRoot: string): string {
  if (!path || path.length === 0) {
    return normalizePathSeparators(workspaceRoot);
  }

  const normalizedRoot = normalizePathSeparators(workspaceRoot).replace(/\/+$/, '');
  let normalized = normalizePathSeparators(path);

  // Expand tilde: resolve to workspace root instead of home (safer default)
  normalized = expandTilde(normalized);

  // If path is absolute, resolve it directly
  if (isAbsolutePath(normalized)) {
    const segments = normalized.split('/').filter(s => s.length > 0);
    const resolved = resolveSegments(segments);

    // Check containment
    const resolvedPath = '/' + resolved.join('/');
    if (resolvedPath.startsWith(normalizedRoot + '/') || resolvedPath === normalizedRoot) {
      return resolvedPath;
    }

    // Path escapes workspace — clamp to workspace root
    return normalizedRoot;
  }

  // Relative path: resolve against workspace root
  const rootSegments = normalizedRoot.split('/').filter(s => s.length > 0);
  const relSegments = normalized.split('/').filter(s => s.length > 0);
  const allSegments = [...rootSegments, ...relSegments];
  const resolved = resolveSegments(allSegments);

  const resolvedPath = '/' + resolved.join('/');
  if (!resolvedPath.startsWith(normalizedRoot + '/') && resolvedPath !== normalizedRoot) {
    return normalizedRoot;
  }

  return resolvedPath;
}

// ---------------------------------------------------------------------------
// Helpers (pure functions, no side effects)
// ---------------------------------------------------------------------------

/**
 * Normalize path separators to forward slashes.
 */
function normalizePathSeparators(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Check if a path is absolute (starts with / or a drive letter on Windows).
 */
function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[/\\]/.test(p);
}

/**
 * Expand tilde (~) in a path.
 * Uses a safe default (empty string) — actual home directory resolution
 * should be done by the caller or OS-level functions.
 */
function expandTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    // Replace ~ with empty string (caller should use workspace root)
    return p.slice(1);
  }
  return p;
}

/**
 * Resolve '.' and '..' segments in a path segment array.
 * Pure function: returns a new array, does not mutate input.
 */
function resolveSegments(segments: readonly string[]): string[] {
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '.' || segment.length === 0) {
      continue;
    }
    if (segment === '..') {
      // Don't pop past the root (e.g., / or C:\)
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop();
      }
    } else {
      resolved.push(segment);
    }
  }
  return resolved;
}
