import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { Positions } from "../../src/model/view-keys.js";
import type { Diagram } from "./views.js";

export const NODE_WIDTH = 170;
export const NODE_HEIGHT = 44;

export interface LayoutResult {
  positions: Positions;
  sizes: Record<string, { width: number; height: number }>;
}

const elk = new ELK();

export async function autoLayout(diagram: Diagram, stored: Positions): Promise<LayoutResult> {
  const childrenOf = new Map<string, ElkNode[]>();
  const roots: ElkNode[] = [];
  const parents = new Set(diagram.nodes.filter((n) => n.parent).map((n) => n.parent!));
  for (const n of diagram.nodes) {
    const node: ElkNode = { id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT };
    if (parents.has(n.id)) {
      node.children = [];
      childrenOf.set(n.id, node.children);
      node.layoutOptions = { "elk.padding": "[top=40,left=20,bottom=20,right=20]" };
    }
    if (n.parent) continue;
    roots.push(node);
  }
  for (const n of diagram.nodes) {
    if (n.parent) childrenOf.get(n.parent)?.push({ id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "90",
    },
    children: roots,
    edges: diagram.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });

  const positions: Positions = {};
  const sizes: LayoutResult["sizes"] = {};
  const visit = (nodes: ElkNode[] | undefined) => {
    for (const n of nodes ?? []) {
      positions[n.id] = { x: Math.round(n.x ?? 0), y: Math.round(n.y ?? 0) };
      if (n.children && n.children.length > 0) sizes[n.id] = { width: n.width ?? NODE_WIDTH, height: n.height ?? NODE_HEIGHT };
      visit(n.children);
    }
  };
  visit(graph.children);
  return { positions: { ...positions, ...stored }, sizes };
}
