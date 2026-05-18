/**
 * Memory Type Taxonomy — 4 categories, modeled after Claude Code's validated design.
 *
 * Memories are constrained to context NOT derivable from current project state.
 * Code patterns, architecture, git history, and file structure are derivable
 * and should NOT be saved as memories.
 */

export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** Parse frontmatter `type:` field into MemoryType */
export function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== "string") return undefined;
  return MEMORY_TYPES.find((t) => t === raw);
}

// ============================================================================
// System Prompt Sections — injected into the agent's context
// ============================================================================

/** The MEMORY.md entrypoint name */
export const ENTRYPOINT_NAME = "MEMORY.md";
/** Max lines in MEMORY.md before truncation */
export const MAX_ENTRYPOINT_LINES = 200;
/** Max bytes in MEMORY.md before truncation */
export const MAX_ENTRYPOINT_BYTES = 25_000;

/** Guidance that the memory directory already exists */
export const DIR_EXISTS_GUIDANCE =
  "This directory already exists — write to it directly with the Write tool (do not run mkdir or check for its existence).";

// ---------------------------------------------------------------------------
// Types of Memory section
// ---------------------------------------------------------------------------

export const TYPES_OF_MEMORY = `## Types of memory

There are several discrete types of memory that you can store in your memory system:

<types>
<type>
    <name>user</name>
    <description>Contain information about the user's role, goals, responsibilities, and knowledge. Great user memories help you tailor your future behavior to the user's preferences and perspective. Your goal in reading and writing these memories is to build up an understanding of who the user is and how you can be most helpful to them specifically. For example, you should collaborate with a senior software engineer differently than a student who is coding for the very first time.</description>
    <when_to_save>When you learn any details about the user's role, preferences, responsibilities, or knowledge</when_to_save>
    <how_to_use>When your work should be informed by the user's profile or perspective.</how_to_use>
    <examples>
    user: I'm a data scientist investigating what logging we have in place
    assistant: [saves user memory: user is a data scientist, currently focused on observability/logging]

    user: I've been writing Go for ten years but this is my first time touching the React side of this repo
    assistant: [saves user memory: deep Go expertise, new to React — frame frontend explanations in terms of backend analogues]
    </examples>
</type>
<type>
    <name>feedback</name>
    <description>Guidance the user has given you about how to approach work — both what to avoid and what to keep doing. Record from failure AND success: if you only save corrections, you will avoid past mistakes but drift away from approaches the user has already validated.</description>
    <when_to_save>Any time the user corrects your approach ("no not that", "don't", "stop doing X") OR confirms a non-obvious approach worked ("yes exactly", "perfect, keep doing that"). Include *why* so you can judge edge cases later.</when_to_save>
    <how_to_use>Let these memories guide your behavior so the user does not need to offer the same guidance twice.</how_to_use>
    <body_structure>Lead with the rule itself, then a **Why:** line and a **How to apply:** line. Knowing *why* lets you judge edge cases.</body_structure>
    <examples>
    user: don't mock the database in these tests — we got burned last quarter when mocked tests passed but the prod migration failed
    assistant: [saves feedback: integration tests must hit a real database, not mocks. Why: prior incident where mock/prod divergence masked a broken migration]

    user: stop summarizing what you just did at the end of every response, I can read the diff
    assistant: [saves feedback: this user wants terse responses with no trailing summaries]
    </examples>
</type>
<type>
    <name>project</name>
    <description>Information about ongoing work, goals, initiatives, bugs, or incidents within the project that is not derivable from the code or git history. Project memories help you understand the broader context and motivation behind the work.</description>
    <when_to_save>When you learn who is doing what, why, or by when. Always convert relative dates to absolute dates (e.g., "Thursday" → "2026-05-17").</when_to_save>
    <how_to_use>Use these memories to understand the details behind the user's request and make better informed suggestions.</how_to_use>
    <body_structure>Lead with the fact, then a **Why:** line and a **How to apply:** line. Project memories decay fast, so the why helps future-you judge relevance.</body_structure>
    <examples>
    user: we're freezing all non-critical merges after Thursday — mobile team is cutting a release branch
    assistant: [saves project: merge freeze begins 2026-05-20 for mobile release cut. Flag any non-critical PR work after that date]

    user: the reason we're ripping out the old auth middleware is that legal flagged it for storing session tokens in a way that doesn't meet the new compliance requirements
    assistant: [saves project: auth middleware rewrite is driven by legal/compliance requirements, not tech-debt cleanup — scope decisions should favor compliance over ergonomics]
    </examples>
</type>
<type>
    <name>reference</name>
    <description>Stores pointers to where information can be found in external systems. These memories allow you to remember where to look for up-to-date information outside of the project directory.</description>
    <when_to_save>When you learn about resources in external systems and their purpose. For example, that bugs are tracked in a specific Linear project or feedback can be found in a specific Slack channel.</when_to_save>
    <how_to_use>When the user references an external system or information that may be in an external system.</how_to_use>
    <examples>
    user: check the Linear project "INGEST" if you want context on these tickets, that's where we track all pipeline bugs
    assistant: [saves reference: pipeline bugs are tracked in Linear project "INGEST"]

    user: the Grafana board at grafana.internal/d/api-latency is what oncall watches — if you're touching request handling, that's the thing that'll page someone
    assistant: [saves reference: grafana.internal/d/api-latency is the oncall latency dashboard — check it when editing request-path code]
    </examples>
</type>
</types>`;

