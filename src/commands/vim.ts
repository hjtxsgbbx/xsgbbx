import type { CommandModule } from "./types.js";

const command: CommandModule = {
  name: "/vim",
  aliases: [],
  description: "Toggle vim mode for terminal input",
  argumentHint: "",
  async execute(_args, _ctx) {
    // Vim mode is managed by the CLI readline layer.
    // This command sends a control message that the CLI transport
    // interprets as a vim-mode toggle request.
    return {
      success: true,
      message: "Vim mode toggle requested. Use Escape in input to enter normal mode, i/I/a/A to enter insert mode.\n\nKeybindings in vim-normal context:\n  h/j/k/l  move cursor\n  w/b      next/prev word\n  0/$      line start/end\n  dd       delete line\n  dw       delete word\n  yy       yank line\n  p        paste\n  x        delete char\n  D        delete to EOL\n  C        change to EOL\n  u        undo\n  i        insert at cursor\n  a        append after cursor\n  A        append at EOL\n  I        insert at line start\n  Escape   normal mode (from insert)",
    };
  },
};
export default command;
