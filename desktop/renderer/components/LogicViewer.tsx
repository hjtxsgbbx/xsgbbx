import React, { useState, useMemo, useCallback } from "react";

interface LogicNode {
  id: string;
  type: "input" | "process" | "decision" | "output" | "error" | "loop";
  label: string;
  detail?: string;
  children?: string[];
  status?: "active" | "completed" | "error" | "pending";
}

interface LogicEdge {
  from: string;
  to: string;
  label?: string;
  type: "normal" | "conditional_true" | "conditional_false" | "error";
}

interface LogicViewerProps {
  nodes: LogicNode[];
  edges: LogicEdge[];
  title: string;
  onNodeClick?: (nodeId: string) => void;
}

const NODE_TYPE_ICONS: Record<LogicNode["type"], string> = {
  input: "→",
  process: "⚙",
  decision: "◇",
  output: "←",
  error: "⚠",
  loop: "↻",
};

const NODE_TYPE_COLORS: Record<LogicNode["type"], string> = {
  input: "var(--accent-blue)",
  process: "var(--accent-cyan)",
  decision: "var(--accent-yellow)",
  output: "var(--accent-green)",
  error: "var(--accent-red)",
  loop: "var(--accent-purple)",
};

const STATUS_BORDER: Record<string, string> = {
  active: "2px solid var(--accent-cyan)",
  completed: "2px solid var(--accent-green)",
  error: "2px solid var(--accent-red)",
  pending: "2px solid var(--border-default)",
};

