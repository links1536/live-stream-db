# live-stream-db

## プロジェクト説明

YouTube の配信予定と配信状態を収集し、公開用 `lives.json` を生成する Cloudflare Workers アプリケーションです

YouTube Data API、WebSub、RSS を使って動画情報を収集し、Cloudflare D1 に保存した上で Cloudflare KV に `lives.json` を出力します

`live-stream-db-pages` はこの `KV_OUTPUT` を参照して公開画面を表示します

## 構成

- Runtime: Cloudflare Workers
- 言語: JavaScript
- 主な処理:
  - WebSub 通知受信
  - RSS 巡回
  - YouTube Data API 更新
  - `lives.json` 生成

## 主なエントリポイント

- `src/entry.js`: Worker 本体
- `src/build.py`: `wrangler.toml` 生成
- `src/updater/`: 定期更新処理
- `src/api/`: YouTube API / RSS / WebSub
- `src/repository/`: D1 / KV / Durable Object アクセス
- `setup-d1.sql`: D1 初期セットアップ SQL

## ストレージ種別

| バインド名 / データ | ストレージ種別 | 用途 |
|---|---|---|
| `DB` | Cloudflare D1 | `youtube_schedules` や `rss_last_updated` の保存 |
| `KV_CACHE` | Cloudflare KV | 動画 ID 一覧などの軽量キャッシュ |
| `KV_OUTPUT` | Cloudflare KV | 公開用 `lives.json` の保存 |
| `YOUTUBE_NOTICES_CACHE` | Durable Object Storage | WebSub / RSS で見つけた新着動画 ID の一時保持 |
| WebSub 登録用 Queue | Cloudflare Queue | WebSub 登録要求の非同期処理 |
| スケジュール更新用 Queue | Cloudflare Queue | YouTube Data API 更新対象の分割実行 |
| RSS 取得用 Queue | Cloudflare Queue | RSS 取得対象チャンネルの非同期処理 |

## 必要な設定値

`src/build.py` は環境変数から `wrangler.toml` を生成します

### `build.py` 実行前に必要な環境変数

| 変数名 | 内容 |
|---|---|
| `VAR_KV_MASTER_ID` | マスターデータ用 KV ID |
| `VAR_KV_CACHE_ID` | 動画 ID キャッシュ用 KV ID |
| `VAR_KV_OUTPUT_ID` | 公開用 `lives.json` を保存する KV ID |
| `VAR_QUEUE_YOUTUBE_WEBSUB_RESISTER` | WebSub 登録用 Queue 名 |
| `VAR_QUEUE_YOUTUBE_SCHDULE_UPDATE` | スケジュール更新用 Queue 名 |
| `VAR_QUEUE_YOUTUBE_RSS_FEED` | RSS 取得用 Queue 名 |
| `VAR_D1_DATABASE_NAME` | D1 データベース名 |
| `VAR_D1_DATABASE_ID` | D1 データベース ID |

### デプロイ先に必要なシークレット

| 変数名 | 内容 |
|---|---|
| `ADMIN_USERNAME` | 管理画面用ユーザー名 |
| `ADMIN_PASSWORD` | 管理画面用パスワード |
| `YOUTUBE_DATA_API_KEY` | YouTube Data API v3 キー |
| `YOUTUBE_WEBSUB_CALLBACK_URL` | WebSub コールバック URL |
| `YOUTUBE_WEBSUB_VERIFY_TOKEN` | WebSub 検証トークン |
| `YOUTUBE_WEBSUB_SECRETS` | WebSub 署名検証シークレット |

## Cloudflare 側の設定方法

### 1. D1 データベースを作成する

Cloudflare ダッシュボードで次を開きます

- `Workers & Pages`
- `D1`
- `Create database`

作成後、`setup-d1.sql` の内容を適用します

管理画面または `wrangler d1 execute` で投入できます

### 2. KV を作成する

Cloudflare ダッシュボードで次を開きます

- `Workers & Pages`
- `KV`

少なくとも次の 2 つを用意します

- 動画 ID キャッシュ用 KV
- 公開用 `lives.json` 保存用 KV

`build.py` には `VAR_KV_MASTER_ID` もありますが、現在の Worker 実装で直接使っているのは `KV_CACHE` と `KV_OUTPUT` です

### 3. Queue を作成する

Cloudflare ダッシュボードで次を開きます

- `Workers & Pages`
- `Queues`
- `Create queue`

次の 3 つを用意します

- WebSub 登録用 Queue
- スケジュール更新用 Queue
- RSS 取得用 Queue

### 4. Durable Object を使う Worker をデプロイする

`YOUTUBE_NOTICES_CACHE` は Worker 側の Durable Object バインドです

これはダッシュボード上で単体作成するというより、Worker のデプロイ設定に含めて作成されます

### 5. 環境変数を設定する

ローカルまたは CI で `src/build.py` 実行前に環境変数を設定します

```powershell
python src/build.py
```

これで `wrangler.toml` が生成されます

### 6. シークレットを設定する

Cloudflare ダッシュボードで次を開きます

- `Workers & Pages`
- 対象 Worker
- `Settings`
- `Variables`

`Secrets` に次を設定します

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `YOUTUBE_DATA_API_KEY`
- `YOUTUBE_WEBSUB_CALLBACK_URL`
- `YOUTUBE_WEBSUB_VERIFY_TOKEN`
- `YOUTUBE_WEBSUB_SECRETS`

### 7. デプロイする

```powershell
wrangler deploy
```

デプロイ後、Cloudflare ダッシュボードで次を確認します

- `Settings > Variables` に D1 / KV / Queue / Durable Object の各バインドが入っていること
- `Triggers` に Cron が入っていること
- `/admin` に Basic 認証でアクセスできること
- `/webhooks/youtube` が公開されていること

## 運用フロー

- Cron で WebSub 再登録、RSS 取得、スケジュール更新を回します
- WebSub と RSS で見つけた動画 ID を Durable Object / Queue に積みます
- YouTube Data API の結果を D1 に保存します
- 表示対象期間のデータを `lives.json` に変換して `KV_OUTPUT` に保存します

## 管理用エンドポイント

Basic 認証つきで次を実行できます

- `/admin`: 管理画面
- `/admin/youtube-websub-resister`: WebSub 再登録
- `/admin/youtube-fetch-rss`: RSS 手動取得
- `/admin/youtube-update`: スケジュール更新
