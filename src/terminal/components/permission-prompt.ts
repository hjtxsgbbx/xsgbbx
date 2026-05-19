/**
 * Permission Prompt component — presents a permission dialog to the user
 * with a reason for requesting access, and accept/reject options.
 * Pure function that returns a VNode.
 */

import type { VNode } from '../ink/virtual-tree.js';
import { createElement, fragment } from '../ink/virtual-tree.js';
import { Box } from './box.js';
import { Text } from './text.js';
import { TextInput } from './text-input.js';
import type { BoxElement } from '../ink/dom.js';
import { defaultBoxElement } from '../ink/dom.js';

export interface PermissionPromptProps {
  /** The permission being requested (e.g. "filesystem.read") */
  readonly permission: string;
  /** Human-readable reason for requesting this permission */
  readonly reason: string;
  /** Available actions the user can take */
  readonly actions?: readonly PermissionAction[];
  /** Key for diffing */
  readonly key?: string | number;
  /** Whether this prompt is currently focused */
  readonly focused?: boolean;
}

export interface PermissionAction {
  readonly key: string;
  readonly label: string;
  readonly shortcut?: string;
}

const DEFAULT_ACTIONS: readonly PermissionAction[] = [
  { key: 'allow', label: 'Allow', shortcut: 'y' },
  { key: 'deny', label: 'Deny', shortcut: 'n' },
];

/**
 * Render a permission prompt dialog.
 *
 * Produces a bordered box with the permission name, a human-readable
 * reason, and action buttons.
 */
export function PermissionPrompt(props: PermissionPromptProps): VNode {
  const actions = props.actions ?? DEFAULT_ACTIONS;

  const titleEl: BoxElement = defaultBoxElement({
    borderStyle: 'single',
    padding: 1,
    backgroundColor: props.focused ? undefined : undefined,
  });

  const promptContent = [
    Text({
      content: `Permission required: ${props.permission}`,
      bold: true,
      color: 'ansi:yellow',
    }),
    Text({ content: '' }),
    Text({ content: props.reason, dim: true }),
    Text({ content: '' }),
    Text({
      content: actions
        .map((a) => `${a.label} [${a.shortcut ?? a.key}]`)
        .join('  '),
      color: 'ansi:cyan',
      bold: true,
    }),
    TextInput({
      placeholder: 'Type your response...',
      focus: props.focused ?? false,
      onSubmit: () => undefined,
      maxLength: 128,
    }),
  ];

  return createElement(
    'ink-permission-prompt',
    {
      key: props.key,
      permission: props.permission,
      element: titleEl,
    },
    Box({
      borderStyle: 'single',
      padding: 1,
    }, ...promptContent),
  );
}
