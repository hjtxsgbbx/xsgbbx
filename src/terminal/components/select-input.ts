/**
 * Select Input component — dropdown select with keyboard navigation.
 * Pure function that returns a VNode.
 */

import type { VNode } from '../ink/virtual-tree.js';
import { createElement, fragment } from '../ink/virtual-tree.js';
import type { SelectElement } from '../ink/dom.js';
import { Box } from './box.js';
import { Text } from './text.js';

export interface SelectInputProps {
  /** List of selectable items */
  readonly items: readonly string[];
  /** Index of the currently selected item, or -1 */
  readonly selectedIndex?: number;
  /** Whether this select has focus (accepts keyboard input) */
  readonly focus?: boolean;
  /** Whether the dropdown is expanded (showing all options) */
  readonly expanded?: boolean;
  /** Color for the selected item highlight */
  readonly color?: string;
  /** Placeholder shown when no item is selected */
  readonly placeholder?: string;
  /** Tab index for focus ordering */
  readonly tabIndex?: number;
  /** Unique id for focus management */
  readonly id?: string;
  /** Key for diffing */
  readonly key?: string | number;
  /** Called when selection changes */
  readonly onSelect?: (index: number, item: string) => void;
}

/**
 * Create a Select VNode.
 *
 * Renders a single-line selection control.  When expanded, shows all
 * items with the selected one highlighted.  Supports keyboard navigation
 * via the usual Arrow Up / Down / Enter protocol — the caller wires
 * these in.
 */
export function SelectInput(props: SelectInputProps): VNode {
  const items = props.items;
  const selIdx = props.selectedIndex ?? -1;
  const placeholder = props.placeholder ?? 'Select...';
  const element: SelectElement = {
    tag: 'select',
    items,
    selectedIndex: selIdx,
    focus: props.focus ?? false,
    expanded: props.expanded ?? false,
    color: props.color,
    placeholder,
  };

  // Build visible children for the select
  const children: VNode[] = [];

  // Header / single-line display
  const selectedLabel = selIdx >= 0 && selIdx < items.length
    ? items[selIdx]!
    : placeholder;

  children.push(
    Box({ flexDirection: 'row' },
      Text({
        content: props.expanded ? '▴ ' : '▾ ',
        bold: props.focus,
      }),
      Text({
        content: selectedLabel,
        bold: props.focus,
        inverse: props.focus,
      }),
    ),
  );

  // Expanded dropdown items
  if (props.expanded) {
    for (let i = 0; i < items.length; i++) {
      const isSelected = i === selIdx;
      children.push(
        Text({
          content: `${isSelected ? '●' : '○'} ${items[i]!}`,
          inverse: isSelected,
          bold: isSelected,
        }),
      );
    }
  }

  return createElement(
    'ink-select',
    {
      key: props.key,
      id: props.id,
      tabIndex: props.tabIndex ?? 0,
      element,
      onSelect: props.onSelect,
    },
    ...children,
  );
}
