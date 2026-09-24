# RDRA モデリングと承認ゲート 設計書

- 日付: 2026-09-25
- 対象バージョン: geass 0.11.0
- 状態: 設計承認済み（実装計画の作成前）

## 1. 目的と位置づけ

geass のパイプラインの最上流に RDRA（Relationship Driven Requirement Analysis）によるモデリングを追加する。
人間または AI（MCP 経由）が RDRA モデルを作成し、人間がローカルの Web アプリで図を確認して承認（GOサイン）した時点で、後続の `/design-spec` 以降が自動で始まる。承認されていない、または承認後に変更された RDRA モデルでは、後続のスキルをゲートでブロックする。

進め方の方針:

- まず既存の geass に「前段」として追加し、使ってみてから RDRA を中心に geass 全体を作り直すかを判断する。
- 承認後は `/design-spec` に自動で進むが、その先の既存の人間による確認（Design Decision Gate、`/specify` の対話と草案承認など）は残す。RDRA 承認だけを唯一の人間ゲートにして実装まで無人で走らせる形は、運用で RDRA から後続の判断がほぼ自明になると確認できてから検討する。
- 試行期間中はプロジェクト単位のオプトインとし、無効なプロジェクトでは既存の動作を一切変えない。

### 範囲外（今回は作らない）

- RDRA の要求モデル、利用シーン、バリエーション・条件（後から要素種別として追加できる構造にはする）
- 複数人での承認、ホスト型のレビュー画面、GitHub PR を承認の場にする仕組み
- 承認後に `/implement` まで無人で進む自律モード

## 2. 決定事項の要約

| 論点 | 決定 |
|---|---|
| モデルの粒度 | プロジェクト全体で 1 つの RDRA モデルを育てる。承認は feature ごとの差分単位 |
| 正本 | git 管理の YAML（`docs/rdra/`）。SQLite は問い合わせ用に毎回 YAML から生成する使い捨てのインデックス |
| 扱う要素 | アクター、外部システム、BUC、ユースケース、画面、イベント、情報、状態（8 種類） |
| パイプライン上の位置 | 最上流。`/feature-start` → `/rdra` → Web で承認 → `/design-spec` → `/specify` → … |
| レビュー画面 | plugin 同梱のローカル Web サーバー（承認者はローカルの開発者本人） |
| 人間の作成手段 | Web アプリ上の GUI 編集。YAML の直接編集も可 |
| 実装方式 | 1 つの Node/TypeScript プロセスが MCP サーバー（stdio）と HTTP サーバーを兼ねる |

DB を正本にする案は採らない。geass は feature ごとに worktree とブランチを分けるため、DB が正本だとブランチをまたいでモデルが共有され、差分・マージ・履歴・PR レビューを自前で作り直すことになるため。規模（要素数は大きくても数千）の面でも DB は不要で、確認のしやすさは SQLite インデックスへの問い合わせで満たす。

## 3. データモデル

### 3.1 配置

```
docs/rdra/
  actors.yaml
  external-systems.yaml
  bucs.yaml
  usecases.yaml
  screens.yaml
  events.yaml
  information.yaml
  states.yaml
  layout/
    system-context.yaml
    business-flow.yaml
    usecase-composite.yaml
    information-model.yaml
    state-model.yaml
```

要素の種類ごとに 1 ファイル。`layout/` には GUI 上の座標だけを置き、意味のあるデータとは分ける。

### 3.2 ID

`<種類の接頭辞>.<スラッグ>` 形式。表示名を変えても ID は変わらない。

| 種類 | 接頭辞 | 例 |
|---|---|---|
| アクター | `act` | `act.customer` |
| 外部システム | `ext` | `ext.payment-gateway` |
| BUC | `buc` | `buc.ordering` |
| ユースケース | `uc` | `uc.place-order` |
| 画面 | `scr` | `scr.cart` |
| イベント | `evt` | `evt.payment-request` |
| 情報 | `inf` | `inf.order` |
| 状態モデル | `st` | `st.order` |

状態モデル内の状態はモデル内でのみ一意なスラッグ（例: `draft`）とし、遷移は `st.order:draft->placed` の形式で参照する。

