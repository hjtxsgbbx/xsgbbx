import { execFile } from 'child_process'
import { statSync } from 'fs'
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join, resolve, sep } from 'path'
import { promisify } from 'util'

// ---------------------------------------------------------------------------
// Replaced Claude Code internal imports with local equivalents
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFile)

const getCwd = (): string => process.cwd()

function getErrnoCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException)?.code
}

/**
 * Execute a command without throwing on non-zero exit codes.
 * Returns an object with the exit code (replaces Claude's execFileNoThrowWithCwd).
 */
async function execFileNoThrowWithCwd(
  command: string,
  args: string[],
  options: { preserveOutputOnError?: boolean; cwd: string },
): Promise<{ code: number }> {
  try {
    await execFileAsync(command, args, { cwd: options.cwd })
    return { code: 0 }
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { status?: number }
    if (err.code === 'ENOENT') return { code: 127 }
    return { code: typeof err.status === 'number' ? err.status : 1 }
  }
}

/**
 * Find the git root directory by walking up from startPath looking for .git.
 * Replaces Claude's dirIsInGitRepo (which depends on git.ts and cwd.ts).
 */
function findGitRoot(startPath: string): string | null {
  let current = resolve(startPath)
  const root = current.substring(0, current.indexOf(sep) + 1) || sep

  while (current !== root) {
    try {
      const gitPath = join(current, '.git')
      const st = statSync(gitPath)
      if (st.isDirectory() || st.isFile()) {
        return current
      }
    } catch {
      // .git doesn't exist at this level
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

async function dirIsInGitRepo(cwd: string): Promise<boolean> {
  return findGitRoot(cwd) !== null
}

// ---------------------------------------------------------------------------
// Public API (function signatures unchanged from Claude Code originals)
// ---------------------------------------------------------------------------

/**
 * Checks if a path is ignored by git (via `git check-ignore`).
 *
 * This consults all applicable gitignore sources: repo `.gitignore` files
 * (nested), `.git/info/exclude`, and the global gitignore — with correct
 * precedence, because git itself resolves it.
 *
 * Exit codes: 0 = ignored, 1 = not ignored, 128 = not in a git repo.
 * Returns `false` for 128, so callers outside a git repo fail open.
 *
 * @param filePath The path to check (absolute or relative to cwd)
 * @param cwd The working directory to run git from
 */
export async function isPathGitignored(
  filePath: string,
  cwd: string,
): Promise<boolean> {
  const { code } = await execFileNoThrowWithCwd(
    'git',
    ['check-ignore', filePath],
    {
      preserveOutputOnError: false,
      cwd,
    },
  )

  return code === 0
}

/**
 * Gets the path to the global gitignore file (.config/git/ignore)
 * @returns The path to the global gitignore file
 */
export function getGlobalGitignorePath(): string {
  return join(homedir(), '.config', 'git', 'ignore')
}

/**
 * Adds a file pattern to the global gitignore file (.config/git/ignore)
 * if it's not already ignored by existing patterns in any gitignore file
 * @param filename The filename to add to gitignore
 * @param cwd The current working directory (optional)
 */
export async function addFileGlobRuleToGitignore(
  filename: string,
  cwd: string = getCwd(),
): Promise<void> {
  try {
    if (!(await dirIsInGitRepo(cwd))) {
      return
    }

    // First check if the pattern is already ignored by any gitignore file (including global)
    const gitignoreEntry = `**/${filename}`
    // For directory patterns (ending with /), check with a sample file inside
    const testPath = filename.endsWith('/')
      ? `${filename}sample-file.txt`
      : filename
    if (await isPathGitignored(testPath, cwd)) {
      // File is already ignored by existing patterns (local or global)
      return
    }

    // Use the global gitignore file in .config/git/ignore
    const globalGitignorePath = getGlobalGitignorePath()

    // Create the directory if it doesn't exist
    const configGitDir = dirname(globalGitignorePath)
    await mkdir(configGitDir, { recursive: true })

    // Add the entry to the global gitignore
    try {
      const content = await readFile(globalGitignorePath, { encoding: 'utf-8' })
      if (content.includes(gitignoreEntry)) {
        return // Pattern already exists, don't add again
      }
      await appendFile(globalGitignorePath, `\n${gitignoreEntry}\n`)
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        // Create global gitignore with entry
        await writeFile(globalGitignorePath, `${gitignoreEntry}\n`, 'utf-8')
      } else {
        throw e
      }
    }
  } catch (error) {
    console.error(error)
  }
}
