# live-stream-db

## プロジェクト説明

YouTube、Twitch、ツイキャスの配信予定と配信状態を収集し、公開用 `lives.json` を生成する Cloudflare Workers アプリケーションです

各プラットフォームの API と YouTube WebSub / RSS、Twitch EventSub、TwitCasting WebHook を使って配信情報を収集し、Cloudflare D1 に保存した上で Cloudflare KV に `lives.json` を出力します

`live-stream-db-pages` はこの `KV_OUTPUT` を参照して公開画面を表示します

## 関連リポジトリ

- `live-stream-db-data`: D1 に投入する配信者マスターデータを生成します
- `live-stream-db-pages`: このリポジトリが生成した `lives.json` を表示するフロントエンドです

## 前提環境

- Python 3.12 以上
- Wrangler CLI 4 系
- Cloudflare D1 / KV / Queues / Durable Objects が利用できるアカウント
- YouTube Data API v3 キー
- Twitch アプリケーションの Client ID / Client Secret
- TwitCasting API v2 アプリケーションの Client ID / Client Secret

## 構成

- Runtime: Cloudflare Workers
- 言語: JavaScript
- 主な処理:
  - YouTube WebSub / Twitch EventSub / TwitCasting WebHook 通知受信
  - RSS 巡回
  - YouTube Data API 更新
  - Twitch / TwitCasting API 更新
  - `lives.json` 生成

## 主なエントリポイント

- `src/entry.js`: Worker 本体
- `src/build.py`: `wrangler.toml` 生成
- `src/updater/`: 定期更新処理
- `src/api/`: YouTube / Twitch / TwitCasting API、RSS、WebSub
- `src/repository/`: D1 / KV / Durable Object アクセス
- `setup-d1.sql`: D1 初期セットアップ SQL

## セットアップ概要

1. `setup-d1.sql` と `live-stream-db-data` で生成した `master.sql` を D1 に適用します
3. KV、Queue、Durable Object を作成します
4. 環境変数を設定して `python src/build.py` を実行します
5. Secrets を投入して `wrangler deploy` します
6. `/admin`、`/webhooks/youtube`、`/webhooks/twitcasting` を確認します

## ストレージ種別

| バインド名 / データ | ストレージ種別 | 用途 |
|---|---|---|
| `DB` | Cloudflare D1 | YouTube、Twitch、TwitCasting の配信情報などの保存 |
| `KV_CACHE` | Cloudflare KV | 動画 ID 一覧などの軽量キャッシュ |
| `KV_OUTPUT` | Cloudflare KV | 公開用 `lives.json` の保存 |
| `YOUTUBE_NOTICES_CACHE` | Durable Object Storage | WebSub / RSS で見つけた新着動画 ID の一時保持 |
| WebSub 登録用 Queue | Cloudflare Queue | WebSub 登録要求の非同期処理 |
| 統合更新用 Queue | Cloudflare Queue | 配信更新、Webhookイベント、購読操作と `lives.json` 最終生成の直列処理 |
| RSS 取得用 Queue | Cloudflare Queue | RSS 取得対象チャンネルの非同期処理 |

## 必要な設定値

`src/build.py` は環境変数から `wrangler.toml` を生成します

### `build.py` 実行前に必要な環境変数

| 変数名 | 内容 |
|---|---|
| `VAR_KV_CACHE_ID` | 動画 ID キャッシュ用 KV ID |
| `VAR_KV_OUTPUT_ID` | 公開用 `lives.json` を保存する KV ID |
| `VAR_QUEUE_YOUTUBE_WEBSUB_REGISTER` | WebSub 登録用 Queue 名 |
| `VAR_QUEUE_STREAM_UPDATE` | 統合更新用 Queue 名 |
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
| `TWITCH_CLIENT_ID` | Twitch アプリケーションの Client ID |
| `TWITCH_CLIENT_SECRET` | Twitch アプリケーションの Client Secret |
| `TWITCH_EVENTSUB_CALLBACK_URL` | `https://<Workerのホスト>/webhooks/twitch` |
| `TWITCH_EVENTSUB_SECRET` | EventSub署名用の10～100文字のランダムな文字列 |
| `TWITCASTING_CLIENT_ID` | TwitCasting API v2 アプリケーションの Client ID |
| `TWITCASTING_CLIENT_SECRET` | TwitCasting API v2 アプリケーションの Client Secret |
| `TWITCASTING_WEBHOOK_SIGNATURE` | TwitCasting アプリケーションに設定した WebHook 署名キー |

