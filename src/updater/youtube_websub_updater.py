from api.youtube_websub import YouTubeWebSub

import httputils
from repository.vtuber_repository import VTuberRepository
from repository.youtube_notices_cache import YouTubeNoticesCache

# --- 設定 ---
BEFORE_DAYS = 1
AFTER_DAYS = 7

# --- 設定定数 ---
OUTPUT_KEY = "lives.json"

class YouTubeWebSubUpdater:
	"""ステータス更新メインロジック"""

	def __init__(self, env):
		self.vtuber_repository: VTuberRepository = VTuberRepository(env.KV_MASTER, env.KV_CACHE)
		self.youtube_websub: YouTubeWebSub = YouTubeWebSub(env.YOUTUBE_WEBSUB_VERIFY_TOKEN, env.YOUTUBE_WEBSUB_SECRETS)
		self.youtube_websub_queue = env.RESISTER_YOUTUBE_WEBHOOK_IDS

		do_id = env.YOUTUBE_NOTICES_CACHE.idFromName("rss-key-cache") 
		self.youtube_notices_cache: YouTubeNoticesCache = env.YOUTUBE_NOTICES_CACHE.get(do_id)

	async def register_websub(self):
		"""WebSubを登録する"""
		vtubers = await self.vtuber_repository.load_master_data_async()

		index = 0
		vtuber_count = len(vtubers)
		for vtuber in vtubers:
			index += 1

			streamer_name = vtuber.get("Name")
			channel_ids = vtuber.get("YouTubeID")
			if not channel_ids:
				continue

			for channel_id in channel_ids:
				if not channel_id:
					continue

				print(f"{streamer_name}: {channel_id} ({index} / {vtuber_count}) enqueue")
				await self.youtube_websub_queue.send(channel_id)

	async def handle_youtube_webhook(self, request):
		"""YouTube WebSub (PubSubHubbub) の通知を解析する"""
		if request.method == "GET":
			return await self.youtube_websub.process_get(request)

		video_ids = await self.youtube_websub.process_post(request)
		if video_ids:
			for video_id in video_ids:
				await self.youtube_notices_cache.add(video_id)

		return httputils.response("", {
			"Status": 200,
			"Content-Type": "text/plain",
		})