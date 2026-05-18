import { CommandRegistry } from "./index.js";
import type { CommandModule } from "./types.js";

// Lazy-loaded modules to avoid loading all command files at import time
async function loadModules(): Promise<CommandModule[]> {
  const mods = await Promise.all([
    import("./help.js"),
    import("./status.js"),
    import("./mode.js"),
    import("./clear.js"),
    import("./config.js"),
    import("./review.js"),
    import("./plan.js"),
    import("./doctor.js"),
    import("./memory.js"),
    import("./compact.js"),
    import("./cost.js"),
    import("./resume.js"),
    import("./hooks.js"),
    import("./skills.js"),
    import("./model.js"),
    import("./keybindings.js"),
    import("./vim.js"),
    import("./diff.js"),
  ]);
  return mods.map((m) => m.default);
}

let _registry: CommandRegistry | null = null;

/** Get or create the singleton registry with all commands loaded. */
export async function getRegistry(): Promise<CommandRegistry> {
  if (_registry) return _registry;
  _registry = new CommandRegistry();
  const mods = await loadModules();
  _registry.registerAll(mods);
  return _registry;
}

/** Synchronous getter — only works if registry was already loaded. */
export function getRegistrySync(): CommandRegistry | null {
  return _registry;
}
