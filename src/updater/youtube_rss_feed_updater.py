from api.youtube_data_api import YouTubeDataAPI
from api.youtube_rss_fetcher import YouTubeRSSFetcher
from api.youtube_websub import YouTubeWebSub

import httputils
from repository.vtuber_repository import VTuberRepository
from repository.youtube_schedule_repository import YouTubeScheduleRepository
from repository.youtube_notices_cache import YouTubeNoticesCache

import json
from datetime import datetime, timedelta, timezone

# --- 設定 ---
BEFORE_DAYS = 1
AFTER_DAYS = 7

# --- 設定定数 ---
OUTPUT_KEY = "lives.json"
ENSURE_ASCIi = False

class YouTubeRssFeedUpdater:
	"""ステータス更新メインロジック"""

	def __init__(self, env):
		self.vtuber_repository: VTuberRepository = VTuberRepository(env.KV_MASTER, env.KV_CACHE)

		do_id = env.YOUTUBE_NOTICES_CACHE.idFromName("rss-key-cache") 
		self.youtube_notices_cache: YouTubeNoticesCache = env.YOUTUBE_NOTICES_CACHE.get(do_id)

	async def fetch_new_schedules(self):

		vtubers = await self.vtuber_repository.load_master_data_async()
		last_updated = await self.vtuber_repository.load_channel_last_updated_async()

		current_date = datetime.now(timezone.utc)
		rss_fetcher = YouTubeRSSFetcher()

		for vtuber in vtubers:
			streamer_name = vtuber.get("Name")
			channel_ids = vtuber.get("YouTubeID")
			if not channel_ids:
				continue

			for channel_id in channel_ids:
				if not channel_id:
					continue

				# 前回の更新と比較しながらIDを覚える
				last_updated_str = last_updated.get(channel_id, None) or "1970-01-01T00:00:00+00:00"
				last_updated_datetime = datetime.fromisoformat(last_updated_str)

				# 15分以内ならスキップ
				if (current_date - last_updated_datetime).total_seconds() < (60 * 15):
					continue

				# ログに出す
				#print(f"{streamer_name} / {channel_id} fetch")

				# RSS取得
				videos = await rss_fetcher.get_video_info(channel_id)	
				if not videos:
					continue

				for video in videos:
					video_id = video["video_id"]
					updated_str = video["updated"]
					updated_date = datetime.fromisoformat(updated_str)

					# 切り捨てレベルで古い
					limit_date = current_date - timedelta(days=BEFORE_DAYS)
					if updated_date < limit_date:
						continue

					# 前回更新より古いものはとばす
					if updated_date <= last_updated_datetime:
						#print(f"{streamer_name} / {channel_id}: video_id={video_id} ({updated_str} < {last_updated_str})")
						continue

					# 動画ID単体で記憶する
					print(f"{streamer_name} / {channel_id}: video_id={video_id} ({updated_str})")
					await self.youtube_notices_cache.add(video_id)

				# チャンネルの更新日時
				last_updated[channel_id] = current_date.isoformat()

		await self.vtuber_repository.save_channel_last_updated_async(last_updated)
