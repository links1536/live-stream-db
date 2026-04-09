import httputils

class YouTubeDataAPI:
	"""YouTube Data APIを利用するクラス"""

	def __init__(self, api_key):
		self.api_key = api_key
		self.youtube_url = "https://www.googleapis.com/youtube/v3/videos"

	def get_thumbnail(self, thumbnails):
		maxRes = None
		for thumbnail in thumbnails.values():
			if (thumbnail is not None
			and maxRes is None or maxRes.get("width", 0) < thumbnail.get("width", 0)):
				maxRes = thumbnail
		return maxRes.get("url")

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
				found_ids = []
				
				for item in data.get("items", []):
					video_id = item["id"]
					found_ids.append(video_id)
					live = item.get("liveStreamingDetails")

					# 配信じゃないなら処理しない
					if not live:
						removed_ids.append(video_id)
						continue

					snippet = item["snippet"]
					thumbnails = snippet["thumbnails"]

					channel_id = snippet.get("channelId")
					vtuber = vtuber_map.get(channel_id, None)
					if not vtuber:
						removed_ids.append(video_id)
						continue

					videos[video_id] = {
						"streamer_name": vtuber.get("Name"),
						"color": vtuber.get("Color"),
						"agency": vtuber.get("Agency"),
						"tags": vtuber.get("Tags"),

						"video_id": video_id,
						"title": snippet["title"],
						"thumbnail": self.get_thumbnail(thumbnails),
						"start_time_iso": live.get("scheduledStartTime") or live.get("actualStartTime")
					}

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
							print(f"Video marked as removed: {video_id}")

			except Exception as e:
				print(f"API Error: {e}")
				continue

		print(f"Successfully updated {len(videos)} video details.")
		return videos, removed_ids


