# RDRA 中心パイプラインへの再構成 設計書

- 日付: 2026-09-28
- 対象バージョン: geass 0.12.0（破壊的変更）
- 状態: 設計承認済み（実装計画の作成前）
- 前提: [RDRA モデリングと承認ゲート 設計書](2026-09-25-rdra-review-gate-design.md)（0.11.0）

## 1. 目的と位置づけ

geass から spec-kit 由来の構造を取り除き、RDRA を要求の唯一の正本とするパイプラインに作り直す。

geass は 0.11.0 時点で spec-kit の完全フォークであり、実行時の依存はない。取り除く「依存」は、spec-kit から受け継いだ構造と成果物モデルである。

- スキル: `specify` / `plan` / `tasks` / `analyze` / `checklist` / `converge` / `constitution` / `implement` / `taskstoissues`
- 成果物: `specs/<feature>/spec.md, plan.md, tasks.md`、`.geass/memory/constitution.md`
- スクリプトと仕組み: `scripts/bash/*.sh`、`.geass/extensions.yml` の hooks、Sync Impact Report、constitution の semver 管理

動機は次の 2 点である。

- constitution（プロジェクトの原則・制約）は要求の一部であり、RDRA モデルに含めて同じレビューと承認を通すべきである。
- spec.md の内容（ユーザーストーリー・要求）は RDRA の BUC とユースケースに重なり、plan.md と tasks.md は superpowers の計画に重なる。正本が二重になっている。

方針は「**geass は RDRA という固有の価値だけを持ち、流れの制御は git flow と gh に、実装の進め方は superpowers に任せる**」である。geass は薄くする。

### 範囲外

- GitHub Actions による CI 上のゲート（ゲートはローカルのフックのまま）
- 旧形式の承認記録（`specs/<feature>/rdra-review.json`）の自動移行
- `superpowers` 側のスキルの改変

## 2. 決定事項の要約

| 論点 | 決定 |
|---|---|
| spec-kit 由来の範囲 | パイプライン全体を RDRA と superpowers に置き換える |
| constitution | RDRA の新しい要素種別 `principles`（`pr.*`）にする。技術・開発プロセスの規約も同じ種別に入れる |
| 受け入れ条件 | ユースケースの属性 `acceptance` として RDRA に持つ。人間による承認は RDRA のレビュー UI の 1 か所に集約する |
| 技術設計 | `/design-spec` を廃止し、`superpowers:brainstorming` が承認済みの RDRA を入力にして行う |
| 実装前の整合性チェック | 新スキル `/trace` が、計画と RDRA の差分を決定的に照合する。実行系スキルのゲートにする |
| 流れの制御 | スキル同士の自動連鎖をやめる。各スキルは単独で完結し、次の一手を案内するだけにする |
| feature の識別 | git flow のブランチ名 `feature/<id>` から導く。独自の状態ファイルと採番は廃止する |
| feature の基点 | `develop`（標準の git flow）。hotfix は `gitflow.branch.master` から切る |
| 完了 | `gh pr create` から PR をマージする（`git flow feature finish` は使わない） |
| `/feature-start`, `/fix-start` | 標準操作を薄く包むラッパーとして残す |
| 設定 | `terminal_multiplexer` だけを残す。RDRA による承認と `/trace` は常に必須とする |
| 移行 | `/rdra` が constitution.md を取り込む。0.12.0 で旧構造を一括で削除する |

## 3. 全体構成

### 3.1 流れ

スキル同士は自動で呼び合わない。各スキルは最後に次の一手を案内する。

```
/feature-start <説明>
  gh issue create → git worktree add -b feature/<#>-<slug> … origin/develop → 新しいタブで /rdra
      │
/rdra        原則(pr.*)・UC・受け入れ条件をモデリング → レビューUIで承認 → commit
      │      （constitution.md があれば初回に取り込む）
superpowers:brainstorming   承認済み RDRA を入力に技術設計 → docs/ の設計文書
      │
superpowers:writing-plans   各タスクに Covers: uc.x#ac1, pr.y を書く
      │
/trace       計画が RDRA 差分の受け入れ条件と MUST 原則をすべてカバーしているか照合
      │
superpowers:subagent-driven-development / executing-plans
      │
superpowers:finishing-a-development-branch → gh pr create（RDRA 差分と承認記録を本文に添付）

/fix-start <説明>
  git worktree add -b hotfix/<slug> … origin/<master> → 新しいタブで superpowers:systematic-debugging
```

