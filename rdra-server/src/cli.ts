import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { APPROVAL_MESSAGES, checkFeatureApproval } from "./approval.js";
import { isInvalidFeature, resolveFeature } from "./feature.js";
import { gatePath, gateSkill } from "./gate.js";
import { modelHash } from "./model/hash.js";
import { ModelParseError, parseModel, readModelFiles } from "./model/io.js";
import { readReview, type ReviewRecord } from "./review.js";
import { formatTrace, runTrace } from "./trace-run.js";

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
  "  cli.js trace --repo <root>",
  "  cli.js gate --repo <root> (--skill <name> | --path <file>)",
  "  cli.js hash --repo <root>",
  "  cli.js serve --repo <root> [--port 0]",
  "",
].join("\n");

async function checkApproval(repo: string, io: CliIo): Promise<number> {
  const { state, message, changed } = await checkFeatureApproval(repo);
  io.out(JSON.stringify(changed ? { state, message, changed } : { state, message }) + "\n");
  if (state === "approved") return 0;
  if (state === "outside") return 2;
  if (state === "error") return 3;
  return 1;
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
        skill: { type: "string" },
        path: { type: "string" },
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
    if (!feature || isInvalidFeature(feature)) {
      io.out(JSON.stringify({ state: "error", message: feature ? feature.reason : APPROVAL_MESSAGES.outside }) + "\n");
      return 3;
    }
    return waitReview(feature.reviewFile, Number(values["interval-ms"] ?? "1000"), Number(values["timeout-sec"] ?? "0"), io);
  }
  if (command === "trace" && repo) {
    const outcome = await runTrace(repo, new Date().toISOString());
    io.out(formatTrace(outcome));
    const payload = outcome.status === "error" ? outcome : { status: outcome.status, feature: outcome.feature, plans: outcome.plans, ...outcome.report };
    io.out(JSON.stringify(payload) + "\n");
    return outcome.status === "ok" ? 0 : outcome.status === "failed" ? 1 : 2;
  }
  if (command === "gate" && repo && (values.skill || values.path)) {
    const decision = values.path ? gatePath(resolve(repo, values.path)) : await gateSkill(repo, values.skill!);
    io.out(JSON.stringify(decision) + "\n");
    return decision.decision === "allow" ? 0 : 1;
  }
  if (command === "serve" && repo) {
    const { serve } = await import("./serve.js");
    return serve(repo, Number(values.port ?? "0"), io);
  }
  if (command === "hash" && repo) {
    try {
      io.out(modelHash(parseModel(await readModelFiles(repo))) + "\n");
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
