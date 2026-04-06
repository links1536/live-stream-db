from workers import WorkerEntrypoint, Response, fetch
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

# --- 設定 ---
PAST_DAYS = 1

# --- 設定定数 ---
MASTER_DATA_KEY = "master_data"
STATUS_KEY = "status.json"
OUTPUT_KEY = "lives.json"

async def load_master_data(env):
	"""KVからマスターデータを読み込む"""
	data = await env.KV_MASTER.get(MASTER_DATA_KEY)
	if not data:
		return []
	return json.loads(data)

async def load_status(env):
	"""KVからキャッシュを読み込む"""
	data = await env.KV_CACHE.get(STATUS_KEY)
	if not data:
		return {}, {}
	parsed = json.loads(data)
	if isinstance(parsed, dict) and "videos" in parsed:
		return parsed["videos"], parsed.get("last_updates", {})
	return parsed, {}

async def save_status(env, status_cache, last_updates):
	"""KVにキャッシュを保存する"""
	data = {
		"videos": status_cache,
		"last_updates": last_updates
	}
	await env.KV_CACHE.put(STATUS_KEY, json.dumps(data, ensure_ascii=True))

async def save_data_json(env, schedules):
	"""公開用JSONを生成する"""
	public_data = {
		"updated_at": datetime.now(timezone.utc).isoformat(),
		"all_schedules": schedules
	}
	await env.KV_OUTPUT.put(OUTPUT_KEY, json.dumps(public_data, ensure_ascii=True))
	print(f"Generated {OUTPUT_KEY} ({len(schedules)} streams)")

async def get_video_info_from_rss(channel_id):
	"""RSSから最新動画情報を取得"""
	video_info = []
	headers = {}
	try:
		url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
		response = await fetch(url, headers={"method": "GET", "headers": headers})
		if response.status != 200:
			print(f"RSS Error: {channel_id} - {response.status}")
			return None
		
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

def is_within_period(video_data, start_limit):
	"""配信データが有効期間内かつ削除フラグが立っていないか判定"""
	# すでに削除済みのものは除外
	if video_data.get("status") == "removed":
		return False

	# 開始時間が不明なものは「予定あり」として残す
	start_time_str = video_data.get("start_time_iso")
	if not start_time_str:
		return True

	# 文字列をdatetimeに変換（Zと+00:00の両方に対応）
	try:
		start_time = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
		return start_limit <= start_time
	except ValueError:
		# パース失敗時は安全のため残す
		return True

async def update_schedules(api_key, vtubers, status_cache, last_updates):
	"""ステータス更新メインロジック"""
	# チャンネルごとの最終チェック日時を保持する辞書を初期化
	rss_check_times = last_updates.get("rss_check_times", {})
	
	if not api_key:
		print("[ERROR] YouTube APIキーが設定されていません")
		return status_cache
	
	
	# 1. RSSから新着IDを検知
	new_ids_count = 0
	now_str = datetime.now(timezone.utc).isoformat()

