import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { RDRA_DIR } from "../src/model/io.js";
import { REVIEW_FILE, emptyReview, requestReview, type ReviewRecord } from "../src/review.js";
import { sampleFiles } from "../test/fixtures.js";
import { makeRepo } from "../test/helpers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");
const FEATURE = "specs/001-demo";

let repo: string;
let server: ChildProcess;
let url: string;

const reviewPath = () => join(repo, FEATURE, REVIEW_FILE);
const readRecord = async () => JSON.parse(await readFile(reviewPath(), "utf8")) as ReviewRecord;
const requestAgain = async (record: ReviewRecord) =>
  writeFile(reviewPath(), JSON.stringify(requestReview(record, { now: new Date().toISOString(), baseCommit: null }), null, 2));

test.beforeAll(async () => {
  const files = Object.fromEntries(Object.entries(sampleFiles()).map(([f, c]) => [`${RDRA_DIR}/${f}`, c]));
  repo = await makeRepo({ ...files, ".geass/feature.json": JSON.stringify({ feature_directory: FEATURE }) });
  await mkdir(join(repo, FEATURE), { recursive: true });
  await requestAgain(emptyReview());
  server = spawn("node", [cli, "serve", "--repo", repo], { stdio: ["ignore", "pipe", "ignore"] });
  url = await new Promise<string>((resolve, reject) => {
    server.stdout!.once("data", (chunk) => resolve(JSON.parse(String(chunk)).url));
    server.once("exit", (code) => reject(new Error(`serve exited with ${code}`)));
  });
});

test.afterAll(() => {
  server?.kill("SIGTERM");
});

test("edit the model, reject with a comment, then approve", async ({ page }) => {
  await page.goto(url);
  await expect(page.getByText("注文する", { exact: true })).toBeVisible();
  if (process.env.RDRA_SCREENSHOT) await page.screenshot({ path: process.env.RDRA_SCREENSHOT, fullPage: true });
  await expect(page.getByText("レビュー待ち")).toBeVisible();

  await page.getByLabel("種類").selectOption("screens");
  await page.getByLabel("ID", { exact: true }).fill("confirm");
  await page.getByLabel("名前", { exact: true }).fill("確認画面");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.locator(".react-flow__node", { hasText: "確認画面" })).toBeVisible();
  expect(await readFile(join(repo, RDRA_DIR, "screens.yaml"), "utf8")).toContain("scr.confirm");

  await page.locator(".react-flow__node", { hasText: "注文する" }).click();
  await page.getByLabel("関連の種類").selectOption({ label: "uc.screen（→ scr）" });
  await page.getByLabel("関連先").selectOption("scr.confirm");
  await page.getByRole("button", { name: "関連を追加" }).click();
  await expect.poll(async () => readFile(join(repo, RDRA_DIR, "usecases.yaml"), "utf8")).toContain("scr.confirm");

  await page.getByRole("button", { name: "この要素にコメント" }).click();
  await page.getByLabel("コメント").fill("在庫の扱いを書いてください");
  await page.getByRole("button", { name: "コメントを追加" }).click();
  await page.getByRole("button", { name: "差し戻す" }).click();
  await expect(page.getByText("差し戻し済み")).toBeVisible();
  const rejected = await readRecord();
  expect(rejected.status).toBe("rejected");
  expect(rejected.rounds[0].comments).toEqual([{ target: "uc.place-order", text: "在庫の扱いを書いてください" }]);

  await requestAgain(rejected);
  await page.reload();
  await expect(page.getByText("レビュー待ち")).toBeVisible();
  await page.getByRole("button", { name: "承認" }).click();
  await expect(page.getByText("承認済み")).toBeVisible();

  const approved = await readRecord();
  const hash = spawnSync("node", [cli, "hash", "--repo", repo], { encoding: "utf8" }).stdout.trim();
  expect(approved).toMatchObject({ status: "approved", approved_hash: hash });
  const check = spawnSync("node", [cli, "check-approval", "--repo", repo, "--feature-dir", join(repo, FEATURE)], { encoding: "utf8" });
  expect(check.status).toBe(0);
});
