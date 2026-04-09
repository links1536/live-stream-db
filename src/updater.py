from api.youtube_data_api import YouTubeDataAPI
from api.youtube_rss_fetcher import YouTubeRSSFetcher
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

class Updater:
	"""ステータス更新メインロジック"""

	def __init__(self, env):
		self.youtube_repository: YouTubeScheduleRepository = YouTubeScheduleRepository(env.KV_CACHE)
		self.vtuber_repository: VTuberRepository = VTuberRepository(env.KV_MASTER, env.KV_CACHE)
		self.youtube_data_api: YouTubeDataAPI = YouTubeDataAPI(env.YOUTUBE_DATA_API_KEY)

		do_id = env.YOUTUBE_NOTICES_CACHE.idFromName("rss-key-cache") 
		self.youtube_notices_cache: YouTubeNoticesCache = env.YOUTUBE_NOTICES_CACHE.get(do_id)

		self.lives_json_store = env.KV_OUTPUT


	def is_expired_cache(self, video_data, start_limit):
		"""配信データがキャッシュ期限切れか判定"""
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


	def is_within_display_period(self, video_data, start_limit, end_limit):
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
			return start_limit <= start_time <= end_limit
		except ValueError:
			# パース失敗時は安全のため残す
			return True


	async def save_data_json(self, schedules, start_limit, end_limit):
		"""公開用JSONを生成する"""

		# 開始時間があるものだけ
		valid_schedules = [
			video for video in schedules.values() 
			if video.get("start_time_iso") is not None
			and self.is_within_display_period(video, start_limit, end_limit)
		]
		
		# 開始時間でソートする
		sorted_schedules = sorted(
			valid_schedules, 
			key=lambda x: x["start_time_iso"]
		)

		# 更新日時（現在）と配信情報を保存
		public_data = {
			"updated_at": datetime.now(timezone.utc).isoformat(),
			"all_schedules": sorted_schedules
		}
		await self.lives_json_store.put(OUTPUT_KEY, json.dumps(public_data, ensure_ascii=True))
		print(f"Generated {OUTPUT_KEY} ({len(valid_schedules)} streams)")

	async def update_schedules(self):
		"""ステータス更新メインロジック"""

		# マスターを読み出し
		vtubers = await self.vtuber_repository.load_master_data_async()

		# キャッシュを読み出し
		total_schedules = await self.youtube_repository.load_schedules_async()

		# データ更新
		requset_ids = set(total_schedules.keys())

		# 動画ID単体で記憶しているものを結合する
		single_video_ids = await self.youtube_notices_cache.get_all()
		print(f"Single Count: {len(single_video_ids or [])}")
		for video_id in single_video_ids:
			print(f"Single: {video_id}")
			requset_ids.add(video_id)

		# リクエスト
		response, removed_ids = await self.youtube_data_api.get_video_infos_async(target_ids=list(requset_ids), vtubers=vtubers)

		# キャッシュから明確に受け取ることのできなかったデータ
		#  ＝ 非公開などでレスポンスに乗らなくなったデータを削除
		total_schedules = {
			id: video for id, video in total_schedules.items()
			if id not in removed_ids
		}

		# 単体のIDを削除する
		response_keys = set(response.keys())
		# 更新を受け取ったか削除されたなら
		delete_single_video_ids = [
			video_id for video_id in single_video_ids
			if video_id in response_keys or video_id in removed_ids
		]
		await self.youtube_notices_cache.delete_list_async(delete_single_video_ids)

		# レスポンスに乗っていたデータを更新
		# エラーなどで更新されなかったデータは response にも removed_ids にも乗らないので
		# 古いデータがそのまま残る
		for video_id, video_data in response.items():
			total_schedules[video_id] = video_data

		# 期間外のデータを削除
		now = datetime.now(timezone.utc)
		start_limit = (now - timedelta(days=BEFORE_DAYS))
		end_limit = (now + timedelta(days=AFTER_DAYS))
		new_schedules = {
			id: video for id, video in total_schedules.items()
			if self.is_expired_cache(video, start_limit)
		}
		print(f"Cleanup: {len(total_schedules)} -> {len(new_schedules)}")

		# キャッシュ保存
		await self.youtube_repository.save_schedules_async(new_schedules)

		# 公開用JSONのみ生成
		await self.save_data_json(new_schedules, start_limit, end_limit)

	async def fetch_new_schedules(self):

		vtubers = await self.vtuber_repository.load_master_data_async()
		last_updated = await self.vtuber_repository.load_channel_last_updated_async()

		current_date = datetime.now(timezone.utc)
		rss_fetcher = YouTubeRSSFetcher()

		video_ids = set()
		for vtuber in vtubers:
			streamer_name = vtuber.get("Name")
			channel_ids = vtuber.get("YouTubeID")
			if not channel_ids:
				continue

			for channel_id in channel_ids:
				if not channel_id:
					continue

				# ログに出す
				print(f"{streamer_name} / {channel_id} fetch")

				# RSS取得
				videos = await rss_fetcher.get_video_info(channel_id)	
				if not videos:
					continue

				# 前回の更新と比較しながらIDを覚える
				last_updated_str = last_updated.get(channel_id, None) or "1970-01-01T00:00:00+00:00"
				last_updated_datetime = datetime.fromisoformat(last_updated_str)
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
						print(f"{streamer_name} / {channel_id}: video_id={video_id} ({updated_str} < {last_updated_str})")
						continue

					# 動画ID単体で記憶する
					print(f"{streamer_name} / {channel_id}: video_id={video_id} ({updated_str})")
					await self.youtube_notices_cache.add(video_id)

				# チャンネルの更新日時
				last_updated[channel_id] = current_date.isoformat()

		await self.vtuber_repository.save_channel_last_updated_async(last_updated)