### 3.3 要素のスキーマ

全要素は `id`、`name`、`description`（任意）を持つ。関連は参照する側に書く。

```yaml
# actors.yaml / external-systems.yaml / screens.yaml
- id: act.customer
  name: 顧客
  description: 商品を購入する一般利用者

# bucs.yaml
- id: buc.ordering
  name: 注文受付
  business: 販売業務          # 業務名は BUC の属性
  actors: [act.customer, act.operator]
  usecases: [uc.place-order, uc.cancel-order]

# usecases.yaml
- id: uc.place-order
  name: 注文する
  actors: [act.customer]
  screens: [scr.cart]
  events: [evt.payment-request]
  information:
    - { ref: inf.order, access: create }   # access: create | read | update | delete
    - { ref: inf.stock, access: update }
  transitions: [st.order:draft->placed]

# events.yaml
- id: evt.payment-request
  name: 決済依頼
  # source: act.xxx / ext.xxx           # 省略可。システム外からの発生元
  target: ext.payment-gateway              # 省略可。act / ext のいずれか（システム外の送り先）
  # ユースケースとの関連は usecases.yaml の events 側にだけ書く

# information.yaml
- id: inf.order
  name: 注文
  attributes: [注文番号, 注文日時, 合計金額]  # 任意。自由記述の属性名リスト
  related:
    - { ref: inf.customer, label: 注文者 }

# states.yaml
- id: st.order
  name: 注文状態
  information: inf.order
  states:
    - { id: draft, name: 下書き }
    - { id: placed, name: 注文済み }
  transitions:
    - { from: draft, to: placed }
```

スキーマは zod で定義し、MCP、HTTP、検証、CLI で共有する。要素種別は「種別定義（接頭辞、ファイル名、スキーマ、参照フィールド）」の表として登録し、後から要求モデルなどを追加するときは定義を 1 件足すだけで済む構造にする。

### 3.4 差分の基準

- 基準は feature ブランチの分岐点コミット。`create-feature-worktree.sh` がブランチ作成時に `git config branch.<ブランチ名>.geass-base-commit <コミット>` として保存するよう変更する（現状は標準出力に表示するだけで保存されていない。`.geass/feature.json` は既存の `_persist_feature_json` が `feature_directory` だけで上書きするため保存先に使わない）。
- この設定がない場合（`/feature-start` を経ずに作業している場合）は、`git merge-base HEAD <ルート worktree のブランチ>` で求める。それも失敗した場合は差分機能だけを無効にする。
- ベース側のモデルは `git show <base>:docs/rdra/<file>` で読む。ベースに `docs/rdra/` がなければ空のモデルとみなす。
- 差分は要素単位で計算する: 追加 / 削除 / 変更（どのフィールド、どの関連が変わったか）。

### 3.5 整合性チェック

| 区分 | 内容 | 承認への影響 |
|---|---|---|
| エラー | 存在しない ID への参照、ID の重複、ID の接頭辞と種別の不一致、存在しない状態を指す遷移、スキーマ違反 | 承認できない |
| 警告 | 画面にもイベントにも紐づかないユースケース、どのユースケースからも触られない情報、どの BUC にも属さないユースケース、どのユースケースにも起こされない状態遷移 | 承認できる（画面に表示） |

### 3.6 承認ハッシュ

`layout/` を除いた全 YAML をパースし、キーをソートした正規化 JSON にして SHA-256 を取る。座標だけの変更、キーの順序や空白の変更ではハッシュは変わらない。ハッシュの計算は Node 側（`model` モジュール）の 1 箇所だけで行い、Python から必要なときは CLI を呼ぶ。

## 4. rdra-server の構成

### 4.1 プロセス

- plugin の `.mcp.json` から `node ${CLAUDE_PLUGIN_ROOT}/rdra-server/dist/server.js` として起動する。
- 1 プロセスが MCP サーバー（stdio）と HTTP サーバーを兼ねる。
- 対象は作業ディレクトリの git ルート。Claude のセッション、worktree、サーバーが 1 対 1 対 1 で対応する。
- HTTP ポートは空きを動的に割り当て、`127.0.0.1` にのみバインドする。
- `docs/rdra/` がなくても起動し、最初の書き込み時に作る。
- Node 22.13 未満では明確なエラーメッセージを出して終了する（SQLite に `node:sqlite` を使うため）。

