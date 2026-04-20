import stickytape
import python_minifier
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

def build_and_deploy():
	# 1. wrangler.toml の生成 (提示されたコード)
	if not generate_wrangler_toml():
		return False

	# 2. コードのインライン化と圧縮 (src/entry.py を起点にする)
	print("Bundling and minifying code...")
	try:
		# 自作モジュールをすべて1つにまとめる
		bundled_code = stickytape.script_bundle(
			"src/entry.py", 
			add_python_paths=["src"] 
		)
		
		# 不要なコメントや型ヒント、空白を削ってCPUパース負荷を軽減
		minified_code = python_minifier.minify(
			bundled_code,
			remove_annotations=True,      # 型ヒント削除
			remove_literal_statements=True # docstring削除
		)

		# 出力ディレクトリ作成と書き出し
		os.makedirs("dist", exist_ok=True)
		with open("dist/index.py", "w", encoding="utf-8") as f:
			f.write(minified_code)
			
	except Exception as e:
		print(f"Build Error: {e}")
		return False

	return True
if __name__ == "__main__":
	if not build_and_deploy():
		exit(1)
	
	print("Deployment completed successfully")