## Cloudflare 側の設定方法

### 1. D1 データベースを作成する

Cloudflare ダッシュボードで次を開きます

- `Workers & Pages`
- `D1`
- `Create database`

作成後、`setup-d1.sql` と `live-stream-db-data` 側で生成した `output/master.sql` の両方を適用してください

- `setup-d1.sql`: D1 のテーブル構成を初期化します
- `output/master.sql`: マスターデータを投入または差し換えます

管理画面または `wrangler d1 execute` で投入できます

確認する項目:

- D1 の `Database ID`
- D1 の `Database name`
- `setup-d1.sql` と `output/master.sql` の両方が適用済みであること

### 2. KV を作成する

Cloudflare ダッシュボードで次を開きます

- `Workers & Pages`
- `KV`

少なくとも次の 2 つを用意します

- 動画 ID キャッシュ用 KV
- 公開用 `lives.json` 保存用 KV

確認する項目:

- `KV_CACHE` に使う Namespace ID
- `KV_OUTPUT` に使う Namespace ID

### 3. Queue を作成する

Cloudflare ダッシュボードで次を開きます

- `Workers & Pages`
- `Queues`
- `Create queue`

次の 3 つを用意します

- WebSub 登録用 Queue
- 統合更新用 Queue
- RSS 取得用 Queue

確認する項目:

- 各 Queue の名前
- `build.py` に渡す文字列が Queue 名と一致していること

### 4. Durable Object を使う Worker をデプロイする

`YOUTUBE_NOTICES_CACHE` は Worker 側の Durable Object バインドです

これはダッシュボード上で単体作成するというより、Worker のデプロイ設定に含めて作成されます

### 5. 環境変数を設定する

ローカルまたは CI で `src/build.py` 実行前に環境変数を設定します

例:

```powershell
$env:VAR_KV_CACHE_ID="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
$env:VAR_KV_OUTPUT_ID="yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
$env:VAR_QUEUE_YOUTUBE_WEBSUB_REGISTER="youtube-websub-register"
$env:VAR_QUEUE_STREAM_UPDATE="stream-update"
$env:VAR_QUEUE_YOUTUBE_RSS_FEED="youtube-rss-feed"
$env:VAR_D1_DATABASE_NAME="live-stream-db"
$env:VAR_D1_DATABASE_ID="zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"
```

```powershell
python src/build.py
```

これで `wrangler.toml` が生成されます

生成後に確認する項目:

- `KV_CACHE` と `KV_OUTPUT` の Namespace ID が想定通り入っていること
- Queue 名が想定通り入っていること
- `DB` の `database_id` が想定通り入っていること

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
- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `TWITCH_EVENTSUB_CALLBACK_URL`
- `TWITCH_EVENTSUB_SECRET`
- `TWITCASTING_CLIENT_ID`
- `TWITCASTING_CLIENT_SECRET`
- `TWITCASTING_WEBHOOK_SIGNATURE`

CLI を使う場合の例:

```powershell
wrangler secret put ADMIN_USERNAME
wrangler secret put ADMIN_PASSWORD
wrangler secret put YOUTUBE_DATA_API_KEY
wrangler secret put YOUTUBE_WEBSUB_CALLBACK_URL
wrangler secret put YOUTUBE_WEBSUB_VERIFY_TOKEN
wrangler secret put YOUTUBE_WEBSUB_SECRETS
wrangler secret put TWITCH_CLIENT_ID
wrangler secret put TWITCH_CLIENT_SECRET
wrangler secret put TWITCH_EVENTSUB_CALLBACK_URL
wrangler secret put TWITCH_EVENTSUB_SECRET
wrangler secret put TWITCASTING_CLIENT_ID
wrangler secret put TWITCASTING_CLIENT_SECRET
wrangler secret put TWITCASTING_WEBHOOK_SIGNATURE
```

### 7. デプロイする

```powershell
wrangler deploy
```

