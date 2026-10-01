# 設計文書とテンプレート

RDRA モデル（`docs/rdra/`）が決めるのは「何を作るか」、設計モデル（`docs/design/`）が決めるのは「どう作るか」のうち、後続の feature が前提にする骨格です。設計モデルが持つのは要素の id・種類・関係と最小限の属性だけで、詳細はここにある設計文書（ネイティブ形式）に書き、要素の `doc` からリポジトリ相対パスで指します。`/design` が対話の中で必要なものだけを作ります。テンプレートは `cp "${CLAUDE_PLUGIN_ROOT}/templates/<テンプレート>" <置き場所>` で複製して使います。

## 設計モデルの要素から指す文書

| 設計モデルの要素 | 設計文書 | 置き場所 | テンプレート | RDRA のどこから導くか |
|---|---|---|---|---|
| `comp.*`（全体） | 構成と配置 | `docs/design/architecture.md` | `infrastructure-deployment-template.md` | 外部システム、technology 原則 |
| `comp.*`（`datastore`） | 保存先の一覧と使い分け | `docs/schema/overview.md` | なし | 情報 |
| `tbl.*`（RDB・ドキュメント DB） | 保存先ごとのスキーマ | `docs/schema/storage-<name>.md` | `schema-er-diagram-template.md` | 情報、状態モデル（状態の列と許される遷移） |
| `tbl.*`（DynamoDB） | 保存先ごとのスキーマ | `docs/schema/storage-<name>.md` | `schema-dynamodb-access-patterns-template.md` | 情報、ユースケースの情報アクセス |
| `tbl.*`（Redis） | キー設計 | `docs/schema/storage-<name>.md` | `schema-redis-key-design-template.md` | 情報 |
| `adr.*` | なし（判断の内容は設計モデルに書く） | — | — | 原則 |

同じ保存先のテーブルは 1 つの文書にまとめ、各テーブルの `doc` に同じパスを書いてかまいません。文書の見出しには設計モデルの id を併記してください（例: `### 注文テーブル (tbl.orders)`）。カラム・インデックス・制約は文書と migration が正本で、設計モデルには持たせません。

## まだ設計モデルの要素がない文書

API・外部インタフェース、ログ・運用、画面の部位は、今後の版で設計モデルの要素になる予定です。それまでは必要に応じて文書だけを作り、見出しに関係する RDRA や設計モデルの id を併記してください。

| 設計文書 | 置き場所 | テンプレート | RDRA のどこから導くか |
|---|---|---|---|
| イベント・メッセージの形式 | `docs/schema/data-formats.md` | `schema-data-formats-template.md` | イベント |
| REST API | `docs/api/openapi.yaml` | `api-openapi-template.yaml` | ユースケースの情報アクセス（CRUD）、アクター |
| GraphQL API | `docs/api/graphql-schema.md` | `api-appsync-graphql-template.md` | 同上 |
| 外部連携とデータの流れ | `docs/api/data-flow.md` | `api-data-flow-template.md` | イベント、外部システム（連携する `comp.*`） |
| エラー処理 | `docs/api/error-handling.md` | `api-error-handling-template.md` | 受け入れ条件（失敗系） |
| アクセス制御 | `docs/security/access-control.md` | `security-access-control-matrix-template.md` | アクター × ユースケース × 情報アクセス、security 原則 |
| 認証・データ保護 | `docs/security/authentication.md`、`data-protection.md` | なし | security 原則 |
| ローカルでのテスト | `docs/testing/local-testing.md` | `testing-local-testing-template.md` | engineering 原則、外部システム |
| ログ | `docs/operations/logging.md` | `operations-logging-template.md` | quality・security 原則 |
| 監視 | `docs/operations/monitoring.md` | `operations-monitoring-template.md` | quality 原則 |
| 画面遷移 | `docs/client/ui-ux.md` | `client-ui-flow-template.md` | 画面、ユースケース |
| 画面ごとの設計 | `docs/client/screen-<name>.md` | `client-screen-template.md` | 画面と、その画面を使うユースケース |

## モデルを変えるべきとき

設計中に RDRA モデル自体の変更が必要だと分かったら（画面が足りない、モデルにない情報がある）、設計を止めて `/rdra` に戻ってください。承認後に RDRA を変えると RDRA と設計の両方の承認が無効になり、再レビューが必要になります。設計モデルの変更（テーブルを足す、コンポーネントを分ける）は `/design` で行い、設計のレビューを通します。
