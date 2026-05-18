/**
 * Teammate Mailbox — File-Based Async Messaging
 *
 * Each teammate gets a JSON inbox file at:
 *   ~/.agent_1/teams/{teamName}/inboxes/{agentName}.json
 *
 * Messages are appended atomically (write to temp file, then rename).
 * File locking is handled via the atomic rename — on Windows, rename
 * replaces the destination, and on POSIX it is atomic by spec.
 *
 * Message types:
 *   permission_request, permission_response, task_assignment,
 *   idle_notification, shutdown_request
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import type { TeammateMessage, TeammateMessageType } from "./types.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const AGENT_1_HOME = path.join(os.homedir(), ".agent_1");

function inboxPath(teamName: string, agentName: string): string {
  return path.join(AGENT_1_HOME, "teams", teamName, "inboxes", `${agentName}.json`);
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

// ---------------------------------------------------------------------------
// Internal: read/write helpers
// ---------------------------------------------------------------------------

interface MailboxEntry {
  messages: TeammateMessage[];
  lastAccessed: string;
}

function readMailboxFile(filePath: string): MailboxEntry {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      lastAccessed: parsed.lastAccessed ?? new Date(0).toISOString(),
    };
  } catch {
    return { messages: [], lastAccessed: new Date(0).toISOString() };
  }
}

/**
 * Atomic write: write to a temp file, then rename over the target.
 * This prevents partial writes and torn reads.
 */