### 4.2 モジュール

| モジュール | 役割 | 依存先 |
|---|---|---|
| `model` | 種別定義、zod スキーマ、YAML の読み書き、ID 解決、正規化とハッシュ | なし |
| `validate` | 整合性チェック（エラー／警告） | model |
| `diff` | ベースとの要素単位の差分 | model, git |
| `index` | YAML から SQLite（メモリ上）を作り直し、SQL での問い合わせに答える | model |
| `store` | 唯一の書き込み窓口。操作の直列適用、検証、保存、変更通知、ファイル監視 | model, validate, index |
| `review` | `rdra-review.json` の読み書き、状態遷移 | model |
| `mcp` | MCP ツール定義 | store, index, diff, review |
| `http` | REST API、WebSocket による変更のプッシュ、Web アプリの配信 | store, index, diff, review |
| `cli` | `wait-review`、`check-approval` | model, review |

### 4.3 書き込みの流れ

1. MCP と Web のどちらからの変更も「操作」として `store` に渡る。操作は `upsert`（要素の追加・更新）、`delete`、`link`、`unlink`、`layout`（座標のみ）の 5 種類。複数の操作をまとめて 1 回の保存にできる。
2. `store` は操作を 1 つずつ直列に適用し、適用後のモデルを検証する。エラー区分の問題を新たに生む操作はまとめて拒否し、ファイルは変更しない。
3. 保存後、モデルのバージョン（ハッシュ）を更新し、WebSocket で接続中の画面に通知する。
4. Web からの操作には「どのバージョンを見て編集したか」を添える。現在のバージョンと異なれば 409 を返す（楽観的ロック）。MCP からの操作はバージョン指定を任意とする。
5. 要素を削除すると、その要素を参照している関連も同じ保存で削除する。削除対象の一覧は操作の結果として返す。
6. YAML がサーバー外（エディタなど）で編集された場合はファイル監視で検知して再読み込みし、画面に通知する。

### 4.4 MCP ツール

| ツール | 内容 |
|---|---|
| `rdra_get_model` | モデル全体、または種別を指定して取得 |
| `rdra_query` | SQLite インデックスへの読み取り専用 SQL |
| `rdra_validate` | エラーと警告の一覧 |
| `rdra_diff` | ベースとの要素単位の差分 |
| `rdra_upsert` / `rdra_delete` / `rdra_link` / `rdra_unlink` | 更新系。配列で渡せば 1 回の保存にまとめる |
| `rdra_request_review` | レビュー状態を「待機中」にし、レビュー画面の URL を返す |
| `rdra_review_status` | レビュー状態（待機中 / 承認済み / 差し戻し＋コメント / 未依頼）と、承認後の変更有無 |

SQLite の表は、要素種別ごとの表（`actors`、`usecases` など）と、関連をまとめた `relations(from_id, to_id, kind, attrs)` 表とする。

## 5. Web アプリ

React + React Flow。レイアウトの自動配置に elkjs。Vite でビルドした成果物を `http` モジュールが配信する。

### 5.1 ビュー

同じモデルを 5 つの図として投影する。同じ要素はどの図でも同一の実体。

1. システムコンテキスト図: アクター、外部システム、システム
2. 業務フロー図: BUC ごとのアクターとユースケース
3. ユースケース複合図: ユースケースを中心に画面、イベント、情報、遷移
4. 情報モデル図: 情報と関連
5. 状態モデル図: 状態モデルごとの状態遷移と、遷移を起こすユースケース

座標はビューごとに `layout/<view>.yaml` に保存する。座標のない要素は elkjs で自動配置する。

### 5.2 編集

- ツールパレットから要素を置く、ノード間をドラッグして関連を張る、サイドパネルで属性（名前、説明、アクセス種別など）を編集する。
- 削除時は、一緒に消える関連を確認ダイアログで示す。
- すべての編集は 4.3 の操作として送る。409 を受けたら最新のモデルを読み直し、編集が取り消されたことを通知する。