### 3.2 責務分担

| 担当 | 責務 |
|---|---|
| git flow | ブランチの命名規則（`gitflow.prefix.feature`, `gitflow.branch.develop`, `gitflow.branch.master`）と、base の記録（`gitflow.branch.<branch>.base`） |
| gh | 追跡 Issue、PR の作成とマージ |
| superpowers | 設計の対話、計画、実装、レビュー、ブランチの仕上げ |
| geass | RDRA（MCP サーバー、レビュー UI、`/rdra`）、`/trace`、実行前ゲート、worktree とタブの起動 |

### 3.3 geass に残るもの・新設するもの

| 要素 | 変更 |
|---|---|
| `rdra-server` | `principles` とユースケースの `acceptance` を追加（§4）。CLI に `trace` と `gate` を追加し、feature の解決を git flow のブランチ基準に置き換える（§5, §6） |
| `/rdra` | 原則・受け入れ条件のモデリングと constitution の取り込みを追加する。完了後は他のスキルを呼ばず、次の一手（brainstorming と計画の書き方の約束）を案内する |
| `/trace` | 新設（§5） |
| `/feature-start`, `/fix-start` | 薄いラッパーに書き直す（§7） |
| `hooks/pretooluse_gate.py` | CLI の `gate` を呼ぶだけの薄い層に書き直す（§6） |
| 設計文書テンプレート（schema / api / security / infrastructure / testing / operations / client） | 残す。brainstorming が参照する資料として `/rdra` の案内から示す |

### 3.4 削除するもの

- スキル: `design-spec`, `specify`, `plan`, `tasks`, `analyze`, `checklist`, `converge`, `constitution`, `implement`, `taskstoissues`
- `scripts/bash/`（`common.sh`, `check-prerequisites.sh`, `create-new-feature.sh`, `setup-plan.sh`, `setup-tasks.sh`）
- テンプレート: `spec-template.md`, `plan-template.md`, `tasks-template.md`, `checklist-template.md`, `constitution-template.md`
- `hooks/posttooluse_analyze_marker.py`
- `.geass/extensions.yml` の仕組み
- 独自の状態管理: `.geass/feature.json`、`specs/NNN-` の採番、`SPECIFY_FEATURE_DIRECTORY`、`branch.<branch>.geass-base-commit`、root worktree のブランチ状態に対するゲート
- 設定キー: `require_rdra_approval`, `require_analyze_before_execute`, `feature_numbering`
- `scripts/create-feature-worktree.sh`, `scripts/create-hotfix-worktree.sh`（`start-worktree.sh` に統合する）と、`harness-common.sh` のうち使わなくなる関数

## 4. RDRA データモデルの拡張

### 4.1 原則 `principles`

ファイルは `docs/rdra/principles.yaml`、id の接頭辞は `pr` とする。

