import type { CommandModule, CommandContext, CommandResult } from "./types.js";

export type { CommandModule, CommandContext, CommandResult } from "./types.js";

/**
 * CommandRegistry — central dispatcher for slash commands.
 *
 * Each command is a first-class module implementing CommandModule.
 * The registry resolves user input to a command and dispatches execution.
 */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandModule>();
  private readonly aliasMap = new Map<string, string>();

  /** Register a single command module. */
  register(mod: CommandModule): void {
    this.commands.set(mod.name, mod);
    for (const alias of mod.aliases) {
      this.aliasMap.set(alias, mod.name);
    }
  }

  /** Register multiple commands at once. */
  registerAll(mods: CommandModule[]): void {
    for (const mod of mods) this.register(mod);
  }

  /** Remove a command by name. */
  unregister(name: string): boolean {
    const mod = this.commands.get(name);
    if (!mod) return false;
    for (const alias of mod.aliases) {
      if (this.aliasMap.get(alias) === name) this.aliasMap.delete(alias);
    }
    return this.commands.delete(name);
  }

  /** Resolve an input string (e.g. "/review" or "/r") to a CommandModule or null. */
  resolveCommand(input: string): CommandModule | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return null;

    const name = trimmed.split(/\s+/)[0]!;
    if (this.commands.has(name)) return this.commands.get(name)!;

    const resolved = this.aliasMap.get(name);
    if (resolved) return this.commands.get(resolved) ?? null;

    return null;
  }

  /**
   * Parse input into command name + args, resolve, and execute.
   * Returns null if no command matches (caller should pass to engine).
   */
  async executeCommand(input: string, context: CommandContext): Promise<CommandResult | null> {
    const mod = this.resolveCommand(input);
    if (!mod) return null;

    const parts = input.trim().split(/\s+/);
    const args = parts.slice(1).join(" ");

    try {
      return await mod.execute(args, context);
    } catch (err) {
      return {
        success: false,
        message: `Command ${mod.name} failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** Get all registered command names. */
  getCommandNames(): string[] {
    return [...this.commands.keys()];
  }

  /** List all registered modules (for help display). */
  listModules(): CommandModule[] {
    return [...this.commands.values()];
  }

  /** Check if a command is registered. */
  has(name: string): boolean {
    return this.commands.has(name);
  }
}