### 5.3 差分表示

画面上部の切り替えで「全体」と「この feature の差分」を選ぶ。差分モードでは追加を緑、変更を黄、削除を赤の破線で表示する。変更された要素の詳細パネルには変更前後の値を並べる。

### 5.4 レビューパネル

- 検証結果: エラーと警告の一覧。クリックで該当要素にジャンプする。
- コメント: 全体へのコメントと、要素に紐づけたコメント。
- 承認ボタン: エラー 0 件のときだけ押せる。
- 差し戻しボタン: 今回のレビューでコメントが 1 件以上あるときだけ押せる。

## 6. レビュー記録

`specs/<feature>/rdra-review.json` に保存し、git にコミットする（監査対象として、どの内容が承認されてから実装が始まったかを PR 上で追えるようにするため）。

```json
{
  "status": "approved",
  "base_commit": "8e31d97...",
  "approved_hash": "sha256:...",
  "requested_at": "2026-09-25T10:00:00+09:00",
  "decided_at": "2026-09-25T10:20:00+09:00",
  "rounds": [
    {
      "decision": "rejected",
      "decided_at": "2026-09-25T10:05:00+09:00",
      "comments": [
        { "target": "uc.place-order", "text": "在庫引当のタイミングを明記してほしい" },
        { "target": null, "text": "キャンセル業務が抜けている" }
      ]
    }
  ]
}
```

状態遷移: `none` →（`rdra_request_review`）→ `pending` →（承認）→ `approved` / （差し戻し）→ `rejected` →（`rdra_request_review`）→ `pending` …。`approved` の後にモデルが変わっても `status` は書き換えず、`approved_hash` と現在のハッシュの不一致で「承認後に変更あり」と判定する。

## 7. パイプラインへの組み込み

### 7.1 有効化

`.geass/init-options.json` に `require_rdra_approval`（真偽値、デフォルト `false`）を追加する。`false` のプロジェクトでは、ゲート、`/feature-start` の引き継ぎ先、後続スキルの動作をいずれも変えない。

### 7.2 `/feature-start`

有効時は、新しいタブで `/design-spec` の代わりに `/rdra` を起動する。引き継ぐ情報（`SPECIFY_FEATURE_DIRECTORY`、機能の説明）は現在と同じ。あわせて 3.4 のとおり分岐点コミットを `git config branch.<ブランチ名>.geass-base-commit` に保存する。

### 7.3 新スキル `/rdra`

0. `SPECIFY_FEATURE_DIRECTORY` が引き継がれていれば、それを `.geass/feature.json` の `feature_directory` に保存する（`/specify` と同じ形式）。これがないと、ゲートと rdra-server が feature を特定できず、ゲートが「feature の外」として素通しになるため。
1. `rdra_review_status` を確認する。差し戻しのコメントがあれば、それへの対応から始める。
2. `rdra_get_model` と `rdra_diff` で現状を把握する。
3. `/specify` と同様に 1 問ずつ対話し、外側から内側へ（アクター・外部システム → BUC → ユースケース → 画面・イベント → 情報 → 状態）モデルを MCP ツールで組み立てる。
4. `rdra_validate` のエラーが 0 件になったら `rdra_request_review` を呼び、URL をブラウザで開く。
5. `node ${CLAUDE_PLUGIN_ROOT}/rdra-server/dist/cli.js wait-review` をバックグラウンドで実行する。このコマンドは `rdra-review.json` を監視し、承認か差し戻しになった時点で終了する。
6. 差し戻しなら、コメントを読んで MCP で修正し、手順 4 に戻る。
7. 承認なら、`docs/rdra/` と `rdra-review.json` をコミットし、`/design-spec` を起動する（`SPECIFY_FEATURE_DIRECTORY` と機能の説明はそのまま引き継ぐ）。

`/rdra` は feature の外でも単独で使える（モデルの整理など）。ただしレビュー記録は `specs/<feature>/` に置くため、feature の外では手順 4〜7（レビューと引き継ぎ）は行わず、編集と検証だけを行う。`rdra_request_review` も feature の外では理由を示してエラーを返す。