```yaml
- id: pr.audit-log
  name: 全ての更新操作を監査ログに残す
  description: 誰が・いつ・何を変更したかを 1 年間保持する
  category: security        # business | quality | security | engineering | technology
  level: must               # must | should
  scope: [inf.order, uc.order-cancel]   # 空なら system 全体
- id: pr.tdd
  name: テストファーストで実装する
  category: engineering
  level: must
  scope: []
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | `pr.<slug>` | ○ | 名前を変えても変えない |
| `name` | string | ○ | |
| `description` | string | | 何を満たせば守ったことになるか |
| `category` | enum | ○ | `business`（業務上の決まり）、`quality`（性能・可用性などの品質）、`security`、`engineering`（開発プロセス）、`technology`（技術スタック） |
| `level` | enum | ○ | `must` / `should` |
| `scope` | id の配列 | | 既定値は空（system 全体） |

- `scope` はリレーション **`pr.scope`** として扱う。参照先の接頭辞は `act` / `ext` / `buc` / `uc` / `scr` / `inf` / `st` とする。
- constitution にあったバージョン番号・批准日・Sync Impact Report は廃止する。変更履歴は git と承認記録で追う。

### 4.2 受け入れ条件 `acceptance`

ユースケース（`uc.*`）にフィールド `acceptance` を追加する。

```yaml
- id: uc.order-cancel
  name: 注文をキャンセルする
  acceptance:
    - id: ac1
      given: 発送前の注文がある
      when: 購入者がキャンセルする
      then: 注文は「キャンセル済み」になり、在庫が戻る
    - id: ac2
      given: 発送済みの注文がある
      when: 購入者がキャンセルしようとする
      then: キャンセルできない旨が表示され、状態は変わらない
```

- `id` はユースケース内で一意のスラッグとし、文言を変えても変えない。
- `given` は省略できる。`when` と `then` は必須である。
- 外部からは `uc.order-cancel#ac1` の形で参照する（計画の `Covers:` と `/trace` で使う）。

### 4.3 検証ルール

| ルール | 重さ |
|---|---|
| `pr.scope` の参照先が存在しない | error |
| `acceptance` の `id` がユースケース内で重複している | error |
| `acceptance` の `when` または `then` が空 | error |
| この feature で追加・変更されたユースケースに `acceptance` が 1 件もない | `rdra_request_review` がエラーを返し、レビュー依頼を拒否する |
| `level: must` の原則に `description` がない | warning |

受け入れ条件の有無をモデル全体の error にしないのは、既存のモデルが一斉に壊れるのを避けるためである。feature の差分に限定する。

### 4.4 ハッシュ・問い合わせ・差分

- `principles` と `acceptance` はモデルのハッシュに含める。承認後に変更すると、承認は stale になる。
- SQLite のインデックスに `principles`、`principle_scope`、`acceptance` の各テーブルを追加する。
- `rdra_diff` は、受け入れ条件を ac 単位の追加・変更・削除として報告する。
- MCP ツール（`rdra_upsert`, `rdra_link` など）は新しい種別とリレーションを受け付ける。`/rdra` スキルのモデル参照表も更新する。

### 4.5 レビュー UI

- 新しいビュー「原則」を追加する。図ではなく、category ごとにまとめた一覧表とする。feature の差分はハイライトし、`scope` の参照先へは一覧からジャンプできるようにする。GUI から原則の追加・編集・削除もできる。
- ユースケースの inspector に、受け入れ条件の表示と編集を追加する。
- ユースケース複合図では、`must` 原則がかかっている UC にバッジを付ける。クリックすると原則ビューに移動する。

## 5. `/trace`

### 5.1 計画の書き方の約束

`superpowers:writing-plans` は改変しない。`/rdra` の完了時の案内に、次の約束を含める。

- 計画ファイルは `docs/superpowers/plans/` に置き、この feature ブランチで commit する。
- 各タスクの見出しの直下に、1 行で `Covers: uc.order-cancel#ac1, pr.audit-log` を書く。

### 5.2 照合（CLI `cli.js trace`）

判定は決定的な照合で行う。スキル `/trace` は CLI を実行し、結果の説明と計画の修正を支援する。

1. **対象の計画**: 差分の基点（§6.3）から HEAD までに追加・変更され、作業ツリーに存在する `docs/superpowers/plans/*.md`。0 件ならエラーにする。複数あれば 1 つの計画として扱う。
2. **カバーすべき項目**:
   - この feature で追加・変更されたユースケースの、全ての `acceptance`
   - この feature で追加・変更された `level: must` の原則
   - 上記ユースケースを `scope` に含む `must` 原則（原則自体に変更がなくても含める）
