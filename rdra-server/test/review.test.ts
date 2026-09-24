import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REVIEW_FILE,
  ReviewError,
  approvalState,
  decide,
  emptyReview,
  readReview,
  requestReview,
  writeReview,
} from "../src/review.js";

const T1 = "2026-09-25T10:00:00+09:00";
const T2 = "2026-09-25T10:05:00+09:00";

describe("review record", () => {
  it("reads an empty record when the file is missing and round-trips on write", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "rdra-review-")), "specs", "001-x");
    expect(await readReview(dir)).toEqual(emptyReview());
    const rec = requestReview(emptyReview(), { now: T1, baseCommit: "abc" });
    await writeReview(dir, rec);
    expect(JSON.parse(await readFile(join(dir, REVIEW_FILE), "utf8"))).toEqual(rec);
    expect(await readReview(dir)).toEqual(rec);
  });

  it("walks through request, reject, request, approve", () => {
    let rec = requestReview(emptyReview(), { now: T1, baseCommit: "abc" });
    expect(rec).toMatchObject({ status: "pending", requested_at: T1, base_commit: "abc", approved_hash: null });
    rec = decide(rec, { decision: "rejected", comments: [{ target: "uc.a", text: "直して" }], hash: "sha256:1", now: T2 });
    expect(rec).toMatchObject({ status: "rejected", decided_at: T2, approved_hash: null });
    rec = requestReview(rec, { now: T2, baseCommit: "abc" });
    expect(rec.status).toBe("pending");
    rec = decide(rec, { decision: "approved", comments: [], hash: "sha256:2", now: T2 });
    expect(rec).toMatchObject({ status: "approved", approved_hash: "sha256:2" });
    expect(rec.rounds.map((r) => r.decision)).toEqual(["rejected", "approved"]);
  });

  it("clears a previous approval when a new review is requested", () => {
    let rec = decide(requestReview(emptyReview(), { now: T1, baseCommit: null }), { decision: "approved", comments: [], hash: "sha256:1", now: T1 });
    rec = requestReview(rec, { now: T2, baseCommit: null });
    expect(rec).toMatchObject({ status: "pending", approved_hash: null, decided_at: null });
  });

  it("refuses decisions without a pending review and rejections without comments", () => {
    expect(() => decide(emptyReview(), { decision: "approved", comments: [], hash: "h", now: T1 })).toThrow(ReviewError);
    const pending = requestReview(emptyReview(), { now: T1, baseCommit: null });
    expect(() => decide(pending, { decision: "rejected", comments: [], hash: "h", now: T1 })).toThrow(ReviewError);
  });

  it("computes the approval state against the current hash", () => {
    const approved = decide(requestReview(emptyReview(), { now: T1, baseCommit: null }), { decision: "approved", comments: [], hash: "sha256:1", now: T1 });
    expect(approvalState(approved, "sha256:1")).toEqual({ state: "approved" });
    expect(approvalState(approved, "sha256:2")).toEqual({ state: "stale", approvedHash: "sha256:1", currentHash: "sha256:2" });
    expect(approvalState(emptyReview(), "sha256:1")).toEqual({ state: "none" });
  });
});
