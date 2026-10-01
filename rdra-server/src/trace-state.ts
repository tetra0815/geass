import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { git } from "./git.js";

export const PLANS_DIR = "docs/superpowers/plans";

export interface TraceMarker {
  design_hash: string;
  plans: Record<string, string>;
  traced_at: string;
}

export async function featurePlans(repoRoot: string, base: string): Promise<string[]> {
  // -z keeps non-ASCII paths verbatim instead of core.quotePath's escapes.
  const r = await git(repoRoot, ["diff", "-z", "--name-only", "--diff-filter=AMR", `${base}..HEAD`, "--", PLANS_DIR]);
  if (!r.ok) return [];
  return r.stdout
    .split("\0")
    .filter((p) => p.endsWith(".md") && existsSync(join(repoRoot, p)))
    .sort();
}

export function normalizePlan(text: string): string {
  // Executors tick checkboxes as they go; that is progress, not a change to
  // what the plan covers.
  return text.replace(/^(\s*(?:[-*+]|\d{1,9}[.)])\s+)\[[xX]\]/gm, "$1[ ]");
}

export async function planHashes(repoRoot: string, paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const p of paths) {
    const text = await readFile(join(repoRoot, p), "utf8");
    out[p] = "sha256:" + createHash("sha256").update(normalizePlan(text)).digest("hex");
  }
  return out;
}

export function samePlans(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => b[k] === a[k]);
}

export function markerPath(repoRoot: string, featureId: string): string {
  return join(repoRoot, ".geass", "state", `trace-${featureId}.json`);
}

export async function writeMarker(repoRoot: string, featureId: string, marker: TraceMarker): Promise<void> {
  const file = markerPath(repoRoot, featureId);
  await mkdir(dirname(file), { recursive: true });
  const ignore = join(dirname(file), ".gitignore");
  if (!existsSync(ignore)) await writeFile(ignore, "*\n", "utf8");
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(tmp, JSON.stringify(marker, null, 2) + "\n", "utf8");
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export async function readMarker(repoRoot: string, featureId: string): Promise<TraceMarker | null> {
  try {
    const data = JSON.parse(await readFile(markerPath(repoRoot, featureId), "utf8")) as Partial<TraceMarker>;
    if (typeof data.design_hash !== "string" || !data.plans || typeof data.plans !== "object") return null;
    return { design_hash: data.design_hash, plans: data.plans, traced_at: String(data.traced_at ?? "") };
  } catch {
    return null;
  }
}

export async function removeMarker(repoRoot: string, featureId: string): Promise<void> {
  await rm(markerPath(repoRoot, featureId), { force: true });
}