3. **照合の対象外**: `scope` が空で、`category` が `engineering` または `technology` の原則。機能と対応づくものではないため、レポートに「適用される原則」として一覧で示すだけにする。
4. **判定**: 計画中の全ての `Covers:` 行を集め、次の 3 種類を報告する。
   - 未カバー: カバーすべき項目のうち、どの `Covers:` にも現れないもの → 失敗
   - 不明な参照: モデルに存在しない id を指す `Covers:` → 失敗
   - 範囲外の参照: この feature の差分外の項目を指す `Covers:` → 警告のみ
5. **マーカー**: 成功したら `.geass/state/trace-<feature ID>.json` に `{ "rdra_hash", "plans": { "<path>": "<sha256>" }, "traced_at" }` を書く。このディレクトリは gitignore の対象とする。

出力は JSON（機械向け）と、人間向けの要約の両方を返す。終了コードは成功が `0`、照合の失敗が `1`、実行できなかった場合（feature 外、計画なしなど）が `2` とする。

## 6. 実行前ゲート

### 6.1 対象と条件

ゲートは feature ブランチ（`<gitflow.prefix.feature>*`）上でのみ動作する。それ以外のブランチでは何もしない。

| 対象 | 条件 |
|---|---|
| Skill `superpowers:writing-plans` | RDRA が承認済みで、承認後に変更されていない |
| Skill `superpowers:executing-plans`, `superpowers:subagent-driven-development` | 上の条件に加えて、trace マーカーがあり、その `rdra_hash` と計画のハッシュがどちらも現在の状態と一致している |
| Edit / Write / MultiEdit で `docs/rdra/reviews/*.json` を操作する | 常に拒否する（feature ブランチ以外でも拒否する） |

### 6.2 実装

- 判定はすべて CLI の **`cli.js gate --tool <tool> --skill <name> | --path <file>`** に集約する。終了コード `0` は許可、`1` は拒否で、拒否の理由を JSON で返す。
- `hooks/pretooluse_gate.py` は CLI を呼び、結果を PreToolUse の応答に変換するだけにする。
- **fail closed**: CLI が実行できない、時間切れになる、または出力を解釈できない場合は、ゲート対象の操作を拒否する。
- `hooks/hooks.json` から PostToolUse のフックを削除する。

### 6.3 feature の解決（`src/feature.ts` を置き換える）

```
branch = git branch --show-current
prefix = git config gitflow.prefix.feature（既定値 feature/）

branch が prefix で始まる → feature ID     = branch から prefix を除いたもの
                           承認記録        = docs/rdra/reviews/<feature ID>.json
                           差分の基点      = merge-base(HEAD, <base>)
                             <base> = git config gitflow.branch.<branch>.base
                                      → なければ gitflow.branch.develop（既定値 develop）
それ以外                  → feature 外（ゲートは何もしない。rdra_request_review は拒否）
```

- `<base>` はリモート追跡ブランチ（`origin/<base>`）があればそちらを優先し、なければローカルブランチを使う。
- 承認記録の形式は 0.11.0 の `rdra-review.json` を引き継ぐが、`base_commit` は記録しない（毎回上記の方法で求める）。
- 承認記録の置き場所を `docs/rdra/reviews/` に移すことで、`specs/` ディレクトリは geass では使わなくなる。

## 7. `/feature-start` と `/fix-start`

### 7.1 `scripts/start-worktree.sh <feature|hotfix> <name>`

1. `git fetch`（リモートがなければ省略）。
2. 基点を決める。feature は `gitflow.branch.develop`、hotfix は `gitflow.branch.master` とし、`origin/<基点>` があればそちらを使う。
3. `git worktree add -b <prefix><name> <path> <基点>`。`<path>` は現行と同じく `<repo root>/.claude/worktrees/<ブランチ名>` とする（例: `.claude/worktrees/feature/42-order-cancel`）。
4. `git config gitflow.branch.<prefix><name>.base <基点のブランチ名>` を記録する。
5. worktree に `.claude/settings.local.json` を書く（現行と同じ）。
6. `terminal_multiplexer` に従ってタブを開き、`claude "<起動プロンプト>"` を実行する。
7. 標準出力に `BRANCH_NAME` と `WORKTREE_PATH` を返す。

