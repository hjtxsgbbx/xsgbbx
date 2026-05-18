const DEBUG_ENABLED = process.env.AGENT1_DEBUG === "1" || process.env.AGENT1_DEBUG === "true";

function formatMessage(context: string, message: string): string {
  const ts = new Date().toISOString().slice(11, 19);
  return `[${ts}] [${context}] ${message}`;
}

export const debug = {
  warn(context: string, message: string, err?: unknown): void {
    const formatted = formatMessage(context, message);
    console.error(formatted);
    if (err && DEBUG_ENABLED) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`  ↳ ${detail}`);
    }
  },

  error(context: string, message: string, err?: unknown): void {
    const formatted = formatMessage(context, message);
    console.error(formatted);
    if (err) {
      const detail = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
      console.error(`  ↳ ${detail}`);
    }
  },

  info(context: string, message: string, err?: unknown): void {
    if (!DEBUG_ENABLED) return;
    console.error(formatMessage(context, message));
    if (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`  ↳ ${detail}`);
    }
  },
};