### 7.4 後続スキルでの RDRA の利用

`/design-spec` と `/specify` は、承認済みの RDRA 差分があれば入力として読み込む。

| RDRA 要素 | 反映先 |
|---|---|
| 情報、状態 | `docs/schema/` |
| 画面 | `client-screen`、`client-ui-flow` |
| イベント、外部システム | `docs/api/` |
| BUC、ユースケース | spec のユーザーストーリー |

spec のユーザーストーリーには対応するユースケースの ID（例: `uc.place-order`）を記載し、既存の Design ID と同じ形でトレースできるようにする。

### 7.5 ゲート

有効時、`hooks/pretooluse_gate.py` は `design-spec`、`specify`、`plan`、`tasks`、`implement`、`executing-plans`、`subagent-driven-development` の実行前に `node .../cli.js check-approval` を呼ぶ。

| 結果 | ゲートの動作 |
|---|---|
| 承認済みで、現在のハッシュと一致 | 通す |
| 未依頼 / 待機中 / 差し戻し | 「`/rdra` でレビューを完了してください」としてブロック |
| 承認後に変更あり | 「承認後に RDRA が変更されました。再レビューが必要です」としてブロックし、変更された要素を示す |
| Node が使えない、CLI が失敗した | 「Node 22.13 以上が必要です」などの理由を示してブロック（確認できないまま通さない） |
| feature の外（`check-prerequisites.sh` が失敗） | 通す（既存のゲートと同じ扱い） |

実装中に要件の変更が必要になったら、`/rdra` を再実行して再承認を得ればゲートが解除される。

承認記録の保護: 承認と差し戻しは Web 画面からだけ行えるようにし、MCP には承認するツールを用意しない。さらに有効時は、`Edit` / `Write` / `MultiEdit` で `rdra-review.json` を書き換えようとする操作をゲートで拒否する。Bash などから直接書き換える経路までは防がない（既知の制約）。

## 8. エラー処理

| 状況 | 挙動 |
|---|---|
| YAML の構文エラー | 直前の正常な状態を保持する。画面上部にファイル名と行番号を表示して編集をロックし、MCP の更新系ツールも同じ理由で拒否する。ファイルが直ればロックを解除する |
| 存在しない ID への参照を生む操作 | 操作を拒否し、ファイルは変更しない |
| Web の編集が古いバージョンに基づく | 409。画面は最新を読み直して通知する |
| ベースコミットが取れない | 差分機能だけを無効にする |
| Node 22.13 未満 / 未インストール | MCP サーバーは終了。有効なプロジェクトではゲートがブロックする |
| `wait-review` の待機中にセッションが終了 | 記録はファイルに残る。`/rdra` の再実行時に手順 1 で状態を引き継ぐ |

## 9. テスト

| 対象 | 方法 | 主な観点 |
|---|---|---|
| `model`、`validate`、`diff`、`index` | vitest + YAML フィクスチャ | 正常系、参照エラー、要素単位の差分（追加・変更・削除・関連の変更） |
| ハッシュ | vitest | 座標のみ、キー順、空白の変更で不変。意味のある変更で変化 |
| `store` | vitest | MCP と HTTP からの同時操作の直列化、楽観的ロック、拒否時にファイルが変わらないこと |
| `review`、`cli` | vitest | 状態遷移、`wait-review` の終了条件、`check-approval` の各結果 |
| Web 全体 | Playwright | 要素追加 → 関連の接続 → 差し戻し → 承認の一連の流れ |
| ゲート | pytest | 未承認、承認済み、承認後に変更あり、無効時は素通し |

## 10. 配布

- `rdra-server/` に TypeScript のソースとビルド済みの `dist/` を置く。`dist/` には esbuild で 1 ファイルにまとめたサーバーと CLI、Vite でビルドした Web アプリを含める。plugin の利用者は `npm install` を必要としない。
- plugin の `.mcp.json` にサーバーを登録する。
- `dist/` の更新漏れを防ぐため、CI で `npm run build` 後に差分が出ないことを確認する。
- README に `require_rdra_approval` と Node 22.13 以上の要件を追記する。
- バージョンは 0.11.0。
