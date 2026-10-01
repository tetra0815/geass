# 設計文書とテンプレート

RDRA モデル（`docs/rdra/`）が決めるのは「何を作るか」です。ここにある設計文書は、モデルでは決まらない「どう作るか」を書く場所です。`superpowers:brainstorming` で技術設計を詰めるときに、必要なものだけを作ってください。テンプレートは `cp "${CLAUDE_PLUGIN_ROOT}/templates/<テンプレート>" <置き場所>` で複製して使います。

| 設計文書 | 置き場所 | テンプレート | RDRA のどこから導くか |
|---|---|---|---|
| 保存先の一覧と使い分け | `docs/schema/overview.md` | なし | 情報 |
| 保存先ごとのスキーマ（RDB・ドキュメント DB） | `docs/schema/storage-<name>.md` | `schema-er-diagram-template.md` | 情報、状態モデル（状態の列と許される遷移） |
| 保存先ごとのスキーマ（DynamoDB） | `docs/schema/storage-<name>.md` | `schema-dynamodb-access-patterns-template.md` | 情報、ユースケースの情報アクセス |
| 保存先ごとのスキーマ（Redis） | `docs/schema/storage-<name>.md` | `schema-redis-key-design-template.md` | 情報 |
| イベント・メッセージの形式 | `docs/schema/data-formats.md` | `schema-data-formats-template.md` | イベント |
| REST API | `docs/api/openapi.yaml` | `api-openapi-template.yaml` | ユースケースの情報アクセス（CRUD）、アクター |
| GraphQL API | `docs/api/graphql-schema.md` | `api-appsync-graphql-template.md` | 同上 |
| 外部連携とデータの流れ | `docs/api/data-flow.md` | `api-data-flow-template.md` | イベント、外部システム |
| エラー処理 | `docs/api/error-handling.md` | `api-error-handling-template.md` | 受け入れ条件（失敗系） |
| アクセス制御 | `docs/security/access-control.md` | `security-access-control-matrix-template.md` | アクター × ユースケース × 情報アクセス、security 原則 |
| 認証・データ保護 | `docs/security/authentication.md`、`data-protection.md` | なし | security 原則 |
| デプロイ | `docs/infrastructure/deployment.md` | `infrastructure-deployment-template.md` | technology 原則 |
| ローカルでのテスト | `docs/testing/local-testing.md` | `testing-local-testing-template.md` | engineering 原則、外部システム |
| ログ | `docs/operations/logging.md` | `operations-logging-template.md` | quality・security 原則 |
| 監視 | `docs/operations/monitoring.md` | `operations-monitoring-template.md` | quality 原則 |
| 画面遷移 | `docs/client/ui-ux.md` | `client-ui-flow-template.md` | 画面、ユースケース |
| 画面ごとの設計 | `docs/client/screen-<name>.md` | `client-screen-template.md` | 画面と、その画面を使うユースケース |

設計の単位が RDRA の要素を実装するときは、見出しに RDRA の id を併記してください（例: `### 注文確認画面 (scr.order-confirm)`）。RDRA → 設計文書 → 計画のタスク → コードの対応を追えるようにするためです。

設計中に RDRA モデル自体の変更が必要だと分かったら（画面が足りない、モデルにない情報がある）、設計を止めて `/rdra` に戻ってください。承認後にモデルを変えると承認が無効になり、再レビューが必要になります。
