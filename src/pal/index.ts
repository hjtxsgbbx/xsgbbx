export { detectPlatform, getAgentDir } from "./sys.js";
export {
  shellExec,
  shellExecSync,
  adaptCommand,
  commandExists,
  sanitizeShellArg,
  validateShellCommand,
} from "./shell.js";
export type { ShellResult } from "./shell.js";
export {
  ensureDir,
  readFileSafe,
  writeFileSafe,
  fileExists,
  isDirectory,
  listFiles,
  searchInFile,
  getProjectFiles,
  setPermissions,
} from "./fs.js";
export {
  keychainGet,
  keychainSet,
  keychainDelete,
  storeApiKeyInMemory,
  getApiKeyFromMemory,
  clearApiKeyFromMemory,
  clearAllApiKeys,
} from "./keychain.js";