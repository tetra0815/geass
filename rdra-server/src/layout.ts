import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { RDRA_DIR } from "./model/io.js";
import { VIEW_KEYS, emptyLayout, type Layout, type Positions, type ViewKey } from "./model/view-keys.js";

export const LAYOUT_DIR = `${RDRA_DIR}/layout`;

function sanitize(data: unknown): Positions {
  const out: Positions = {};
  if (data === null || typeof data !== "object" || Array.isArray(data)) return out;
  for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
    const p = value as { x?: unknown; y?: unknown } | null;
    if (p && typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      out[id] = { x: Math.round(p.x), y: Math.round(p.y) };
    }
  }
  return out;
}

async function readView(repoRoot: string, view: ViewKey): Promise<Positions> {
  try {
    return sanitize(parse(await readFile(join(repoRoot, LAYOUT_DIR, `${view}.yaml`), "utf8")));
  } catch {
    return {};
  }
}

export async function readLayout(repoRoot: string): Promise<Layout> {
  const layout = emptyLayout();
  for (const view of VIEW_KEYS) layout[view] = await readView(repoRoot, view);
  return layout;
}

export async function writeLayoutView(repoRoot: string, view: ViewKey, positions: Positions): Promise<Positions> {
  const merged = { ...(await readView(repoRoot, view)), ...sanitize(positions) };
  const sorted = Object.fromEntries(Object.keys(merged).sort().map((id) => [id, merged[id]]));
  await mkdir(join(repoRoot, LAYOUT_DIR), { recursive: true });
  await writeFile(join(repoRoot, LAYOUT_DIR, `${view}.yaml`), stringify(sorted, { lineWidth: 0 }), "utf8");
  return sorted;
}