function atomicWrite(filePath: string, data: MailboxEntry): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);

  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${randomUUID().slice(0, 8)}.tmp`,
  );

  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Clean up temp file on failure
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Temp file may not exist — ignore.
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Append a message to a teammate's inbox.
 *
 * Uses atomic write (temp file + rename) for safety. On concurrent writes
 * from multiple teammates, the last writer wins — which is acceptable for
 * an append-only message log in a single-process in-process backend.
 *
 * @param teamName  - Team identifier.
 * @param agentName - Agent name (the receiver).
 * @param message   - The message to deliver (timestamp set if missing).
 */
export function writeToMailbox(
  teamName: string,
  agentName: string,
  message: TeammateMessage,
): void {
  const filePath = inboxPath(teamName, agentName);
  const mailbox = readMailboxFile(filePath);

  // Set timestamp and read flag if not provided
  const enriched: TeammateMessage = {
    ...message,
    timestamp: message.timestamp ?? new Date().toISOString(),
    read: message.read ?? false,
  };

  mailbox.messages.push(enriched);
  mailbox.lastAccessed = new Date().toISOString();

  atomicWrite(filePath, mailbox);
}

/**
 * Read all messages from a teammate's inbox.
 *
 * @param teamName  - Team identifier.
 * @param agentName - Agent name (the receiver).
 * @param since     - Optional ISO timestamp; only messages after this are returned.
 * @returns Array of messages, newest last.
 */
export function readMailbox(
  teamName: string,
  agentName: string,
  since?: string,
): TeammateMessage[] {
  const filePath = inboxPath(teamName, agentName);
  const mailbox = readMailboxFile(filePath);

  let messages = mailbox.messages;

  if (since) {
    const sinceTime = new Date(since).getTime();
    messages = messages.filter((m) => {
      const msgTime = m.timestamp ? new Date(m.timestamp).getTime() : 0;
      return msgTime > sinceTime;
    });
  }

  return messages;
}

/**
 * Read only unread messages from a teammate's inbox.
 */
export function readUnread(
  teamName: string,
  agentName: string,
): TeammateMessage[] {
  const filePath = inboxPath(teamName, agentName);
  const mailbox = readMailboxFile(filePath);
  return mailbox.messages.filter((m) => !m.read);
}

/**
 * Mark a specific message as read by its index in the inbox array.
 *
 * @param teamName     - Team identifier.
 * @param agentName    - Agent name.
 * @param messageIndex - Zero-based index of the message to mark.
 */
export function markRead(
  teamName: string,
  agentName: string,
  messageIndex: number,
): void {
  const filePath = inboxPath(teamName, agentName);
  const mailbox = readMailboxFile(filePath);

  if (messageIndex >= 0 && messageIndex < mailbox.messages.length) {
    mailbox.messages[messageIndex].read = true;
    mailbox.lastAccessed = new Date().toISOString();
    atomicWrite(filePath, mailbox);
  }
}

/**
 * Mark all messages in an inbox as read.
 */
export function markAllRead(teamName: string, agentName: string): void {
  const filePath = inboxPath(teamName, agentName);
  const mailbox = readMailboxFile(filePath);

  let changed = false;
  for (const msg of mailbox.messages) {
    if (!msg.read) {
      msg.read = true;
      changed = true;
    }
  }

  if (changed) {
    mailbox.lastAccessed = new Date().toISOString();
    atomicWrite(filePath, mailbox);
  }
}

/**
 * Count unread messages in an inbox.
 */
export function unreadCount(teamName: string, agentName: string): number {
  const filePath = inboxPath(teamName, agentName);
  const mailbox = readMailboxFile(filePath);
  return mailbox.messages.filter((m) => !m.read).length;
}

/**
 * Delete a teammate's inbox file entirely.
 */
export function deleteMailbox(teamName: string, agentName: string): void {
  const filePath = inboxPath(teamName, agentName);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may not exist — that's fine.
  }
}

// ---------------------------------------------------------------------------
// Convenience: typed message builders
// ---------------------------------------------------------------------------

/**
 * Build a permission_request message from a teammate to the leader.
 */
export function buildPermissionRequest(
  from: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  reason: string,
): TeammateMessage {
  return {
    text: `Permission requested for tool "${toolName}": ${reason}`,
    from,
    to: "leader",
    type: "permission_request",
    timestamp: new Date().toISOString(),
    summary: `[PERM] ${from} wants to run ${toolName}`,
    metadata: { toolName, toolArgs, reason },
  };
}

/**
 * Build a permission_response message from the leader to a teammate.
 */
export function buildPermissionResponse(
  from: string,
  to: string,
  granted: boolean,
  reason?: string,
): TeammateMessage {
  return {
    text: granted
      ? `Permission granted.`
      : `Permission denied${reason ? `: ${reason}` : "."}`,
    from,
    to,
    type: "permission_response",
    timestamp: new Date().toISOString(),
    summary: `[PERM] ${from} → ${to}: ${granted ? "GRANTED" : "DENIED"}`,
    metadata: { granted, reason },
  };
}

/**
 * Build a task_assignment message from the leader to a teammate.
 */
export function buildTaskAssignment(
  from: string,
  to: string,
  task: string,
): TeammateMessage {
  return {
    text: task,
    from,
    to,
    type: "task_assignment",
    timestamp: new Date().toISOString(),
    summary: `[TASK] ${from} → ${to}: ${task.slice(0, 80)}`,
    metadata: { task },
  };
}

/**
 * Build a shutdown_request message.
 */
export function buildShutdownRequest(
  from: string,
  to: string,
  reason?: string,
): TeammateMessage {
  return {
    text: reason ?? "Shutdown requested.",
    from,
    to,
    type: "shutdown_request",
    timestamp: new Date().toISOString(),
    summary: `[SHUTDOWN] ${from} → ${to}`,
    metadata: { reason },
  };
}

/**
 * Build an idle_notification from a teammate indicating it is waiting.
 */
export function buildIdleNotification(
  from: string,
): TeammateMessage {
  return {
    text: `Teammate "${from}" is idle and waiting for instructions.`,
    from,
    to: "leader",
    type: "idle_notification",
    timestamp: new Date().toISOString(),
    summary: `[IDLE] ${from} is waiting`,
  };
}

/**
 * Build a status_update message.
 */
export function buildStatusUpdate(
  from: string,
  status: string,
  detail?: string,
): TeammateMessage {
  return {
    text: detail ?? `Status: ${status}`,
    from,
    to: "leader",
    type: "status_update",
    timestamp: new Date().toISOString(),
    summary: `[STATUS] ${from}: ${status}`,
    metadata: { status, detail },
  };
}
