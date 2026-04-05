from workers import WorkerEntrypoint, Response, fetch
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

# --- 設定 ---
PAST_DAYS = 1
FUTURE_DAYS = 7

# KVバインディング
KV_MASTER = None
KV_CACHE = None
KV_OUTPUT = None

# --- 設定定数 ---
MASTER_DATA_KEY = "master_data"
STATUS_KEY = "status.json"
OUTPUT_KEY = "lives.json"

def load_master_data():
	"""KVからマスターデータを読み込む"""
	global KV_MASTER
	data = KV_MASTER.get(MASTER_DATA_KEY)
	if not data:
		return []
	return json.loads(data)

def load_status():
	"""KVからキャッシュを読み込む"""
	global KV_CACHE
	data = KV_CACHE.get(STATUS_KEY)
	if not data:
		return {}, {}
	parsed = json.loads(data)
	if isinstance(parsed, dict) and "videos" in parsed:
		return parsed["videos"], parsed.get("metadata", {})
	return parsed, {}

def save_status(status_cache, metadata):
	"""KVにキャッシュを保存する"""
	global KV_CACHE
	data = {
		"videos": status_cache,
		"metadata": metadata
	}
	KV_CACHE.put(STATUS_KEY, json.dumps(data, ensure_ascii=False))

async def get_video_info_from_rss(channel_id):
	"""RSSから最新動画情報を取得"""
	video_info = []
	headers = {"User-Agent": "live-stream-db"}
	try:
		url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
		response = await fetch(url, {"method": "GET", "headers": headers})
		if response.status != 200:
			return []
		
		content = await response.text()
		root = ET.fromstring(content)
		ns = {'atom': 'http://www.w3.org/2005/Atom', 'yt': 'http://www.youtube.com/xml/schemas/2015'}
		
		for entry in root.findall('atom:entry', ns):
			vid = entry.find('yt:videoId', ns).text
			updated = entry.find('atom:updated', ns).text
			video_info.append({"video_id": vid, "updated": updated})
	except Exception as e:
		print(f"RSS Error: {e}")
	return video_info

async def update_schedules(vtubers, status_cache, metadata):
	"""ステータス更新メインロジック"""
	last_update_str = metadata.get("last_update", "1970-01-01T00:00:00+00:00")
	print(f"Last RSS check: {last_update_str}")
	
	# SecretsからAPIキーを取得
	api_key = env.YOUTUBE_DATA_API_KEY
	if not api_key:
		print("[ERROR] YouTube APIキーが設定されていません")
		return status_cache
	
	youtube_url = "https://www.googleapis.com/youtube/v3/videos"
	headers = {"Authorization": f"Bearer {api_key}"}
	
	# 1. RSSから新着IDを検知
	new_ids_count = 0
	for v in vtubers:
		yt_ids = v.get("YouTubeID", [])
		if not yt_ids:
			continue
		for info in await get_video_info_from_rss(yt_ids[0]):
			vid = info["video_id"]
			updated_str = info["updated"]
			updated_date = datetime.fromisoformat(updated_str.replace("Z", "+00:00"))
			
			if updated_date <= datetime.fromisoformat(last_update_str.replace("Z", "+00:00")):
				continue

			if vid not in status_cache:
				status_cache[vid] = {
					"streamer_name": v["Name"],
					"color": v.get("Color", "#ffffff"),
					"video_id": vid,
					"status": "upcoming",
					"tags": v.get("Tags", []),
					"agency": v.get("Agency") or "Other"
				}
				new_ids_count += 1
	print(f"New or updated videos: {new_ids_count}")

	# 2. 終了以外をAPIで状態更新
	target_ids = [vid for vid, d in status_cache.items() if d.get("status") != "archived"]
	print(f"Refreshing status for {len(target_ids)} active videos...")

	update_count = 0
	for i in range(0, len(target_ids), 50):
		chunk = target_ids[i:i+50]
		try:
			params = {
				"part": "snippet,liveStreamingDetails",
				"id": ",".join(chunk)
			}
			response = await fetch(youtube_url, {
				"method": "GET",
				"headers": headers,
				"query": params
			})
			
			data = await response.json()
			found_ids = []
			
			for item in data.get("items", []):
				vid = item["id"]
				found_ids.append(vid)
				live = item.get("liveStreamingDetails")
				if not live:
					continue

				if "actualEndTime" in live:
					status_cache[vid]["status"] = "archived"
				elif "actualStartTime" in live:
					status_cache[vid]["status"] = "live"
				else:
					status_cache[vid]["status"] = "upcoming"

				status_cache[vid]["title"] = item["snippet"]["title"]
				status_cache[vid]["thumbnail"] = item["snippet"]["thumbnails"]["medium"]["url"]
				status_cache[vid]["start_time_iso"] = live.get("scheduledStartTime") or live.get("actualStartTime")
				update_count += 1

			for vid in chunk:
				if vid not in found_ids:
					status_cache[vid]["status"] = "removed"
					print(f"Video marked as removed: {vid}")

		except Exception as e:
			print(f"API Error: {e}")

	print(f"Successfully updated {update_count} video details.")

	# 3. 期間外のデータをお掃除
	now = datetime.now(timezone.utc)
	start_boundary = (now - timedelta(days=PAST_DAYS)).isoformat()
	end_boundary = (now + timedelta(days=FUTURE_DAYS)).isoformat()

	final_cache = {
		vid: d for vid, d in status_cache.items()
		if d.get("status") != "removed" and
		d.get("start_time_iso") and (start_boundary <= d["start_time_iso"] <= end_boundary)
	}
	print(f"Cleanup: {len(status_cache)} -> {len(final_cache)}")

	return final_cache

def generate_data_json(status_cache):
	"""公開用JSONを生成する"""
	schedules = sorted(status_cache.values(), key=lambda x: x["start_time_iso"])
	
	public_data = {
		"updated_at": datetime.now(timezone.utc).isoformat(),
		"all_schedules": schedules
	}
	
	KV_OUTPUT.put(OUTPUT_KEY, json.dumps(public_data, ensure_ascii=False, indent=4))
	print(f"Generated {OUTPUT_KEY} ({len(schedules)} streams)")

async def on_scheduled(env):
	global KV_MASTER, KV_CACHE, KV_OUTPUT
	KV_MASTER = env.KV_MASTER
	KV_CACHE = env.KV_CACHE
	KV_OUTPUT = env.KV_OUTPUT
	
	start_time = datetime.now(timezone.utc)
	print(f"=== Execution started at {start_time.isoformat()} ===")
	
	# 1. マスターデータ読み取り
	vtubers = load_master_data()
	print(f"Loaded {len(vtubers)} vtubers")
	
	# 2. キャッシュ読み取り
	cache, metadata = load_status()
	
	# 3. データ更新
	updated_cache = await update_schedules(vtubers, cache, metadata)
	
	# 4. キャッシュ保存
	metadata["last_update"] = start_time.isoformat()
	save_status(updated_cache, metadata)
	
	# 5. 公開用JSONのみ生成
	generate_data_json(updated_cache)
	
	print("=== Execution completed ===")
	
class Default(WorkerEntrypoint):
	# runs based on "triggers" in wrangler config
	async def scheduled(self, controller):
		await on_scheduled(self.env)

	# テスト用に表示でも
	async def fetch(self, request):
		await on_scheduled(self.env)