デプロイ後、Cloudflare ダッシュボードで次を確認します

- `Settings > Variables` に D1 / KV / Queue / Durable Object の各バインドが入っていること
- `Triggers` に Cron が入っていること
- `/admin` に Basic 認証でアクセスできること
- `/webhooks/youtube` が公開されていること
- `/webhooks/twitch` が公開され、EventSub challengeに応答できること
- `/webhooks/twitcasting` が公開されており、TwitCasting アプリケーションの WebHook URL に設定されていること

初回動作確認の順番:

1. `/admin` に Basic 認証で入れることを確認します
2. 管理画面から WebSub 再登録を実行し、Queue に流せることを確認します
3. 管理画面から Webhook Subscription Sync を実行し、YouTube、Twitch、ツイキャスの購読結果を確認します
4. 管理画面から RSS 取得を実行し、起動できることを確認します
5. 管理画面からスケジュール更新を実行し、`KV_OUTPUT` に `lives.json` が生成されることを確認します

## 運用フロー

- 毎日 UTC 23:30 にYouTube WebSub、Twitch EventSub、TwitCasting WebHookをマスターと同期します
- Twitch EventSubは配信開始・終了を即時受信し、終了時のVOD取得に失敗した場合は1分後、5分後、15分後に再試行します
- WebSub と RSS で見つけた動画 ID を Durable Object / Queue に積みます
- YouTubeは5分ごと、Twitch / TwitCasting の整合更新は毎日 UTC 23:45 に実行し、更新チャンクと `lives.json` 最終処理を統合 Queue で順次処理します
- TwitCasting の開始・終了・配信予定イベントは WebHook で即時受信し、変更時だけ D1 と `lives.json` を直接更新します
- 更新結果を D1 に保存し、最後に表示対象期間のデータを `lives.json` に変換して `KV_OUTPUT` に保存します

## 管理用エンドポイント

Basic 認証つきで次を利用できます

- `GET /admin`: 管理画面
- `GET /admin/lives.json`: `KV_OUTPUT` に保存されている最新の `lives.json` をダウンロード
- `POST /admin/youtube-websub-register`: WebSub 再登録
- `POST /admin/youtube-fetch-rss`: RSS 手動取得
- `POST /admin/youtube-update`: スケジュール更新
- `POST /admin/twitch-update`: Twitch 配信更新
- `POST /admin/twitcasting-update`: TwitCasting 配信更新
- `POST /admin/twitcasting-webhook-register`: TwitCasting WebHook 手動登録
- `POST /admin/webhook-subscriptions-sync`: 全プラットフォームの通知購読同期
- `POST /admin/full-update`: 全プラットフォーム更新

## TwitCasting API の運用

