import type { CommandModule } from "./types.js";

const command: CommandModule = {
  name: "/model",
  aliases: [],
  description: "Show or switch the active model",
  argumentHint: "[model-name]",
  async execute(args, ctx) {
    const currentModel = ctx.config.model || "default";
    const provider = ctx.config.chosen_provider || "not set";
    const providerConfig = ctx.config.provider_configs?.[provider];
    const models = providerConfig?.models ?? [];

    if (!args.trim()) {
      const lines = [
        `Provider: ${provider}`,
        `Model: ${currentModel}`,
        `Available models:`,
        ...models.map((m) => `  ${m === currentModel ? "*" : " "} ${m}`),
      ];
      return { success: true, message: lines.join("\n") };
    }

    const newModel = args.trim();
    if (!models.includes(newModel)) {
      return {
        success: false,
        message: `Model "${newModel}" not available for ${provider}.\nAvailable: ${models.join(", ") || "none"}`,
      };
    }

    const updated = { ...ctx.config, model: newModel };
    const { ConfigStore } = await import("../storage/config-store.js");
    const store = new ConfigStore();
    await store.save(updated);

    ctx.engine.refreshProvider(updated);
    return { success: true, message: `Model switched to: ${newModel}` };
  },
};
export default command;
