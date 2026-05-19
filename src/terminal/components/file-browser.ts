/**
 * File Browser component — file tree with directory expand/collapse,
 * file-type colour icons, and keyboard navigation support.
 *
 * Pure function that returns a VNode tree.
 */

import type { VNode } from '../ink/virtual-tree.js';
import { Box } from './box.js';
import { Text } from './text.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileEntry {
  readonly name: string;
  readonly path: string;
  readonly type: 'file' | 'directory';
  readonly children?: readonly FileEntry[];
  readonly expanded?: boolean;
  readonly selected?: boolean;
}

export interface FileBrowserOptions {
  readonly cwd?: string;
  readonly showHidden?: boolean;
}

// ---------------------------------------------------------------------------
// File-type colour map
// ---------------------------------------------------------------------------

const EXT_COLORS: Record<string, string> = {
  ts: 'ansi:blue', tsx: 'ansi:blueBright', js: 'ansi:yellow', jsx: 'ansi:yellowBright',
  json: 'ansi:yellow', md: 'ansi:green', css: 'ansi:cyan', html: 'ansi:redBright',
  py: 'ansi:green', rs: 'ansi:red', go: 'ansi:cyanBright', java: 'ansi:red',
  yml: 'ansi:magenta', yaml: 'ansi:magenta', toml: 'ansi:magenta',
  gitignore: 'ansi:blackBright', env: 'ansi:blackBright', lock: 'ansi:blackBright',
  svg: 'ansi:cyan', png: 'ansi:magenta', jpg: 'ansi:magenta', gif: 'ansi:magenta',
  sh: 'ansi:green', bash: 'ansi:green', sql: 'ansi:blue',
  graphql: 'ansi:magentaBright', vue: 'ansi:green', svelte: 'ansi:redBright',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderFileTree(
  files: readonly FileEntry[],
  opts: FileBrowserOptions = {},
): VNode {
  const children: VNode[] = [];
  if (opts.cwd) {
    children.push(Text({ content: ` ${opts.cwd}`, bold: true }));
  }
  for (let i = 0; i < files.length; i++) {
    children.push(renderEntry(files[i]!, 0, i === files.length - 1));
  }
  return Box({ flexDirection: 'column', padding: 0 }, ...children);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function renderEntry(
  entry: FileEntry,
  depth: number,
  isLast: boolean,
): VNode {
  const indent = treeIndent(depth, isLast);
  const icon = entry.type !== 'directory' ? '●' : (entry.expanded ? '▼' : '▶');
  const entryColor = entry.type === 'directory' ? 'ansi:blue' : fileColor(entry.name);
  const selectedColor = entry.selected ? 'ansi:cyan' : undefined;

  const children: VNode[] = [
    Box(
      { flexDirection: 'row', padding: 0 },
      Text({ content: indent }),
      Text({ content: `${icon} `, color: entryColor }),
      Text({ content: entry.name, color: selectedColor, inverse: entry.selected, bold: entry.selected }),
    ),
  ];

  if (entry.type === 'directory' && entry.expanded) {
    const kids = entry.children ?? [];
    for (let i = 0; i < kids.length; i++) {
      children.push(renderEntry(kids[i]!, depth + 1, i === kids.length - 1));
    }
    if (kids.length === 0) {
      children.push(
        Box(
          { flexDirection: 'row', padding: 0 },
          Text({ content: treeIndent(depth + 1, true) }),
          Text({ content: '(empty)', dim: true }),
        ),
      );
    }
  }

  return Box({ flexDirection: 'column', padding: 0 }, ...children);
}

function treeIndent(depth: number, isLast: boolean): string {
  if (depth === 0) return '';
  let r = '';
  for (let d = 0; d < depth - 1; d++) r += '│  ';
  r += isLast ? '└─ ' : '├─ ';
  return r;
}

function fileColor(filename: string): string | undefined {
  const ext = filename.includes('.')
    ? filename.split('.').pop()?.toLowerCase() ?? ''
    : filename.toLowerCase();
  return EXT_COLORS[ext];
}