- [TwitCasting API v2 のアプリケーション登録](https://twitcasting.tv/applications.php)で Client ID / Client Secret を取得します
- 読み取り API はアプリケーション単位の Basic 認証で呼び出します。ユーザーごとの OAuth 認可は不要です
- アプリケーションの WebHook URL に `https://<Workerのホスト>/webhooks/twitcasting` を設定し、署名キーを `TWITCASTING_WEBHOOK_SIGNATURE` に同じ値で登録します
- `livestart`、`liveend`、`liveschedulecreate`、`livescheduleupdate`、`livescheduledelete` を毎日 UTC 23:30 にマスターと同期します
- 初回構築、WebHook URL変更、通知不達からの復旧時は、管理画面の Webhook Subscription Sync で即時同期できます
- WebHook同期ではD1に保存した数値user IDを30日間再利用し、新規追加または再検証期限を迎えたscreen IDだけをAPIで解決します
- user ID解決は5人単位のQueueへ分割し、1分あたり最大2バッチに遅延します。一部が失敗した場合、成功済みIDはD1から再利用し、未解決分だけをQueueの再配信で処理します
- 毎日 UTC 23:45 に通知漏れを整合する全件更新を実行します。60 requests / 60 sec 制限を超えないよう、対象を15ユーザー単位に分割し、Queue で1分ずつ遅延させます
- 現在配信、直近7日の配信予定、表示期間内の過去配信を取得します
- 新規環境では `setup-d1.sql`、既存環境では `migrate-twitcasting.sql` を D1 に適用してからデプロイしてください

```powershell
wrangler d1 execute <DATABASE_NAME> --remote --file=migrate-twitcasting.sql
```

## Twitch EventSub の運用

- TwitchアプリケーションのEventSub callbackとして `https://<Workerのホスト>/webhooks/twitch` を使用します
- `TWITCH_EVENTSUB_SECRET`は10～100文字のランダムな値をSecretとして登録します
- `stream.online`と`stream.offline`を配信者ごとに購読し、毎日 UTC 23:30 にマスターとの差分、失効、重複を同期します
- 配信終了後は対応するTwitch VODの`stream_id`を照合してアーカイブへ置き換えます
- 新規環境では`setup-d1.sql`、既存環境では`migrate-twitch-eventsub.sql`をD1へ適用してからデプロイしてください

```powershell
wrangler d1 execute <DATABASE_NAME> --remote --file=migrate-twitch-eventsub.sql
```

## 補足

- `wrangler.toml` は `src/build.py` で生成します。生成物は `.gitignore` 対象です
- Queue は分割更新のために利用しており、実行時間制限に収まるよう設計しています

## 無料枠の消費量を試算する

隣接する `live-stream-db-data/data` の現在の登録者数を読み取り、1人につき1日1件の配信、5人につき1日1件の動画があるものとして試算します。複数プラットフォームを登録している配信者は、登録先から均等に1つを選ぶものとしてYouTube、Twitch、TwitCastingの通知数へ配分します。動画はYouTube通知として扱います。

```powershell
npm run estimate:free-tier
```

別のマスターデータを使う場合は、データディレクトリを第1引数で指定できます。CLIではD1の現在値を取得できないため、YouTube追跡件数は通知想定から推定します。実測した `youtube_schedules` の件数がある場合は第2引数で指定できます。

```powershell
node tools/estimate-free-tier-usage.mjs ..\live-stream-db-data\data 164
```

Cloudflare無料枠との比較は、実コードの処理経路に基づいて積み上げます。Cronは5分ごとのYouTube更新288回と日次処理2回です。YouTube更新は追跡件数を50件単位、Twitch整合更新は50人単位、TwitCasting整合更新は15人単位のQueueへ分割します。WebSub購読同期はYouTube IDごとに1メッセージを投入し、consumerはCloudflare Queues既定の最大10件単位です。実際のバッチ充填数は保証されないため、WebSub consumerに由来するWorker実行数は、最大件数まで詰まる場合と1件ずつ処理する場合の範囲で表示します。Queue操作は1メッセージにつき書き込み・読み取り・削除の3操作です。

YouTube通知は一日に均等・独立に発生すると仮定し、変更がある5分枠の期待値から `lives.json` 出力Queue、KVキャッシュ、KV出力の更新回数を計算します。TwitchとTwitCastingの日次整合処理は、安全側に1日1回の変更が発生するものとします。Durable Objectsは実装上のRPC呼び出し数とSQLiteストレージの基本行操作、D1は購読対象の同期と通知経路で変更する基本行数を計上します。

D1書き込みは購読対象の同期、通知に対応する基本状態変更、Twitch通知履歴の保存・処理済み更新・定常的な削除を計上します。再試行、手動実行、通知後に発生する追加の状態遷移、D1のインデックス書き込み・読み取り、CPU時間、データ容量、Durable Objectsの実行時間と保存容量は含みません。D1 rows readとDurable Objectsの実行時間はクエリプラン、実データの分布、実行時間に左右されるため、厳密な上限は実環境のメトリクスで確認してください。

同じ試算は管理コンソールにも表示されます。CLIはマスターデータのJSONファイル、管理コンソールはデプロイ先D1のマスター構成と `youtube_schedules` の現在件数を基準にします。

無料枠はCloudflare公式の [Workers](https://developers.cloudflare.com/workers/platform/limits/)、[Queues](https://developers.cloudflare.com/queues/platform/pricing/)、[Queuesのバッチ設定](https://developers.cloudflare.com/queues/configuration/batching-retries/)、[D1](https://developers.cloudflare.com/d1/platform/pricing/)、[KV](https://developers.cloudflare.com/kv/platform/pricing/)、[Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) に記載された日次上限と既定値を使用しています。
