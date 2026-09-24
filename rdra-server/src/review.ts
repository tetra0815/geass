import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const REVIEW_FILE = "rdra-review.json";

export type ReviewStatus = "none" | "pending" | "approved" | "rejected";

export interface ReviewComment {
  target: string | null;
  text: string;
}

export interface ReviewRound {
  decision: "approved" | "rejected";
  decided_at: string;
  hash: string;
  comments: ReviewComment[];
}

export interface ReviewRecord {
  status: ReviewStatus;
  base_commit: string | null;
  approved_hash: string | null;
  requested_at: string | null;
  decided_at: string | null;
  rounds: ReviewRound[];
}

export type ApprovalState =
  | { state: "approved" }
  | { state: "none" | "pending" | "rejected" }
  | { state: "stale"; approvedHash: string; currentHash: string };

export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewError";
  }
}

export function emptyReview(): ReviewRecord {
  return { status: "none", base_commit: null, approved_hash: null, requested_at: null, decided_at: null, rounds: [] };
}

export async function readReview(featureDir: string): Promise<ReviewRecord> {
  let text: string;
  try {
    text = await readFile(join(featureDir, REVIEW_FILE), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyReview();
    throw e;
  }
  return { ...emptyReview(), ...(JSON.parse(text) as Partial<ReviewRecord>) };
}

export async function writeReview(featureDir: string, record: ReviewRecord): Promise<void> {
  await mkdir(featureDir, { recursive: true });
  // Write to a sibling temp file and rename over the target so a reader
  // (the gate, wait-review) never sees a half-written record.
  const target = join(featureDir, REVIEW_FILE);
  const tmp = `${target}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(tmp, JSON.stringify(record, null, 2) + "\n", "utf8");
    await rename(tmp, target);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export function requestReview(record: ReviewRecord, opts: { now: string; baseCommit: string | null }): ReviewRecord {
  return {
    ...record,
    status: "pending",
    base_commit: opts.baseCommit,
    approved_hash: null,
    requested_at: opts.now,
    decided_at: null,
  };
}

export function decide(
  record: ReviewRecord,
  opts: { decision: "approved" | "rejected"; comments: ReviewComment[]; hash: string; now: string },
): ReviewRecord {
  if (record.status !== "pending") throw new ReviewError("レビューが依頼されていません");
  if (opts.decision === "rejected" && opts.comments.length === 0) throw new ReviewError("差し戻しにはコメントが必要です");
  const round: ReviewRound = { decision: opts.decision, decided_at: opts.now, hash: opts.hash, comments: opts.comments };
  return {
    ...record,
    status: opts.decision,
    decided_at: opts.now,
    approved_hash: opts.decision === "approved" ? opts.hash : null,
    rounds: [...record.rounds, round],
  };
}

export function approvalState(record: ReviewRecord, currentHash: string): ApprovalState {
  if (record.status !== "approved") return { state: record.status };
  if (record.approved_hash === currentHash) return { state: "approved" };
  return { state: "stale", approvedHash: record.approved_hash ?? "", currentHash };
}
