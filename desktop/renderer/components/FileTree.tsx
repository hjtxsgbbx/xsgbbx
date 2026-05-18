import React, { useState, useEffect, useCallback } from "react";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: TreeNode[];
}

interface FileTreeProps {
  projectPath: string;
  expandedFolders: Set<string>;
  selectedFile: string | null;
  onFileSelect: (filePath: string) => void;
  onToggleFolder: (folderPath: string) => void;
}

export const FileTree: React.FC<FileTreeProps> = ({
  projectPath,
  expandedFolders,
  selectedFile,
  onFileSelect,
  onToggleFolder,
}) => {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTree = useCallback(async () => {
    if (!projectPath) {
      setTree([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI?.invoke("bridge:list-files");
      if (result?.success && result.data) {
        setTree(result.data as TreeNode[]);
      } else {
        setError(result?.error || "Failed to load files");
      }
    } catch {
      setError("Failed to connect to backend");
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  const renderNode = (node: TreeNode, depth: number): React.ReactElement => {
    const isExpanded = expandedFolders.has(node.path);
    const isSelected = selectedFile === node.path;
    const paddingLeft = depth * 14 + 8;

    if (node.type === "folder") {
      return React.createElement(
        "div",
        { key: node.path, className: "tree-node" },
        React.createElement(
          "div",
          {
            onClick: () => onToggleFolder(node.path),
            className: "tree-node-folder",
            style: { paddingLeft: paddingLeft + "px" },
          },
          React.createElement(
            "span",
            { className: "tree-arrow" + (isExpanded ? " expanded" : "") },
            "▸"
          ),
          React.createElement("span", { className: "tree-icon" },
            React.createElement("svg", { className: "icon-svg", viewBox: "0 0 24 24" },
              React.createElement("path", { d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" })
            )
          ),
          React.createElement("span", null, node.name)
        ),
        isExpanded && node.children
          ? React.createElement(
              "div",
              null,
              node.children.map((child) => renderNode(child, depth + 1))
            )
          : null
      );
    }

    return React.createElement(
      "div",
      {
        key: node.path,
        onClick: () => onFileSelect(node.path),
        className: "tree-node-file" + (isSelected ? " selected" : ""),
        style: { paddingLeft: paddingLeft + "px" },
      },
      React.createElement("span", { className: "tree-icon" },
        React.createElement("svg", { className: "icon-svg", viewBox: "0 0 24 24" },
          React.createElement("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }),
          React.createElement("polyline", { points: "14 2 14 8 20 8" })
        )
      ),
      node.name
    );
  };

  if (!projectPath) {
    return React.createElement("div", { className: "tree-empty" }, "No project open");
  }

  if (loading) {
    return React.createElement("div", { className: "tree-empty" }, "Loading...");
  }

  if (error) {
    return React.createElement(
      "div",
      { className: "tree-empty", style: { color: "var(--accent-red)" } },
      error
    );
  }

  return React.createElement(
    "div",
    null,
    tree.map((node) => renderNode(node, 0))
  );
};