// ---------------------------------------------------------------------------
// What NOT to Save section
// ---------------------------------------------------------------------------

export const WHAT_NOT_TO_SAVE = `## What NOT to save

- Code patterns, conventions, architecture, file paths, or project structure — these can be derived by reading the current project state.
- Git history, recent changes, or who-changed-what — \`git log\` / \`git blame\` are authoritative.
- Debugging solutions or fix recipes — the fix is in the code; the commit message has the context.
- Anything already documented in xsgbbx.md files.
- Ephemeral task details: in-progress work, temporary state, current conversation context.

These exclusions apply even when the user explicitly asks you to save. If they ask you to save a PR list or activity summary, ask what was *surprising* or *non-obvious* about it — that is the part worth keeping.`;

// ---------------------------------------------------------------------------
// How to Save section
// ---------------------------------------------------------------------------

export function buildHowToSaveSection(memoryDir: string): string {
  return `## How to save memories

Saving a memory is a two-step process:

**Step 1** — write the memory to its own file (e.g., \`user_role.md\`, \`feedback_testing.md\`) using this frontmatter format:

\`\`\`markdown
---
name: {{memory name}}
description: {{one-line description — used to decide relevance in future conversations, so be specific}}
type: {{user, feedback, project, reference}}
---

{{memory content — for feedback/project types, structure as: rule/fact, then **Why:** and **How to apply:** lines}}
\`\`\`

**Step 2** — add a pointer to that file in \`${ENTRYPOINT_NAME}\`. \`${ENTRYPOINT_NAME}\` is an index, not a memory — each entry should be one line, under ~150 characters: \`- [Title](file.md) — one-line hook\`. It has no frontmatter. Never write memory content directly into \`${ENTRYPOINT_NAME}\`.

- \`${ENTRYPOINT_NAME}\` is always loaded into your conversation context — lines after ${MAX_ENTRYPOINT_LINES} will be truncated, so keep the index concise
- Keep the name, description, and type fields in memory files up-to-date with the content
- Organize memory semantically by topic, not chronologically
- Update or remove memories that turn out to be wrong or outdated
- Do not write duplicate memories. First check if there is an existing memory you can update before writing a new one.`;
}

// ---------------------------------------------------------------------------
// When to Access section
// ---------------------------------------------------------------------------

export const WHEN_TO_ACCESS = `## When to access memories

- When memories seem relevant, or the user references prior-conversation work.
- You MUST access memory when the user explicitly asks you to check, recall, or remember.
- Memory records can become stale over time. Use memory as context for what was true at a given point in time. If a recalled memory conflicts with current information, trust what you observe now — and update or remove the stale memory.
- Before recommending from memory, verify — a memory that names a specific file or function may refer to something that has since been renamed, removed, or never merged.`;

// ---------------------------------------------------------------------------
// Build full memory prompt
// ---------------------------------------------------------------------------

export function buildMemorySystemPrompt(memoryDir: string): string {
  const sections = [
    `# Auto Memory`,
    "",
    `You have a persistent, file-based memory system at \`${memoryDir}\`. ${DIR_EXISTS_GUIDANCE}`,
    "",
    "You should build up this memory system over time so that future conversations can have a complete picture of who the user is, how they'd like to collaborate with you, what behaviors to avoid or repeat, and the context behind the work the user gives you.",
    "",
    "If the user explicitly asks you to remember something, save it immediately as whichever type fits best. If they ask you to forget something, find and remove the relevant entry.",
    "",
    TYPES_OF_MEMORY,
    WHAT_NOT_TO_SAVE,
    "",
    buildHowToSaveSection(memoryDir),
    "",
    WHEN_TO_ACCESS,
    "",
    "## Memory and other forms of persistence",
    "Memory is one of several persistence mechanisms. The distinction: memory can be recalled in future conversations and should not be used for persisting information that is only useful within the scope of the current conversation.",
    "- Use a Plan for non-trivial implementation tasks needing alignment, not memory.",
    "- Use Tasks for tracking work in the current conversation, not memory.",
    "- Memory = information useful across future sessions.",
  ];

  return sections.join("\n");
}
