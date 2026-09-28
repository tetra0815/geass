import { relative } from "node:path";
import { parseArgs } from "node:util";
import { diffModels } from "./diff.js";
import { resolveFeature } from "./feature.js";
import { lastCommitTouching, readModelFilesAt } from "./git.js";
import { modelHash } from "./model/hash.js";
import { ModelParseError, parseModel, readModelFiles } from "./model/io.js";
import type { Model } from "./model/kinds.js";
import { approvalState, readReview, type ReviewRecord } from "./review.js";

export interface CliIo {
  out: (s: string) => void;
  err: (s: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultIo: CliIo = {
  out: (s) => void process.stdout.write(s),
  err: (s) => void process.stderr.write(s),
};

const USAGE = [
  "usage:",
  "  cli.js check-approval --repo <root>",
  "  cli.js wait-review --repo <root> [--interval-ms 1000] [--timeout-sec 0]",
  "  cli.js hash --repo <root>",
  "  cli.js serve --repo <root> [--port 0]",
  "",
].join("\n");

const MESSAGES = {
  none: "RDRA のレビューがまだ依頼されていません。/rdra でモデルを作成し、レビューを完了してください。",
  pending: "RDRA のレビューが承認待ちです。レビュー画面で承認してください。",
  rejected: "RDRA が差し戻されています。/rdra でコメントに対応し、再度レビューを依頼してください。",
  stale: "承認後に RDRA が変更されました。/rdra で再レビューを受けてください。",
  approved: "RDRA は承認済みです。",
  outside: "feature ブランチ（feature/*）の外です。",
} as const;

async function loadModel(repo: string): Promise<Model> {
  return parseModel(await readModelFiles(repo));
}

async function changedSinceApproval(repo: string, reviewFile: string, current: Model): Promise<string[] | undefined> {
  const commit = await lastCommitTouching(repo, relative(repo, reviewFile));
  if (!commit) return undefined;
  try {
    const approved = parseModel(await readModelFilesAt(repo, commit));
    return diffModels(approved, current).map((c) => `${c.type} ${c.id}`);
  } catch {
    return undefined;
  }
}

async function checkApproval(repo: string, io: CliIo): Promise<number> {
  const feature = await resolveFeature(repo);
  if (!feature) {
    io.out(JSON.stringify({ state: "outside", message: MESSAGES.outside }) + "\n");
    return 2;
  }
  let model: Model;
  try {
    model = await loadModel(repo);
  } catch (e) {
    if (!(e instanceof ModelParseError)) throw e;
    io.out(JSON.stringify({ state: "error", message: `RDRA の YAML を読めません: ${e.message}` }) + "\n");
    return 3;
  }
  let review;
  try {
    review = await readReview(feature.reviewFile);
  } catch (e) {
    io.out(JSON.stringify({ state: "error", message: `承認記録を読めません: ${(e as Error).message}` }) + "\n");
    return 3;
  }
  const state = approvalState(review, modelHash(model));
  const result: { state: string; message: string; changed?: string[] } = { state: state.state, message: MESSAGES[state.state] };
  if (state.state === "stale") {
    const changed = await changedSinceApproval(repo, feature.reviewFile, model);
    if (changed) result.changed = changed;
  }
  io.out(JSON.stringify(result) + "\n");
  return state.state === "approved" ? 0 : 1;
}

async function safeRead(file: string): Promise<ReviewRecord | null> {
  try {
    return await readReview(file);
  } catch {
    return null;
  }
}

async function waitReview(file: string, intervalMs: number, timeoutSec: number, io: CliIo): Promise<number> {
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let initial;
  try {
    initial = await readReview(file);
  } catch (e) {
    io.out(JSON.stringify({ state: "error", message: `承認記録を読めません: ${(e as Error).message}` }) + "\n");
    return 3;
  }
  if (initial.status !== "pending") {
    io.out(JSON.stringify({ status: initial.status, message: "レビュー待ちではありません" }) + "\n");
    return 2;
  }
  const deadline = timeoutSec > 0 ? Date.now() + timeoutSec * 1000 : Number.POSITIVE_INFINITY;
  for (;;) {
    await sleep(intervalMs);
    const record = await safeRead(file);
    if (record && record.status !== "pending") {
      io.out(JSON.stringify({ status: record.status, lastRound: record.rounds.at(-1) ?? null }) + "\n");
      return 0;
    }
    if (Date.now() >= deadline) {
      io.out(JSON.stringify({ status: "pending", timeout: true }) + "\n");
      return 124;
    }
  }
}

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const [command, ...rest] = argv;
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        repo: { type: "string" },
        "interval-ms": { type: "string" },
        "timeout-sec": { type: "string" },
        port: { type: "string" },
      },
      strict: true,
    }) as { values: Record<string, string | undefined> });
  } catch (e) {
    io.err(`${(e as Error).message}\n${USAGE}`);
    return 64;
  }
  const repo = values.repo;

  if (command === "check-approval" && repo) return checkApproval(repo, io);
  if (command === "wait-review" && repo) {
    const feature = await resolveFeature(repo);
    if (!feature) {
      io.out(JSON.stringify({ state: "error", message: MESSAGES.outside }) + "\n");
      return 3;
    }
    return waitReview(feature.reviewFile, Number(values["interval-ms"] ?? "1000"), Number(values["timeout-sec"] ?? "0"), io);
  }
  if (command === "serve" && repo) {
    const { serve } = await import("./serve.js");
    return serve(repo, Number(values.port ?? "0"), io);
  }
  if (command === "hash" && repo) {
    try {
      io.out(modelHash(await loadModel(repo)) + "\n");
      return 0;
    } catch (e) {
      if (!(e instanceof ModelParseError)) throw e;
      io.err(`RDRA の YAML を読めません: ${e.message}\n`);
      return 3;
    }
  }
  io.err(USAGE);
  return 64;
}
