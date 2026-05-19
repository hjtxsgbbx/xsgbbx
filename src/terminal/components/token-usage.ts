/**
 * Token Usage component — compact bar showing context window usage,
 * input/output breakdown, and cost estimates.
 *
 * Pure function that returns a VNode tree.
 */

import type { VNode } from '../ink/virtual-tree.js';
import { Box } from './box.js';
import { Text } from './text.js';
import type { TokenUsage } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Model pricing (USD per 1M tokens, as of 2025)
// ---------------------------------------------------------------------------

interface ModelPricing {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
}

const PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0, cacheRead: 0.3 },
  'claude-opus-4-20250514': { input: 15.0, output: 75.0, cacheRead: 1.5 },
  'claude-haiku-4-20250514': { input: 0.8, output: 4.0, cacheRead: 0.08 },
  'deepseek-v4-pro': { input: 1.2, output: 4.8 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a compact token-usage bar showing context-window usage
 * percentage, input/output breakdown, and cost estimate.
 */
export function renderTokenUsage(
  usage: TokenUsage,
  model: string,
): VNode {
  const pct = usage.limit > 0 ? Math.round((usage.total / usage.limit) * 100) : 0;
  const barWidth = 20;
  const filled = Math.round((Math.min(pct, 100) / 100) * barWidth);
  const empty = barWidth - filled;
  const barColor = pct < 50 ? 'ansi:green' : pct < 85 ? 'ansi:yellow' : 'ansi:red';

  const children: VNode[] = [
    // Header
    Box(
      { flexDirection: 'row', padding: 0 },
      Text({
        content: ' Tokens: ',
        bold: true,
      }),
      Text({
        content: `${usage.total.toLocaleString()} / ${usage.limit.toLocaleString()}`,
      }),
      Text({
        content: `  (${pct}%)`,
        color: barColor,
        bold: pct > 85,
      }),
    ),
    // Usage bar
    Box(
      { flexDirection: 'row', padding: 0 },
      Text({ content: ' ' }),
      Text({
        content: '█'.repeat(filled),
        color: barColor,
      }),
      Text({
        content: '░'.repeat(empty),
        dim: true,
      }),
    ),
    // Breakdown
    Box(
      { flexDirection: 'row', padding: 0 },
      Text({
        content: `  Input: ${usage.input.toLocaleString()}`,
        dim: true,
      }),
      Text({
        content: `  Output: ${usage.output.toLocaleString()}`,
        dim: true,
      }),
    ),
  ];

  // Cache info
  if (usage.cacheRead !== undefined && usage.cacheRead > 0) {
    children.push(
      Box(
        { flexDirection: 'row', padding: 0 },
        Text({
          content: `  Cache read: ${usage.cacheRead.toLocaleString()}`,
          dim: true,
          color: 'ansi:green',
        }),
      ),
    );
  }

  if (usage.cacheCreation !== undefined && usage.cacheCreation > 0) {
    children.push(
      Box(
        { flexDirection: 'row', padding: 0 },
        Text({
          content: `  Cache write: ${usage.cacheCreation.toLocaleString()}`,
          dim: true,
        }),
      ),
    );
  }

  // Cost estimate
  const pricing = findPricing(model);
  if (pricing) {
    const cost = estimateCost(usage, pricing);
    children.push(
      Box(
        { flexDirection: 'row', padding: 0 },
        Text({
          content: `  Cost: $${cost.toFixed(4)}`,
          dim: true,
          color: 'ansi:cyan',
        }),
      ),
    );
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
// Helpers
// ---------------------------------------------------------------------------

function findPricing(model: string): ModelPricing | undefined {
  // Exact match
  if (PRICING[model]) return PRICING[model];

  // Prefix match (e.g. "claude-sonnet-4" matches "claude-sonnet-4-20250514")
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (model.startsWith(key) || key.startsWith(model)) {
      return pricing;
    }
  }

  return undefined;
}

function estimateCost(usage: TokenUsage, pricing: ModelPricing): number {
  let cost = 0;
  cost += (usage.input / 1_000_000) * pricing.input;
  cost += (usage.output / 1_000_000) * pricing.output;

  if (usage.cacheRead && pricing.cacheRead) {
    // Cache reads are cheaper; subtract the difference for cached tokens
    const cacheTokens = usage.cacheRead;
    const discount = (cacheTokens / 1_000_000) * (pricing.input - pricing.cacheRead);
    cost -= discount;
  }

  return cost;
}
