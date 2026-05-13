import { execSync } from "child_process";
import { PlatformInfo } from "../types/index.js";

interface KeychainEntry {
  service: string;
  account: string;
  password: string;
}

export async function keychainGet(
  service: string,
  account: string,
  platform: PlatformInfo
): Promise<string | null> {
  try {
    if (platform.os === "windows") {
      return await windowsGet(service, account);
    } else if (platform.os === "macos") {
      return await macosGet(service, account);
    } else {
      return await linuxGet(service, account);
    }
  } catch {
    return null;
  }
}

export async function keychainSet(
  service: string,
  account: string,
  password: string,
  platform: PlatformInfo
): Promise<boolean> {
  try {
    if (platform.os === "windows") {
      return await windowsSet(service, account, password);
    } else if (platform.os === "macos") {
      return await macosSet(service, account, password);
    } else {
      return await linuxSet(service, account, password);
    }
  } catch {
    return false;
  }
}

export async function keychainDelete(
  service: string,
  account: string,
  platform: PlatformInfo
): Promise<boolean> {
  try {
    if (platform.os === "windows") {
      return await windowsDelete(service, account);
    } else if (platform.os === "macos") {
      return await macosDelete(service, account);
    } else {
      return await linuxDelete(service, account);
    }
  } catch {
    return false;
  }
}

async function windowsGet(
  service: string,
  account: string
): Promise<string | null> {
    const cmd = `powershell -Command "(Get-StoredCredential -Target '${service}_${account}').GetNetworkCredential().Password"`;
  try {
    const result = execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    return result.trim() || null;
  } catch {
    return null;
  }
}

async function windowsSet(
  service: string,
  account: string,
  password: string
): Promise<boolean> {
    const cmd = `powershell -Command "$secureString = ConvertTo-SecureString '${password}' -AsPlainText -Force; $credential = New-Object System.Management.Automation.PSCredential('${account}', $secureString); New-StoredCredential -Target '${service}_${account}' -Credential $credential -Persist LocalMachine"`;
  try {
    execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function windowsDelete(
  service: string,
  account: string
): Promise<boolean> {
    const cmd = `powershell -Command "Remove-StoredCredential -Target '${service}_${account}'"`;
  try {
    execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function macosGet(
  service: string,
  account: string
): Promise<string | null> {
    const cmd = `security find-generic-password -s "${service}" -a "${account}" -w 2>/dev/null`;
  try {
    const result = execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    return result.trim() || null;
  } catch {
    return null;
  }
}

async function macosSet(
  service: string,
  account: string,
  password: string
): Promise<boolean> {
    const cmd = `security add-generic-password -s "${service}" -a "${account}" -w "${password}" -U 2>/dev/null`;
  try {
    execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function macosDelete(
  service: string,
  account: string
): Promise<boolean> {
    const cmd = `security delete-generic-password -s "${service}" -a "${account}" 2>/dev/null`;
  try {
    execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function linuxGet(
  service: string,
  account: string
): Promise<string | null> {
  try {
        const cmd = `secret-tool lookup service "${service}" account "${account}" 2>/dev/null`;
    const result = execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    return result.trim() || null;
  } catch {
    return null;
  }
}

async function linuxSet(
  service: string,
  account: string,
  password: string
): Promise<boolean> {
  try {
        const cmd = `echo "${password}" | secret-tool store --label="agent_1" service "${service}" account "${account}" 2>/dev/null`;
    execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function linuxDelete(
  service: string,
  account: string
): Promise<boolean> {
  try {
        const cmd = `secret-tool clear service "${service}" account "${account}" 2>/dev/null`;
    execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const API_KEY_MEMORY = new Map<string, { key: string; timestamp: number }>();

export function storeApiKeyInMemory(sessionId: string, apiKey: string): void {
  API_KEY_MEMORY.set(sessionId, { key: apiKey, timestamp: Date.now() });
}

export function getApiKeyFromMemory(sessionId: string): string | undefined {
  return API_KEY_MEMORY.get(sessionId)?.key;
}

export function clearApiKeyFromMemory(sessionId: string): void {
  const existing = API_KEY_MEMORY.get(sessionId);
  if (existing) {
    existing.timestamp = 0;
    const dummy = "0".repeat(existing.key.length);
    API_KEY_MEMORY.set(sessionId, { key: dummy, timestamp: 0 });
  }
  API_KEY_MEMORY.delete(sessionId);
}

export function clearAllApiKeys(): void {
  for (const [id, entry] of API_KEY_MEMORY) {
    const dummy = "0".repeat(entry.key.length);
    API_KEY_MEMORY.set(id, { key: dummy, timestamp: 0 });
  }
  API_KEY_MEMORY.clear();
}