root worktree のブランチ状態は問わない。ブランチがすでに存在するなど、git が失敗した場合は、そのエラーをそのまま返して終了する。

### 7.2 `/feature-start <説明>`

1. 説明文から英語のスラッグ（2〜4 語）を作る。
2. `origin` が GitHub のリモートなら `gh issue create --title "Feature: <説明>" --body <説明>` を実行し、Issue 番号を得る。GitHub 以外のリモート、または失敗した場合は、番号なしで続行し、その旨を報告する。
3. `start-worktree.sh feature <#>-<slug>`（番号がなければ `<slug>`）を、起動プロンプト `/rdra <説明>` で実行する。
4. ブランチ名、worktree のパス、Issue の URL を報告する。

### 7.3 `/fix-start <説明>`

`start-worktree.sh hotfix <slug>` を実行し、新しいタブで `superpowers:systematic-debugging` を起動する。hotfix には RDRA のゲートがかからない。

### 7.4 完了

`git flow feature finish` は、`develop` を checkout してマージする動作が worktree の運用と両立しないため使わない。完了は `superpowers:finishing-a-development-branch` の流れで `gh pr create`（向き先は base）を実行し、PR をマージする。`/rdra` の案内で、PR の本文に RDRA の差分の要約と承認記録へのリンクを含めるよう示す。

## 8. 移行

### 8.1 constitution の取り込み（`/rdra` に組み込む）

`/rdra` の最初に次の処理を追加する。条件は「`.geass/memory/constitution.md` が存在し、`docs/rdra/principles.yaml` がない」ことである。

1. constitution の各原則と各セクションを読み、`pr.*` の案に分解する。`category` は内容から推定し、`level` は MUST / SHOULD / NON-NEGOTIABLE などの表現から決める。
2. 案を一覧で示し、対話で確認・修正する。
3. 確定したら `rdra_upsert` で追加し、`git rm .geass/memory/constitution.md` で削除する。
4. この変更は、その feature の差分としてレビュー UI での承認を通る。

### 8.2 その他

- `specs/` 配下の既存の成果物: 何もしない（過去の記録として残す）。
- 旧設定キー（`require_rdra_approval`, `require_analyze_before_execute`, `feature_numbering`）: 読まずに無視する。`/rdra` の初回実行時に、不要になったことを一度だけ案内する。
- 旧形式の承認記録: 移行しない。進行中の feature は 0.12.0 に上げる前に完了させることを、CHANGELOG と README に明記する。

## 9. テスト

| 対象 | テスト |
|---|---|
| rdra-server（vitest） | principles と acceptance のスキーマ／`pr.scope` の参照整合性／差分内の UC に受け入れ条件がない場合のレビュー依頼拒否／ハッシュへの反映／ac 単位の差分／`trace`（未カバー、不明な参照、範囲外の参照、engineering・technology 原則の対象外扱い、計画やモデルの変更によるマーカーの失効）／`gate`（各スキルの判定、承認記録の編集拒否、feature 外で何もしないこと）／git flow のブランチからの feature と基点の解決 |
| Web UI（Playwright） | 原則ビューの表示・差分のハイライト・参照先へのジャンプ、UC の inspector での受け入れ条件の編集 |
| フックとスクリプト（pytest） | ゲートが CLI の結果を正しく中継すること、CLI が失敗したら拒否すること、feature 以外のブランチで何もしないこと、`start-worktree.sh` によるブランチ・base の記録・worktree の作成 |
| スキル（pytest） | 削除したスキルと `scripts/bash/` への参照が残っていないこと、`/rdra` と `/trace` の記述が CLI とツール名に一致していること |

## 10. リリース

- 0.12.0 として、1 本の破壊的変更でリリースする。
- `plugin.json` の説明と keywords から spec-kit への言及を外す。
- README を、パイプライン全体（git flow・gh・superpowers との分担）の説明に書き直す。
- CHANGELOG に移行手順（§8）を記載する。
- `rdra-server/dist/` を再ビルドして commit する。
