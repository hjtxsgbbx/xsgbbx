import type { CommandModule } from "./types.js";

const command: CommandModule = {
  name: "/clear",
  aliases: ["/cl"],
  description: "Clear session messages (fresh session)",
  argumentHint: "",
  async execute(_args, ctx) {
    const session = ctx.session;
    if (!session) {
      return { success: false, message: "No active session to clear." };
    }
    // Create a new empty session with same metadata
    session.messages = [];
    session.updated_at = new Date().toISOString();
    ctx.engine.setSession(session);
    return { success: true, message: "Session cleared. Messages reset." };
  },
};
export default command;
