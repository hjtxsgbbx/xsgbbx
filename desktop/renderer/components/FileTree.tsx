import React, { useState } from "react";

interface FileTreeProps {
  projectPath: string;
  onFileSelect: (filePath: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  expanded?: boolean;
  children?: TreeNode[];
}

const demoTree: TreeNode[] = [
  {
    name: "src",
    path: "src",
    type: "folder",
    expanded: true,
    children: [
      {
        name: "index.ts",
        path: "src/index.ts",
        type: "file",
      },
      {
        name: "api",
        path: "src/api",
        type: "folder",
        expanded: true,
        children: [
          { name: "provider.ts", path: "src/api/provider.ts", type: "file" },
          { name: "index.ts", path: "src/api/index.ts", type: "file" },
        ],
      },
      {
        name: "cli",
        path: "src/cli",
        type: "folder",
        children: [
          { name: "app.tsx", path: "src/cli/app.tsx", type: "file" },
          { name: "main.tsx", path: "src/cli/main.tsx", type: "file" },
        ],
      },
    ],
  },
  { name: "package.json", path: "package.json", type: "file" },
  { name: "tsconfig.json", path: "tsconfig.json", type: "file" },
  { name: ".agent_1.md", path: ".agent_1.md", type: "file" },
];

export default function FileTree({ projectPath, onFileSelect }: FileTreeProps) {
  const [tree] = useState<TreeNode[]>(demoTree);

  const renderNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isFolder = node.type === "folder";
    const icon = isFolder ? (node.expanded ? "📂" : "📁") : "📄";

    return React.createElement(
      "div",
      { key: node.path },
      React.createElement(
        "div",
        {
          onClick: () => {
            if (isFolder) {
              node.expanded = !node.expanded;
            } else {
              onFileSelect(node.path);
            }
          },
          style: {
            display: "flex",
            alignItems: "center",
            padding: `4px 8px 4px ${12 + depth * 16}px`,
            cursor: "pointer",
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            color: "var(--text-primary)",
            borderRadius: 4,
            margin: "1px 4px",
            transition: "background 0.1s",
          },
          onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
            (e.currentTarget as HTMLDivElement).style.background = "var(--bg-tertiary)";
          },
          onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => {
            (e.currentTarget as HTMLDivElement).style.background = "transparent";
          },
        },
        React.createElement("span", { style: { marginRight: 6, fontSize: 12 } }, icon),
        React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, node.name),
        isFolder &&
          React.createElement(
            "span",
            { style: { marginLeft: "auto", fontSize: 10, color: "var(--text-secondary)" } },
            (node.children?.length ?? 0) + " items"
          )
      ),
      isFolder &&
        node.expanded &&
        node.children?.map((child) => renderNode(child, depth + 1))
    );
  };

  return React.createElement(
    "div",
    {
      style: {
        height: "100%",
        overflow: "auto",
        background: "var(--bg-secondary)",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          padding: "8px 12px",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "var(--text-secondary)",
          borderBottom: "1px solid var(--border-color)",
          fontFamily: "var(--font-mono)",
        },
      },
      projectPath
        ? projectPath.split(/[/\\]/).pop() || projectPath
        : "Explorer"
    ),
    React.createElement(
      "div",
      { style: { padding: "4px 0" } },
      tree.map((node) => renderNode(node))
    )
  );
}