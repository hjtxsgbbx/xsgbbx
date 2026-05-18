/**
 * Team Helpers — Directory Structure & Metadata Management
 *
 * Teams are persisted under ~/.agent_1/teams/{teamName}/.
 *
 * Directory layout:
 *   ~/.agent_1/teams/
 *     {teamName}/
 *       team.json          — TeamMetadata (lead agent, creation time, members)
 *       inboxes/
 *         {agentName}.json — Teammate mailbox (see teammate-mailbox.ts)
 *       logs/
 *         {agentName}.log  — Optional debug/audit logs
 *
 * All file operations use synchronous fs calls (teams are small metadata
 * files, not large data stores). Atomic writes via temp-file + rename
 * are used for team.json to prevent corruption.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { TeamMetadata, TeamMemberEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const AGENT_1_HOME = path.join(os.homedir(), ".agent_1");
const TEAMS_DIR = path.join(AGENT_1_HOME, "teams");

function teamDir(teamName: string): string {
  return path.join(TEAMS_DIR, teamName);
}

function teamFilePath(teamName: string): string {
  return path.join(teamDir(teamName), "team.json");
}

function inboxesDir(teamName: string): string {
  return path.join(teamDir(teamName), "inboxes");
}

function logsDir(teamName: string): string {
  return path.join(teamDir(teamName), "logs");
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);

  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${Date.now()}.tmp`,
  );

  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup failure.
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Team CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new team with the given name and lead agent.
 *
 * Creates the directory structure and writes the initial team.json.
 * If the team already exists, it returns the existing metadata without
 * overwriting (idempotent).
 *
 * @param teamName    - Unique team identifier.
 * @param leadAgentId - Agent ID of the team leader.
 * @returns The team metadata (new or existing).
 */
export function createTeam(
  teamName: string,
  leadAgentId: string,
): TeamMetadata {
  const filePath = teamFilePath(teamName);

  // If team already exists, return existing metadata
  const existing = readTeamFile(teamName);
  if (existing) return existing;

  const now = new Date().toISOString();

  const metadata: TeamMetadata = {
    teamName,
    leadAgentId,
    createdAt: now,
    updatedAt: now,
    members: [],
  };

  ensureDir(teamDir(teamName));
  ensureDir(inboxesDir(teamName));
  ensureDir(logsDir(teamName));

  atomicWriteJson(filePath, metadata);
  return metadata;
}

/**
 * Read team metadata from disk.
 *
 * @param teamName - Team identifier.
 * @returns TeamMetadata or undefined if the team does not exist.
 */
export function readTeamFile(teamName: string): TeamMetadata | undefined {
  const filePath = teamFilePath(teamName);

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    // Basic validation
    if (!parsed.teamName || !parsed.leadAgentId) {
      return undefined;
    }

    return {
      teamName: parsed.teamName,
      leadAgentId: parsed.leadAgentId,
      createdAt: parsed.createdAt ?? new Date(0).toISOString(),
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      members: Array.isArray(parsed.members) ? parsed.members : [],
    };
  } catch {
    return undefined;
  }
}

/**
 * Write (update) team metadata to disk.
 *
 * @param teamName - Team identifier.
 * @param data     - Updated metadata.
 */
export function writeTeamFile(
  teamName: string,
  data: TeamMetadata,
): void {
  const filePath = teamFilePath(teamName);
  ensureDir(teamDir(teamName));

  data.updatedAt = new Date().toISOString();
  atomicWriteJson(filePath, data);
}

/**
 * Delete a team and all its data (inboxes, logs, metadata).
 *
 * @param teamName - Team identifier.
 */
export function deleteTeam(teamName: string): void {
  const dir = teamDir(teamName);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Directory may not exist — that's fine.
  }
}

/**
 * Check if a team exists.
 */
export function teamExists(teamName: string): boolean {
  const filePath = teamFilePath(teamName);
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all team names on disk.
 */
export function listTeams(): string[] {
  try {
    const entries = fs.readdirSync(TEAMS_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Member Management
// ---------------------------------------------------------------------------

/**
 * List all active members of a team.
 *
 * @param teamName - Team identifier.
 * @returns Array of active member entries.
 */
export function listTeamMembers(teamName: string): TeamMemberEntry[] {
  const metadata = readTeamFile(teamName);
  if (!metadata) return [];
  return metadata.members;
}

/**
 * List only active (non-terminated) team members.
 */
export function listActiveMembers(teamName: string): TeamMemberEntry[] {
  return listTeamMembers(teamName).filter((m) => m.active);
}

/**
 * Add a member to a team. If the member already exists (by agentId),
 * their entry is updated.
 *
 * @param teamName - Team identifier.
 * @param member   - Member entry to add or update.
 */
export function addTeamMember(
  teamName: string,
  member: TeamMemberEntry,
): void {
  const metadata = readTeamFile(teamName);
  if (!metadata) {
    throw new Error(`Team not found: ${teamName}`);
  }

  const existingIndex = metadata.members.findIndex(
    (m) => m.agentId === member.agentId,
  );

  const entry: TeamMemberEntry = {
    ...member,
    joinedAt: member.joinedAt ?? new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    metadata.members[existingIndex] = entry;
  } else {
    metadata.members.push(entry);
  }

  writeTeamFile(teamName, metadata);
}

/**
 * Remove a member from a team by agent ID.
 *
 * @param teamName - Team identifier.
 * @param agentId  - Agent ID to remove.
 */
export function removeTeamMember(
  teamName: string,
  agentId: string,
): void {
  const metadata = readTeamFile(teamName);
  if (!metadata) return;

  metadata.members = metadata.members.filter(
    (m) => m.agentId !== agentId,
  );

  writeTeamFile(teamName, metadata);
}

/**
 * Set a member's active status.
 *
 * @param teamName - Team identifier.
 * @param agentId  - Agent ID to update.
 * @param active   - New active status.
 */
export function setMemberActive(
  teamName: string,
  agentId: string,
  active: boolean,
): void {
  const metadata = readTeamFile(teamName);
  if (!metadata) {
    throw new Error(`Team not found: ${teamName}`);
  }

  const member = metadata.members.find((m) => m.agentId === agentId);
  if (!member) {
    throw new Error(
      `Member not found: ${agentId} in team ${teamName}`,
    );
  }

  member.active = active;
  writeTeamFile(teamName, metadata);
}

/**
 * Get a specific team member by agent ID.
 */
export function getTeamMember(
  teamName: string,
  agentId: string,
): TeamMemberEntry | undefined {
  const members = listTeamMembers(teamName);
  return members.find((m) => m.agentId === agentId);
}

// ---------------------------------------------------------------------------
// Logging Helper
// ---------------------------------------------------------------------------

/**
 * Append a line to a teammate's log file.
 * Non-critical: failures are silently ignored.
 *
 * @param teamName  - Team identifier.
 * @param agentName - Agent name.
 * @param line      - Log line to append.
 */
export function appendTeammateLog(
  teamName: string,
  agentName: string,
  line: string,
): void {
  try {
    const dir = logsDir(teamName);
    ensureDir(dir);
    const logPath = path.join(dir, `${agentName}.log`);
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${line}\n`, "utf-8");
  } catch {
    // Logging failures are non-critical.
  }
}