#	for vtuber in vtubers:
#		vtuber_name = vtuber.get("Name", "Unknown Vtuber")
#		channel_ids = vtuber.get("YouTubeID", [])
#
#		for channel_id in channel_ids:
#			# この配信者の最終チェック日時を取得（なければ1970年）
#			last_update_str = rss_check_times.get(channel_id, "1970-01-01T00:00:00+00:00")
#			last_update = datetime.fromisoformat(last_update_str.replace("Z", "+00:00"))
#
#			print(f"RSS Request: {vtuber_name} ({channel_id}) - Last Check: {last_update_str}")
#
#			# RSS取得試行
#			rss_videos = await get_video_info_from_rss(channel_id)
#
#			# RSSが空（エラーまたは動画なし）の場合は、このチャンネルの日時更新をスキップ
#			if rss_videos is None or len(rss_videos) == 0:
#				# get_video_info_from_rssが例外等でNoneを返すケースを想定
#				print(f"Skipping update for {vtuber_name} due to RSS error.")
#				continue
#
#			# 取得に成功した場合のみ処理
#			for info in rss_videos:
#				video_id = info["video_id"]
#				updated_str = info["updated"]
#				updated_date = datetime.fromisoformat(updated_str.replace("Z", "+00:00"))
#				if updated_date <= last_update:
#					continue
#
#				if video_id not in status_cache:
#					status_cache[video_id] = {
#						"streamer_name": vtuber_name,
#						"color": vtuber.get("Color", "#ffffff"),
#						"video_id": video_id,
#						"status": "upcoming",
#						"tags": vtuber.get("Tags", []),
#						"agency": vtuber.get("Agency") or "Other"
#					}
#					new_ids_count += 1
#			
#			# --- 成功した時のみ、この配信者の最終更新日時を書き換える ---
#			rss_check_times[channel_id] = now_str
#			print(f"Success {vtuber_name} ({channel_id}) - Last Check: {now_str}")


	# 更新された個別チェック日時をメタデータに戻す
	last_updates["rss_check_times"] = rss_check_times
	print(f"New or updated videos: {new_ids_count}")

	# 2. 終了以外をAPIで状態更新
	target_ids = [vid for vid, d in status_cache.items() if d.get("status") != "archived"]
	print(f"Refreshing status for {len(target_ids)} active videos...")

	youtube_url = "https://www.googleapis.com/youtube/v3/videos"

	update_count = 0
	for i in range(0, len(target_ids), 50):
		chunk = target_ids[i:i+50]
		try:
			ids = ",".join(chunk)

			# リクエスト
			request_url = f"{youtube_url}?key={api_key}&part=snippet,liveStreamingDetails&id={ids}&maxResults=50"
			response = await fetch(request_url, headers={ "method": "GET" })
			if response.status != 200:
				print(f"API Error: {response.status}")
				break

			data = await response.json()
			found_ids = []
			
			for item in data.get("items", []):
				video_id = item["id"]
				found_ids.append(video_id)
				live = item.get("liveStreamingDetails")
				if not live:
					continue

				if "actualEndTime" in live:
					status_cache[video_id]["status"] = "archived"
				elif "actualStartTime" in live:
					status_cache[video_id]["status"] = "live"
				else:
					status_cache[video_id]["status"] = "upcoming"

				status_cache[video_id]["title"] = item["snippet"]["title"]
				status_cache[video_id]["thumbnail"] = item["snippet"]["thumbnails"]["medium"]["url"]
				status_cache[video_id]["start_time_iso"] = live.get("scheduledStartTime") or live.get("actualStartTime")
				update_count += 1

			# 見つからなかったので削除
			for video_id in chunk:
				if video_id not in found_ids:
					status_cache[video_id]["status"] = "removed"
					print(f"Video marked as removed: {video_id}")

		except Exception as e:
			print(f"API Error: {e}")
			break

	print(f"Successfully updated {update_count} video details.")

	# 3. 期間外のデータをお掃除
	now = datetime.now(timezone.utc)
	start_limit = (now - timedelta(days=PAST_DAYS))

	final_cache = {
		id: video for id, video in status_cache.items()
		if is_within_period(video, start_limit)
	}
	print(f"Cleanup: {len(status_cache)} -> {len(final_cache)}")

	return final_cache

async def generate_data_json(env, status_cache):
	"""公開用JSONを生成する"""
	# start_time_iso が存在し、かつ None でないものだけを抽出
	valid_schedules = [
		v for v in status_cache.values() 
		if v.get("start_time_iso") is not None
	]
	
	# リストをソート
	schedules = sorted(
		valid_schedules, 
		key=lambda x: x["start_time_iso"]
	)
	await save_data_json(env=env, schedules=schedules)

async def on_scheduled(env):
	start_time = datetime.now(timezone.utc)
	print(f"=== Execution started at {start_time.isoformat()} ===")
	
	# 1. マスターデータ読み取り
	vtubers = await load_master_data(env=env)
	print(f"Loaded {len(vtubers)} vtubers")
	
	# 2. キャッシュ読み取り
	cache, last_updates = await load_status(env=env)
	
	# 3. データ更新
	api_key = env.YOUTUBE_DATA_API_KEY
	updated_cache = await update_schedules(api_key, vtubers, cache, last_updates)
	
	# 4. キャッシュ保存
	await save_status(env=env, status_cache=updated_cache, last_updates=last_updates)
	
	# 5. 公開用JSONのみ生成
	await generate_data_json(env=env, status_cache=updated_cache)
	
	print("=== Execution completed ===")
	
class Default(WorkerEntrypoint):
	# runs based on "triggers" in wrangler config
	async def scheduled(self, controller, env, ctx):
		await on_scheduled(self.env)

	# テスト用に表示でも
	async def fetch(self, request):
		await on_scheduled(self.env)
		return Response("")