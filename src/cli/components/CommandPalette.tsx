import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";

export interface CommandPaletteItem {
  id: string;
  label: string;
  description?: string;
  category?: string;
  shortcut?: string;
}

interface CommandPaletteProps {
  items: CommandPaletteItem[];
  onSelect: (item: CommandPaletteItem) => void;
  onDismiss: () => void;
  placeholder?: string;
  maxVisible?: number;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  items,
  onSelect,
  onDismiss,
  placeholder = "Type a command...",
  maxVisible = 8,
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = items.filter((item) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      item.label.toLowerCase().includes(q) ||
      (item.description && item.description.toLowerCase().includes(q)) ||
      (item.category && item.category.toLowerCase().includes(q))
    );
  });

  const visibleItems = filtered.slice(0, maxVisible);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useInput((input, key) => {
    if (key.escape) {
      onDismiss();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : visibleItems.length - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < visibleItems.length - 1 ? prev + 1 : 0));
      return;
    }

    if (key.return) {
      if (visibleItems[selectedIndex]) {
        onSelect(visibleItems[selectedIndex]);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setQuery((prev) => prev.slice(0, -1));
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setQuery((prev) => prev + input);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box>
        <Text color="cyan" bold>{">"} </Text>
        <Text color="cyan">{query || placeholder}</Text>
        <Text color="cyan">▌</Text>
      </Box>

      {visibleItems.length === 0 && (
        <Box paddingX={1}>
          <Text dimColor>No matching commands</Text>
        </Box>
      )}

      {visibleItems.map((item, index) => (
        <CommandPaletteRow
          key={item.id}
          item={item}
          isSelected={index === selectedIndex}
          query={query}
        />
      ))}

      {filtered.length > maxVisible && (
        <Box paddingX={1}>
          <Text dimColor>
            ... and {filtered.length - maxVisible} more (↑↓ to navigate)
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ navigate • Enter select • Esc dismiss
        </Text>
      </Box>
    </Box>
  );
};

const CommandPaletteRow: React.FC<{
  item: CommandPaletteItem;
  isSelected: boolean;
  query: string;
}> = ({ item, isSelected, query }) => {
  const highlightMatch = (text: string) => {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return text.slice(0, idx) + text.slice(idx, idx + query.length) + text.slice(idx + query.length);
  };

  return (
    <Box flexDirection="row" paddingX={1}>
      <Text>{isSelected ? "❯ " : "  "}</Text>
      <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
        {highlightMatch(item.label)}
      </Text>
      {item.shortcut && (
        <Text dimColor> {item.shortcut}</Text>
      )}
      {item.description && (
        <Text dimColor> — {item.description}</Text>
      )}
    </Box>
  );
};

export const DEFAULT_COMMANDS: CommandPaletteItem[] = [
  { id: "help", label: "Help", description: "Show available commands", category: "general", shortcut: "⌘H" },
  { id: "model", label: "Switch Model", description: "Change AI model", category: "config", shortcut: "⌘M" },
  { id: "provider", label: "Switch Provider", description: "Change AI provider", category: "config", shortcut: "⌘P" },
  { id: "clear", label: "Clear Chat", description: "Clear conversation history", category: "chat", shortcut: "⌘K" },
  { id: "compact", label: "Compact Context", description: "Compress conversation to save tokens", category: "chat" },
  { id: "budget", label: "Show Budget", description: "Display token usage and costs", category: "info" },
  { id: "permission", label: "Permission Mode", description: "Change permission level", category: "config" },
  { id: "export", label: "Export Session", description: "Export conversation to file", category: "chat" },
  { id: "diff", label: "View Diff", description: "Show pending file changes", category: "tools" },
  { id: "commit", label: "Git Commit", description: "Commit current changes", category: "tools", shortcut: "⌘⇧C" },
  { id: "undo", label: "Undo Last", description: "Revert last file change", category: "tools", shortcut: "⌘Z" },
  { id: "sandbox", label: "Sandbox Mode", description: "Toggle sandbox restrictions", category: "security" },
  { id: "debug", label: "Debug Info", description: "Show system debug information", category: "info" },
  { id: "quit", label: "Quit", description: "Exit the application", category: "general", shortcut: "⌘Q" },
];