export function LogicViewer({ nodes, edges, title, onNodeClick }: LogicViewerProps) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"flow" | "list">("flow");

  const nodeMap = useMemo(() => {
    const map = new Map<string, LogicNode>();
    for (const node of nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [nodes]);

  const adjacencyList = useMemo(() => {
    const adj = new Map<string, string[]>();
    for (const node of nodes) {
      adj.set(node.id, []);
    }
    for (const edge of edges) {
      const list = adj.get(edge.from) || [];
      list.push(edge.to);
      adj.set(edge.from, list);
    }
    return adj;
  }, [nodes, edges]);

  const topologicalOrder = useMemo(() => {
    const visited = new Set<string>();
    const order: string[] = [];

    const dfs = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const neighbors = adjacencyList.get(nodeId) || [];
      for (const neighbor of neighbors) {
        dfs(neighbor);
      }
      order.unshift(nodeId);
    };

    for (const node of nodes) {
      dfs(node.id);
    }

    return order;
  }, [nodes, adjacencyList]);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      setSelectedNode((prev) => (prev === nodeId ? null : nodeId));
      onNodeClick?.(nodeId);
    },
    [onNodeClick]
  );

  const selectedNodeData = selectedNode ? nodeMap.get(selectedNode) : null;

  const renderFlowView = () =>
    React.createElement(
      "div",
      { className: "logic-flow-container" },
      topologicalOrder.map((nodeId, index) => {
        const node = nodeMap.get(nodeId);
        if (!node) return null;

        const incomingEdges = edges.filter((e) => e.to === nodeId);
        const outgoingEdges = edges.filter((e) => e.from === nodeId);

        return React.createElement(
          "div",
          { key: nodeId, className: "logic-flow-step" },
          incomingEdges.length > 0 &&
            React.createElement(
              "div",
              { className: "logic-flow-connector incoming" },
              incomingEdges.map((edge, i) =>
                React.createElement(
                  "div",
                  { key: i, className: "logic-edge-label" },
                  edge.label || ""
                )
              )
            ),
          React.createElement(
            "div",
            {
              className: "logic-node" + (selectedNode === nodeId ? " selected" : ""),
              style: {
                border: STATUS_BORDER[node.status || "pending"],
                borderColor: node.status ? undefined : NODE_TYPE_COLORS[node.type],
              },
              onClick: () => handleNodeClick(nodeId),
              role: "button",
              tabIndex: 0,
              "aria-label": `${node.type} node: ${node.label}`,
            },
            React.createElement(
              "div",
              { className: "logic-node-header" },
              React.createElement(
                "span",
                { className: "logic-node-icon", style: { color: NODE_TYPE_COLORS[node.type] } },
                NODE_TYPE_ICONS[node.type]
              ),
              React.createElement("span", { className: "logic-node-label" }, node.label)
            ),
            node.detail &&
              React.createElement("div", { className: "logic-node-detail" }, node.detail)
          ),
          outgoingEdges.length > 0 &&
            React.createElement(
              "div",
              { className: "logic-flow-connector outgoing" },
              outgoingEdges.map((edge, i) =>
                React.createElement(
                  "div",
                  {
                    key: i,
                    className: "logic-edge-label " + edge.type,
                  },
                  edge.label || ""
                )
              )
            )
        );
      })
    );

  const renderListView = () =>
    React.createElement(
      "div",
      { className: "logic-list-container" },
      topologicalOrder.map((nodeId, index) => {
        const node = nodeMap.get(nodeId);
        if (!node) return null;

        return React.createElement(
          "div",
          {
            key: nodeId,
            className: "logic-list-item" + (selectedNode === nodeId ? " selected" : ""),
            onClick: () => handleNodeClick(nodeId),
            role: "button",
            tabIndex: 0,
          },
          React.createElement(
            "span",
            { className: "logic-list-index" },
            `${index + 1}.`
          ),
          React.createElement(
            "span",
            { className: "logic-list-icon", style: { color: NODE_TYPE_COLORS[node.type] } },
            NODE_TYPE_ICONS[node.type]
          ),
          React.createElement(
            "div",
            { className: "logic-list-content" },
            React.createElement("div", { className: "logic-list-label" }, node.label),
            node.detail &&
              React.createElement("div", { className: "logic-list-detail" }, node.detail)
          ),
          node.status &&
            React.createElement(
              "span",
              { className: "logic-list-status " + node.status },
              node.status
            )
        );
      })
    );

  return React.createElement(
    "div",
    { className: "logic-viewer", role: "region", "aria-label": "Logic viewer" },
    React.createElement(
      "div",
      { className: "logic-viewer-header" },
      React.createElement("h3", { className: "logic-viewer-title" }, title || "Program Logic"),
      React.createElement(
        "div",
        { className: "logic-viewer-controls" },
        React.createElement(
          "button",
          {
            className: "btn-view-mode" + (viewMode === "flow" ? " active" : ""),
            onClick: () => setViewMode("flow"),
            "aria-label": "Flow view",
          },
          "Flow"
        ),
        React.createElement(
          "button",
          {
            className: "btn-view-mode" + (viewMode === "list" ? " active" : ""),
            onClick: () => setViewMode("list"),
            "aria-label": "List view",
          },
          "List"
        )
      )
    ),
    React.createElement(
      "div",
      { className: "logic-viewer-content" },
      viewMode === "flow" ? renderFlowView() : renderListView()
    ),
    selectedNodeData &&
      React.createElement(
        "div",
        { className: "logic-viewer-detail", role: "complementary", "aria-label": "Node details" },
        React.createElement(
          "div",
          { className: "logic-detail-header" },
          React.createElement(
            "span",
            { style: { color: NODE_TYPE_COLORS[selectedNodeData.type] } },
            NODE_TYPE_ICONS[selectedNodeData.type]
          ),
          React.createElement("span", null, selectedNodeData.label),
          selectedNodeData.status &&
            React.createElement(
              "span",
              { className: "logic-detail-status " + selectedNodeData.status },
              selectedNodeData.status
            )
        ),
        selectedNodeData.detail &&
          React.createElement("div", { className: "logic-detail-body" }, selectedNodeData.detail),
        React.createElement(
          "div",
          { className: "logic-detail-connections" },
          React.createElement(
            "div",
            null,
            "Incoming: ",
            edges
              .filter((e) => e.to === selectedNode)
              .map((e) => nodeMap.get(e.from)?.label || e.from)
              .join(", ") || "None"
          ),
          React.createElement(
            "div",
            null,
            "Outgoing: ",
            edges
              .filter((e) => e.from === selectedNode)
              .map((e) => nodeMap.get(e.to)?.label || e.to)
              .join(", ") || "None"
          )
        )
      )
  );
}

export default LogicViewer;
