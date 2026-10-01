import {
  Background,
  ConnectionMode,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import type { Positions } from "../../../src/model/view-keys.js";
import type { LayoutResult } from "../auto-layout.js";
import type { Diagram } from "../views.js";

export type Selection = { type: "node" | "edge"; id: string } | null;

interface Props {
  diagram: Diagram;
  layout: LayoutResult;
  selection: Selection;
  readOnly: boolean;
  onSelect: (selection: Selection) => void;
  onConnect: (source: string, target: string) => void;
  onMoved: (positions: Positions) => void;
  onOpenPrinciples: (id: string) => void;
}

export function DiagramCanvas({ diagram, layout, selection, readOnly, onSelect, onConnect, onMoved, onOpenPrinciples }: Props) {
  const initialNodes = useMemo<Node[]>(
    () =>
      diagram.nodes.map((n) => ({
        id: n.id,
        position: layout.positions[n.id] ?? { x: 0, y: 0 },
        data: {
          label: n.principles ? (
            <span>
              {n.label}
              <button
                className="badge"
                title="この要素にかかる MUST 原則"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenPrinciples(n.elementId);
                }}
              >
                原則 {n.principles}
              </button>
            </span>
          ) : (
            n.label
          ),
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        parentId: n.parent,
        extent: n.parent ? ("parent" as const) : undefined,
        className: ["rdra-node", `rdra-${n.type}`, n.status ? `rdra-${n.status}` : "", layout.sizes[n.id] ? "rdra-group" : ""].join(" "),
        style: layout.sizes[n.id],
        draggable: !readOnly && n.status !== "removed",
        connectable: !readOnly && n.status !== "removed",
        selected: selection?.type === "node" && selection.id === n.id,
      })),
    [diagram, layout, readOnly, selection, onOpenPrinciples],
  );
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  useEffect(() => setNodes(initialNodes), [initialNodes]);

  const edges = useMemo<Edge[]>(
    () =>
      diagram.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        className: e.status ? `rdra-edge-${e.status}` : undefined,
        markerEnd: { type: MarkerType.ArrowClosed },
        selectable: Boolean(e.relation || e.id.startsWith("tr|")),
        selected: selection?.type === "edge" && selection.id === e.id,
      })),
    [diagram, selection],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      connectionMode={ConnectionMode.Loose}
      nodesConnectable={!readOnly}
      onNodesChange={(changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current))}
      onNodeDragStop={(_event, _node, dragged) =>
        onMoved(Object.fromEntries(dragged.map((n) => [n.id, { x: n.position.x, y: n.position.y }])))
      }
      onConnect={(c) => c.source && c.target && c.source !== c.target && onConnect(c.source, c.target)}
      onNodeClick={(_event, node) => onSelect({ type: "node", id: node.id })}
      onEdgeClick={(_event, edge) => onSelect({ type: "edge", id: edge.id })}
      onPaneClick={() => onSelect(null)}
      fitView
      fitViewOptions={{ maxZoom: 1 }}
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}
