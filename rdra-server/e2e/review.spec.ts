import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { DESIGN_REVIEWS_DIR, REVIEWS_DIR } from "../src/feature.js";
import { RDRA_DIR } from "../src/model/io.js";
import { decide, emptyReview, requestReview, type ReviewRecord } from "../src/review.js";
import { sampleDesignFiles, sampleFiles } from "../test/fixtures.js";
import { makeFeatureRepo } from "../test/helpers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");

let repo: string;
let server: ChildProcess;
let url: string;

const reviewPath = () => join(repo, REVIEWS_DIR, "001-demo.json");
const readRecord = async () => JSON.parse(await readFile(reviewPath(), "utf8")) as ReviewRecord;
const requestAgain = async (record: ReviewRecord) =>
  writeFile(reviewPath(), JSON.stringify(requestReview(record, { now: new Date().toISOString() }), null, 2));

test.beforeAll(async () => {
  const files = {
    ...Object.fromEntries(Object.entries(sampleFiles()).map(([f, c]) => [`${RDRA_DIR}/${f}`, c])),
    ...Object.fromEntries(Object.entries(sampleDesignFiles()).map(([f, c]) => [`docs/${f}`, c])),
  };
  repo = await makeFeatureRepo(files);
  await mkdir(join(repo, REVIEWS_DIR), { recursive: true });
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
  const check = spawnSync("node", [cli, "check-approval", "--repo", repo], { encoding: "utf8" });
  expect(check.status).toBe(0);
});

test("add a principle, give the usecase acceptance criteria, and follow the badge", async ({ page }) => {
  await page.goto(url);
  await page.getByRole("button", { name: "原則", exact: true }).click();
  await page.getByLabel("原則ID").fill("audit-log");
  await page.getByLabel("原則名").fill("全ての更新を監査ログに残す");
  await page.getByLabel("分類").selectOption("security");
  await page.getByLabel("対象").fill("uc.place-order");
  await page.getByLabel("原則の説明").fill("誰が・いつ・何を変えたかを記録する");
  await page.getByRole("button", { name: "原則を追加" }).click();
  await expect(page.getByRole("cell", { name: "全ての更新を監査ログに残す" })).toBeVisible();
  await expect.poll(async () => readFile(join(repo, RDRA_DIR, "principles.yaml"), "utf8")).toContain("pr.audit-log");

  await page.getByRole("button", { name: "ユースケース複合" }).click();
  await page.locator(".react-flow__node", { hasText: "注文する" }).click();
  await page.getByLabel("受け入れ条件ID").fill("ac1");
  await page.getByLabel("Given").fill("カートに商品がある");
  await page.getByLabel("When").fill("注文を確定する");
  await page.getByLabel("Then").fill("注文が作られる");
  await page.getByRole("button", { name: "受け入れ条件を追加" }).click();
  await expect.poll(async () => readFile(join(repo, RDRA_DIR, "usecases.yaml"), "utf8")).toContain("then: 注文が作られる");

  await page.locator(".react-flow__node", { hasText: "注文する" }).getByRole("button", { name: "原則 1" }).click();
  await expect(page.locator("tr.focused", { hasText: "pr.audit-log" })).toBeVisible();
});

test("a decision right after an edit waits for the edited model to load", async ({ page }) => {
  await requestAgain(await readRecord());
  await page.route("**/api/diff", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.goto(url);
  await expect(page.getByText("レビュー待ち")).toBeVisible();

  await page.getByLabel("種類").selectOption("screens");
  await page.getByLabel("ID", { exact: true }).fill("receipt");
  await page.getByLabel("名前", { exact: true }).fill("注文完了画面");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect.poll(async () => readFile(join(repo, RDRA_DIR, "screens.yaml"), "utf8")).toContain("scr.receipt");
  await page.getByLabel("コメント").fill("完了画面の文言を決めてください");
  await page.getByRole("button", { name: "コメントを追加" }).click();
  await page.getByRole("button", { name: "差し戻す" }).click();
  await expect(page.getByText("差し戻し済み")).toBeVisible();
  expect((await readRecord()).status).toBe("rejected");
});

test("review the design in its own views and approve it", async ({ page }) => {
  const rdraHash = spawnSync("node", [cli, "hash", "--repo", repo], { encoding: "utf8" }).stdout.trim();
  const now = new Date().toISOString();
  await writeFile(reviewPath(), JSON.stringify(decide(requestReview(emptyReview(), { now }), { decision: "approved", comments: [], hash: rdraHash, now }), null, 2));
  const designReview = join(repo, DESIGN_REVIEWS_DIR, "001-demo.json");
  await mkdir(dirname(designReview), { recursive: true });
  await writeFile(designReview, JSON.stringify(requestReview(emptyReview(), { now: new Date().toISOString() }), null, 2));
  await page.goto(url);
  await expect(page.locator('[data-stage="design"]')).toHaveText("レビュー待ち");

  await page.getByRole("button", { name: "コンポーネント", exact: true }).click();
  await expect(page.locator(".react-flow__node", { hasText: "業務 DB" })).toBeVisible();
  await page.getByRole("button", { name: "データ", exact: true }).click();
  await expect(page.locator(".react-flow__node", { hasText: "注文テーブル" })).toBeVisible();
  await page.getByRole("button", { name: "設計判断", exact: true }).click();
  await expect(page.getByRole("cell", { name: "業務データは PostgreSQL に置く" })).toBeVisible();

  await page.getByRole("button", { name: "承認" }).click();
  await expect(page.locator('[data-stage="design"]')).toHaveText("承認済み");
  const record = JSON.parse(await readFile(designReview, "utf8")) as ReviewRecord;
  const hash = spawnSync("node", [cli, "hash", "--repo", repo, "--stage", "design"], { encoding: "utf8" }).stdout.trim();
  expect(record).toMatchObject({ status: "approved", approved_hash: hash });
});
