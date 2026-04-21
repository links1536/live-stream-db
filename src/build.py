import os
from datetime import datetime

def get_vars(secret_name):
	"""環境変数から値を取得"""
	return os.environ.get(secret_name)

def get_secret(secret_name):
	"""シークレットから値を取得"""
	return os.environ.get(secret_name)

def generate_wrangler_toml():
	"""wrangler.tomlを生成"""
	# シークレットからKV IDを取得
	kv_master_id = get_secret("VAR_KV_MASTER_ID")
	kv_cache_id = get_secret("VAR_KV_CACHE_ID")
	kv_output_id = get_secret("VAR_KV_OUTPUT_ID")
	yt_register_websub_queue = get_secret("VAR_YT_REGISTER_WEBSUB_QUEUE")

	
	if not all([kv_master_id, kv_cache_id, kv_output_id]):
		print("Error: All KV IDs must be set as secrets")
		return False
	
	# wrangler.tomlの内容
	content = f"""name = "live-stream-db"
main = "src/entry.js"
compatibility_date = "2026-04-09"

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

[[migrations]]
tag = "v1"
new_sqlite_classes = [ "YouTubeNoticesCache" ]

# マスター用KV
[[kv_namespaces]]
binding = "KV_MASTER"
id = "{kv_master_id}"

# キャッシュ用KV
[[kv_namespaces]]
binding = "KV_CACHE"
id = "{kv_cache_id}"

# lives.json用KV
[[kv_namespaces]]
binding = "KV_OUTPUT"
id = "{kv_output_id}"

[[queues.producers]]
binding = "RESISTER_YOUTUBE_WEBHOOK_IDS"
queue = "{yt_register_websub_queue}"
delivery_delay = 60

[[queues.consumers]]
queue = "{yt_register_websub_queue}"
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
