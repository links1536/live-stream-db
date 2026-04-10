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
	callback_url = get_secret("VAR_YOUTUBE_WEBSUB_CALLBACK_URL")
	verify_token = get_secret("VAR_YOUTUBE_WEBSUB_VERIFY_TOKEN")

	
	if not all([kv_master_id, kv_cache_id, kv_output_id]):
		print("Error: All KV IDs must be set as secrets")
		return False
	
	# wrangler.tomlの内容
	content = f"""name = "live-stream-db"
main = "src/entry.py"
compatibility_date = "2026-04-09"
compatibility_flags = ["python_workers"]

# ログ設定
[observability]
[observability.logs]
enabled = true
invocation_logs = true

[observability.traces]
enabled = false

# 15分ごとに実行（調整可能）
[triggers]
crons = [
	"0 * * * *",
	"45 * * * *",
	"*/15 * * * *",
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
