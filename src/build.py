import os
from datetime import datetime

def get_env(secret_name):
	"""環境変数から値を取得"""
	return os.environ.get(secret_name)

def generate_wrangler_toml():
	"""wrangler.tomlを生成"""
	# シークレットからKV IDを取得
	kv_cache_id = get_env("VAR_KV_CACHE_ID")
	kv_output_id = get_env("VAR_KV_OUTPUT_ID")
	yt_register_websub_queue = get_env("VAR_QUEUE_YOUTUBE_WEBSUB_REGISTER")
	stream_update_queue = get_env("VAR_QUEUE_STREAM_UPDATE")
	yr_rss_feed_queue = get_env("VAR_QUEUE_YOUTUBE_RSS_FEED")
	d1_database_name = get_env("VAR_D1_DATABASE_NAME")
	d1_database_id = get_env("VAR_D1_DATABASE_ID")

	# 変数チェック
	if not all([
		kv_cache_id,
		kv_output_id,
		yt_register_websub_queue,
		stream_update_queue,
		yr_rss_feed_queue,
		d1_database_name,
		d1_database_id
	]):
		print("Error: KV, Queue, and D1 configuration must be set as secrets")
		return False
	
	# wrangler.tomlの内容
	content = f"""name = "live-stream-db"
main = "src/entry.js"
compatibility_date = "2026-04-09"

# 変数
[vars]
QUEUE_NAME_YOUTUBE_WEBSUB_REGISTER = "{yt_register_websub_queue}"
QUEUE_NAME_STREAM_UPDATE = "{stream_update_queue}"
QUEUE_NAME_YOUTUBE_RSS_FEED = "{yr_rss_feed_queue}"

# ログ設定
[observability]
[observability.logs]
enabled = true
invocation_logs = true

[observability.traces]
enabled = false


[triggers]
crons = [
	"0 19 * * *",	# 登録更新 1日1回
	#"45 * * * *",	# RSS更新 45分おき
	"*/5 * * * *",	# API更新 15分おき
]

# 通知受け取り用DurableObject
[[durable_objects.bindings]]
name = "YOUTUBE_NOTICES_CACHE"
class_name = "YouTubeNoticesCache"

[[durable_objects.bindings]]
name = "STREAM_UPDATE_COORDINATOR"
class_name = "StreamUpdateCoordinator"

[[migrations]]
tag = "v1"
new_sqlite_classes = [ "YouTubeNoticesCache" ]

[[migrations]]
tag = "v2"
new_sqlite_classes = [ "StreamUpdateCoordinator" ]

# キャッシュ用KV
[[kv_namespaces]]
binding = "KV_CACHE"
id = "{kv_cache_id}"

# lives.json用KV
[[kv_namespaces]]
binding = "KV_OUTPUT"
id = "{kv_output_id}"

[[d1_databases]]
binding = "DB"
database_name = "{d1_database_name}"
database_id = "{d1_database_id}"


# WebSub登録用キュー
[[queues.producers]]
binding = "QUEUE_YOUTUBE_WEBSUB_REGISTER"
queue = "{yt_register_websub_queue}"
delivery_delay = 60

[[queues.consumers]]
queue = "{yt_register_websub_queue}"
retry_delay = 300


# スケジュール情報更新用キュー
[[queues.producers]]
binding = "QUEUE_STREAM_UPDATE_TARGET"
queue = "{stream_update_queue}"
delivery_delay = 60

[[queues.consumers]]
queue = "{stream_update_queue}"
retry_delay = 300
max_batch_size = 1 #先にまとめるので、1個ずつ処理する
max_concurrency = 1

# RSS更新用キュー
[[queues.producers]]
binding = "QUEUE_YOUTUBE_RSS_FEED_TARGET"
queue = "{yr_rss_feed_queue}"
delivery_delay = 60

[[queues.consumers]]
queue = "{yr_rss_feed_queue}"
max_batch_size = 5 # パースとかいろいろ重いので、一度に最大5件とする
retry_delay = 300

"""
	
	# ファイルに書き込み
	with open("wrangler.toml", "w", encoding="utf-8") as f:
		f.write(content)
	
	print("Generated wrangler.toml successfully")
	return True

if __name__ == "__main__":
	if not generate_wrangler_toml():
		exit(1)
	
	print("Deployment completed successfully")
