/**
 * Progress Bar component — determinate bars, indeterminate spinners,
 * and multi-step checklists. Pure functions returning VNodes.
 */

import type { VNode } from '../ink/virtual-tree.js';
import { Box } from './box.js';
import { Text } from './text.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StepStatus = 'pending' | 'active' | 'done' | 'error';

export interface ProgressStep {
  readonly label: string;
  readonly status: StepStatus;
}

export type ProgressOptions =
  | { readonly type: 'determinate'; readonly value: number; readonly label?: string; readonly width?: number }
  | { readonly type: 'indeterminate'; readonly label?: string; readonly width?: number }
  | { readonly type: 'steps'; readonly steps: readonly ProgressStep[]; readonly label?: string };

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let _frame = 0;

export function advanceSpinner(): void {
  _frame = (_frame + 1) % SPINNER.length;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderProgress(opts: ProgressOptions): VNode {
  const children: VNode[] = [];
  if (opts.label) {
    children.push(Text({ content: ` ${opts.label}`, bold: true, color: 'ansi:white' }));
  }
  switch (opts.type) {
    case 'determinate': children.push(renderBar(opts.value, opts.width ?? 30)); break;
    case 'indeterminate': children.push(renderSpinner(opts.width ?? 30)); break;
    case 'steps': children.push(renderChecklist(opts.steps)); break;
  }
  return Box({ flexDirection: 'column', padding: 0 }, ...children);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function renderBar(value: number, width: number): VNode {
  const clamped = Math.max(0, Math.min(100, value));
  const filled = Math.round((clamped / 100) * width);
  const color = clamped < 50 ? 'ansi:green' : clamped < 85 ? 'ansi:yellow' : 'ansi:red';
  return Box(
    { flexDirection: 'row', padding: 0 },
    Text({ content: ` [${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`, color }),
    Text({ content: ` ${clamped.toString().padStart(3)}%`, bold: true, color }),
  );
}

function renderSpinner(width: number): VNode {
  return Box(
    { flexDirection: 'row', padding: 0 },
    Text({ content: ` ${SPINNER[_frame] ?? '⠋'} `, color: 'ansi:cyan' }),
    Text({ content: `[${'░'.repeat(width)}]`, dim: true }),
  );
}

function renderChecklist(steps: readonly ProgressStep[]): VNode {
  const children: VNode[] = [];
  for (const step of steps) {
    const icon = ICONS[step.status] ?? '○';
    const color = COLORS[step.status];
    children.push(
      Box(
        { flexDirection: 'row', padding: 0 },
        Text({ content: `   ${icon} `, color, bold: step.status === 'active' }),
        Text({
          content: step.label, color,
          bold: step.status === 'active',
          dim: step.status === 'pending' || step.status === 'done',
        }),
      ),
    );
  }
  return Box({ flexDirection: 'column', padding: 0 }, ...children);
}

// ---------------------------------------------------------------------------
// Status maps
// ---------------------------------------------------------------------------

const ICONS: Record<StepStatus, string> = {
  done: '✓', active: '●', error: '✗', pending: '○',
};

const COLORS: Record<StepStatus, string | undefined> = {
  done: 'ansi:green', active: 'ansi:cyan', error: 'ansi:red', pending: 'ansi:blackBright',
};
