from datetime import datetime

import httputils

class YouTubeDataAPI:
	"""YouTube Data APIを利用するクラス"""

	def __init__(self, api_key):
		self.api_key = api_key
		self.youtube_url = "https://www.googleapis.com/youtube/v3/videos"

	def get_thumbnail(self, thumbnails):
		if not thumbnails:
			return ""
		
		for key in ("maxres", "standard", "high", "medium", "default"):
			thumb = thumbnails.get(key)
			if thumb:
				return thumb.get("url", "")

		return ""

	async def get_video_infos_async(self, target_ids, vtubers) -> tuple[dict, set]:
		"""ステータス更新メインロジック"""
		if not self.api_key:
			print("[ERROR] YouTube APIキーが設定されていません")
			return {}
		
		vtuber_map = {}

		for vtuber in vtubers:
			channel_ids = vtuber.get("YouTubeID")
			for channel_id in channel_ids:
				if not channel_id:
					continue
				vtuber_map[channel_id] = vtuber

		chunk_size = 50

		videos = {}
		removed_ids = set()
		start_times = {}

		for i in range(0, len(target_ids), chunk_size):
			chunk = target_ids[i:i+chunk_size]
			try:
				ids = ",".join(chunk)

				# リクエスト
				request_url = f"{self.youtube_url}?key={self.api_key}&part=snippet,liveStreamingDetails&id={ids}&maxResults={chunk_size}"
				response = await httputils.get(request_url)
				if response.status != 200:
					print(f"API Error: {response.status}")
					break

				data = await response.json()
				found_ids = set()
				
				for item in data.get("items", []):
					video_id = item["id"]
					found_ids.add(video_id)
					live = item.get("liveStreamingDetails")

					# 配信じゃないなら処理しない
					if not live:
						removed_ids.add(video_id)
						continue

					snippet = item["snippet"]
					channel_id = snippet.get("channelId")
					vtuber = vtuber_map.get(channel_id, None)
					if not vtuber:
						removed_ids.add(video_id)
						continue

					start_time_str = live.get("scheduledStartTime") or live.get("actualStartTime")
					videos[video_id] = {
						"streamer_name": vtuber.get("Name"),
						"color": vtuber.get("Color"),
						"agency": vtuber.get("Agency"),
						"tags": vtuber.get("Tags"),

						"video_id": video_id,
						"title": snippet["title"],
						"thumbnail": self.get_thumbnail(snippet["thumbnails"]),
						"start_time_iso": start_time_str
					}

					# 開始時間を前もってパースしておく
					#videos[video_id]["start_time_datetime"] = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
					start_times[video_id] = datetime.fromisoformat(start_time_str)

					# 実開始・終了時間をもとにステータスを決める
					if "actualEndTime" in live:
						videos[video_id]["status"] = "archived"
					elif "actualStartTime" in live:
						videos[video_id]["status"] = "live"
					else:
						videos[video_id]["status"] = "upcoming"

				# 見つからなかったので削除
				for video_id in chunk:
					if video_id not in found_ids:
						removed_ids.add(video_id)
						#print(f"Video marked as removed: {video_id}")

			except Exception as e:
				print(f"API Error: {e}")
				continue

		#print(f"Successfully updated {len(videos)} video details.")
		return videos, start_times, removed_ids


