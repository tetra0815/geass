import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewError, approvalState, decide, emptyReview, readReview, requestReview, writeReview } from "../src/review.js";

const T1 = "2026-09-25T10:00:00+09:00";
const T2 = "2026-09-25T10:05:00+09:00";

describe("review record", () => {
  it("reads an empty record when the file is missing and round-trips on write", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "rdra-review-")), "docs", "rdra", "reviews", "001-x.json");
    expect(await readReview(file)).toEqual(emptyReview());
    const rec = requestReview(emptyReview(), { now: T1 });
    await writeReview(file, rec);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(rec);
    expect(await readReview(file)).toEqual(rec);
  });

  it("leaves no temporary file behind after writing", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "rdra-review-")), "docs", "rdra", "reviews", "001-x.json");
    await writeReview(file, requestReview(emptyReview(), { now: T1 }));
    await writeReview(file, requestReview(emptyReview(), { now: T2 }));
    expect(await readdir(dirname(file))).toEqual(["001-x.json"]);
    expect((await readReview(file)).requested_at).toBe(T2);
  });

  it("walks through request, reject, request, approve", () => {
    let rec = requestReview(emptyReview(), { now: T1 });
    expect(rec).toMatchObject({ status: "pending", requested_at: T1, approved_hash: null });
    rec = decide(rec, { decision: "rejected", comments: [{ target: "uc.a", text: "直して" }], hash: "sha256:1", now: T2 });
    expect(rec).toMatchObject({ status: "rejected", decided_at: T2, approved_hash: null });
    rec = requestReview(rec, { now: T2 });
    expect(rec.status).toBe("pending");
    rec = decide(rec, { decision: "approved", comments: [], hash: "sha256:2", now: T2 });
    expect(rec).toMatchObject({ status: "approved", approved_hash: "sha256:2" });
    expect(rec.rounds.map((r) => r.decision)).toEqual(["rejected", "approved"]);
  });

  it("clears a previous approval when a new review is requested", () => {
    let rec = decide(requestReview(emptyReview(), { now: T1 }), { decision: "approved", comments: [], hash: "sha256:1", now: T1 });
    rec = requestReview(rec, { now: T2 });
    expect(rec).toMatchObject({ status: "pending", approved_hash: null, decided_at: null });
  });

  it("refuses decisions without a pending review and rejections without comments", () => {
    expect(() => decide(emptyReview(), { decision: "approved", comments: [], hash: "h", now: T1 })).toThrow(ReviewError);
    const pending = requestReview(emptyReview(), { now: T1 });
    expect(() => decide(pending, { decision: "rejected", comments: [], hash: "h", now: T1 })).toThrow(ReviewError);
  });

  it("computes the approval state against the current hash", () => {
    const approved = decide(requestReview(emptyReview(), { now: T1 }), { decision: "approved", comments: [], hash: "sha256:1", now: T1 });
    expect(approvalState(approved, "sha256:1")).toEqual({ state: "approved" });
    expect(approvalState(approved, "sha256:2")).toEqual({ state: "stale", approvedHash: "sha256:1", currentHash: "sha256:2" });
    expect(approvalState(emptyReview(), "sha256:1")).toEqual({ state: "none" });
  });

  it("drops the legacy base_commit field when reading", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "rdra-review-")), "r.json");
    await writeFile(file, JSON.stringify({ status: "pending", base_commit: "abc", approved_hash: null, requested_at: T1, decided_at: null, rounds: [] }));
    expect(await readReview(file)).toEqual({ status: "pending", approved_hash: null, requested_at: T1, decided_at: null, rounds: [] });
  });
});
