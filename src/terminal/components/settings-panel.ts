/**
 * Settings Panel component — displays and allows editing of
 * configuration settings organised by section.
 *
 * Pure function that returns a VNode tree.
 */

import type { VNode } from '../ink/virtual-tree.js';
import { Box } from './box.js';
import { Text } from './text.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SettingsField {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly type: 'boolean' | 'string' | 'enum';
  readonly value: string | boolean;
  readonly options?: readonly string[];
}

export interface SettingsSection {
  readonly title: string;
  readonly fields: readonly SettingsField[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render settings sections as a VNode tree.
 *
 * Each section has a header, and each field displays its key, value,
 * type indicator, and optional description.  Boolean fields show a
 * toggle state; string fields show the value; enum fields show the
 * selected option.
 */
export function renderSettings(
  sections: readonly SettingsSection[],
): VNode {
  const children: VNode[] = [
    Text({
      content: ' Settings',
      bold: true,
      color: 'ansi:white',
    }),
    Text({ content: '' }),
  ];

  for (const section of sections) {
    children.push(renderSection(section));
  }

  return Box(
    {
      flexDirection: 'column',
      padding: 1,
      margin: 0,
      borderStyle: 'single',
    },
    ...children,
  );
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function renderSection(section: SettingsSection): VNode {
  const children: VNode[] = [
    Text({
      content: ` ${section.title}`,
      bold: true,
      color: 'ansi:cyan',
      underline: true,
    }),
  ];

  for (const field of section.fields) {
    children.push(renderField(field));
  }

  children.push(Text({ content: '' }));

  return Box(
    {
      flexDirection: 'column',
      padding: 0,
      margin: 0,
    },
    ...children,
  );
}

function renderField(field: SettingsField): VNode {
  const children: VNode[] = [
    // Key-value row
    Box(
      { flexDirection: 'row', padding: 0 },
      Text({
        content: `  ${field.label}`,
        bold: true,
      }),
      Text({
        content: `  ${formatValue(field)}`,
        color: valueColor(field),
      }),
    ),
    // Type badge
    Box(
      { flexDirection: 'row', padding: 0 },
      Text({
        content: `    [${field.type}]`,
        dim: true,
      }),
    ),
  ];

  // Description
  if (field.description) {
    children.push(
      Text({
        content: `    ${field.description}`,
        dim: true,
      }),
    );
  }

  return Box(
    {
      flexDirection: 'column',
      padding: 0,
      margin: 0,
    },
    ...children,
  );
}

function formatValue(field: SettingsField): string {
  switch (field.type) {
    case 'boolean':
      return field.value ? 'on' : 'off';
    case 'enum':
      return `[${String(field.value)}]`;
    case 'string':
      return String(field.value);
    default:
      return String(field.value);
  }
}

function valueColor(field: SettingsField): string | undefined {
  switch (field.type) {
    case 'boolean':
      return field.value ? 'ansi:green' : 'ansi:red';
    case 'string':
      return field.value ? 'ansi:yellow' : 'ansi:blackBright';
    case 'enum':
      return 'ansi:magenta';
    default:
      return undefined;
  }
}
