/**
 * Text Input component — line-editing input with cursor and validation.
 * Pure function that returns a VNode.
 */

import type { VNode } from '../ink/virtual-tree.js';
import { createElement, fragment } from '../ink/virtual-tree.js';
import type { InputElement } from '../ink/dom.js';
import { Box } from './box.js';
import { Text } from './text.js';

export interface TextInputProps {
  /** Current input value */
  readonly value?: string;
  /** Placeholder text shown when value is empty */
  readonly placeholder?: string;
  /** Current cursor offset within the value (character index) */
  readonly cursorOffset?: number;
  /** Whether this input is focused */
  readonly focus?: boolean;
  /** Color for the text */
  readonly color?: string;
  /** Show invalid state styling */
  readonly invalid?: boolean;
  /** Error message to display below the input */
  readonly errorMessage?: string;
  /** Maximum input length */
  readonly maxLength?: number;
  /** Tab index for focus ordering */
  readonly tabIndex?: number;
  /** Unique id for focus management */
  readonly id?: string;
  /** Label displayed before the input */
  readonly label?: string;
  /** Key for diffing */
  readonly key?: string | number;
  /** Called when the user submits (Enter) */
  readonly onSubmit?: (value: string) => void;
  /** Called when the value changes */
  readonly onChange?: (value: string) => void;
}

/**
 * Create a TextInput VNode.
 *
 * Renders a single-line text input with a cursor indicator, optional
 * label, and validation error display.
 */
export function TextInput(props: TextInputProps): VNode {
  const value = props.value ?? '';
  const placeholder = props.placeholder ?? '';
  const cursorOffset = props.cursorOffset ?? value.length;
  const element: InputElement = {
    tag: 'input',
    value,
    placeholder,
    cursorOffset,
    focus: props.focus ?? false,
    color: props.color,
    invalid: props.invalid ?? false,
    maxLength: props.maxLength ?? 1024,
  };

  // Build display string with cursor
  const displayValue = value || placeholder;
  const before = displayValue.slice(0, cursorOffset);
  const at = displayValue[cursorOffset] ?? ' ';
  const after = displayValue.slice(cursorOffset + 1);

  const children: VNode[] = [];

  if (props.label) {
    children.push(
      Text({
        content: props.label,
        dim: !props.focus,
        bold: props.focus,
      }),
    );
  }

  // Input row
  children.push(
    Box({ flexDirection: 'row' },
      Text({
        content: '> ',
        bold: props.focus,
        color: props.invalid ? 'ansi:red' : props.color,
      }),
      Text({
        content: before,
        color: props.color,
      }),
      Text({
        content: at,
        inverse: props.focus,
        color: props.color,
      }),
      Text({
        content: after,
        dim: !value,
        color: props.color,
      }),
    ),
  );

  // Error message
  if (props.invalid && props.errorMessage) {
    children.push(
      Text({
        content: props.errorMessage,
        color: 'ansi:red',
      }),
    );
  }

  return createElement(
    'ink-input',
    {
      key: props.key,
      id: props.id,
      tabIndex: props.tabIndex ?? 0,
      element,
      label: props.label,
      onSubmit: props.onSubmit,
      onChange: props.onChange,
    },
    ...children,
  );
}
