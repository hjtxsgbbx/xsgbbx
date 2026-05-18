import { type StopReason } from "../types/index.js";

export function mapStopReason(raw: string): StopReason {
  switch (raw) {
    case "end_turn":
    case "stop":
    case "stop_sequence":
      return "end_turn";
    case "tool_use":
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "max_tokens":
    case "length":
      return "max_tokens";
    default:
      return "stop_sequence";
  }
}

export function safeParseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function extractStringParam(
  params: Record<string, unknown>,
  key: string,
  defaultValue: string
): string;
export function extractStringParam(
  params: Record<string, unknown>,
  key: string,
  defaultValue?: string
): string | undefined;
export function extractStringParam(
  params: Record<string, unknown>,
  key: string,
  defaultValue?: string
): string | undefined {
  const value = params[key];
  if (typeof value === "string") return value;
  return defaultValue;
}

export function extractRequiredStringParam(
  params: Record<string, unknown>,
  key: string
): string {
  const value = params[key];
  if (typeof value === "string") return value;
  throw new Error(`Missing required parameter: ${key}`);
}

export function extractNumberParam(
  params: Record<string, unknown>,
  key: string,
  defaultValue: number
): number;
export function extractNumberParam(
  params: Record<string, unknown>,
  key: string,
  defaultValue?: number
): number | undefined;
export function extractNumberParam(
  params: Record<string, unknown>,
  key: string,
  defaultValue?: number
): number | undefined {
  const value = params[key];
  if (typeof value === "number") return value;
  return defaultValue;
}
