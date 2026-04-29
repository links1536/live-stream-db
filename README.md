# live-stream-db

VTuberの配信予定を収集し、JSON形式で出力するクローラー兼APIサーバーです。Cloudflare Workers (Python) 上で動作します。

## 主な機能

- **YouTube Data API 連携**: 動画の最新ステータス（ライブ中、アーカイブ済みなど）を取得
- **WebSub (PubSubHubbub) 対応**: YouTubeからのリアルタイム通知を受信し、新着動画を即座に検知
- **RSS フィード巡回**: 定期的にRSSをチェックし、通知漏れをカバー
- **スケジュール管理**: 未来の配信予定を収集・ソートし、公開用JSON (`lives.json`) を生成

## アーキテクチャ

- **Runtime**: Cloudflare Workers (Python)
- **Storage**: 
  - **KV**: 
    - `KV_CACHE`: 配信情報の内部キャッシュ
    - `KV_OUTPUT`: 公開用 `lives.json` の保存先
  - **Durable Objects**: `YouTubeNoticesCache` (新着動画IDの一時保持)
  - **D1**: マスターデータ・配信情報をまとめたSQLデータベース
- **Messaging**: Cloudflare Queues (WebSubの登録処理を非同期に実行)

## 環境変数 (Environment Variables)

本プロジェクトは `src/build.py` を使用して `wrangler.toml` を動的に生成します。

### ビルド時に必要な変数 (GitHub Actions Secrets等)
| 変数名 | 内容 |
|---|---|
| `VAR_KV_MASTER_ID` | マスターデータ用KVのID |
| `VAR_KV_CACHE_ID` | キャッシュ用KVのID |
| `VAR_KV_OUTPUT_ID` | 公開データ用KVのID |
| `VAR_QUEUE_YOUTUBE_WEBSUB_RESISTER` | YouTubeのWebSub登録用Queue名 |
| `VAR_QUEUE_YOUTUBE_SCHDULE_UPDATE` | YouTubeのスケジュール更新用Queue名 |
| `VAR_QUEUE_YOUTUBE_RSS_FEED` | YouTubeのRSSフィード用Queue名 |
| `VAR_D1_DATABASE_NAME` | データ保存用D1のデータベース名 |
| `VAR_D1_DATABASE_ID` | データ保存用D1のデータベースUUID |

### 実行時に必要なシークレット (`wrangler secret put`等)
| 変数名 | 内容 |
|---|---|
| `ADMIN_USERNAME` | 管理画面用ユーザー名 |
| `ADMIN_PASSWORD` | 管理画面用パスワード |
| `YOUTUBE_DATA_API_KEY` | YouTube Data API v3 キー |
| `YOUTUBE_WEBSUB_CALLBACK_URL` | 通知受取用URL |
| `YOUTUBE_WEBSUB_VERIFY_TOKEN` | WebSub検証トークン |
| `YOUTUBE_WEBSUB_SECRETS` | WebSub署名検証用シークレット |

## セットアップとデプロイ

1. 環境変数を設定します。
2. `python src/build.py` を実行して `wrangler.toml` を生成します。
3. `wrangler deploy` でデプロイします。
