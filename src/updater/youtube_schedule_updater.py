from api.youtube_data_api import YouTubeDataAPI

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

class YouTubeScheduleUpdater:
	"""ステータス更新メインロジック"""

	def __init__(self, env):
		self.youtube_repository: YouTubeScheduleRepository = YouTubeScheduleRepository(env.KV_CACHE)
		self.vtuber_repository: VTuberRepository = VTuberRepository(env.KV_MASTER, env.KV_CACHE)
		self.youtube_data_api: YouTubeDataAPI = YouTubeDataAPI(env.YOUTUBE_DATA_API_KEY)

		do_id = env.YOUTUBE_NOTICES_CACHE.idFromName("rss-key-cache") 
		self.youtube_notices_cache: YouTubeNoticesCache = env.YOUTUBE_NOTICES_CACHE.get(do_id)

		self.lives_json_store = env.KV_OUTPUT

	def get_video_start_time(self, video_data, start_times):
		video_id = video_data.get("video_id")
		if not video_id:
			return None
		return start_times.get(video_id)

	def is_expired_cache(self, video_data, start_times, start_limit):
		"""配信データがキャッシュ期限切れか判定"""

		# 開始時間が不明なものは「予定あり」として残す
		start_time = self.get_video_start_time(video_data, start_times)
		return not start_time or start_limit <= start_time

	def is_within_display_period(self, video_data, start_times, start_limit, end_limit):
		"""配信データが有効期間内かつ削除フラグが立っていないか判定"""

		# 開始時間が不明なものは表示しない
		start_time = self.get_video_start_time(video_data, start_times)
		return start_time and (start_limit <= start_time <= end_limit)

	async def save_data_json(self, schedules, start_times, current_date, start_limit, end_limit):
		"""公開用JSONを生成する"""

		# 開始時間があるものだけ
		valid_schedules = [
			video for video in schedules.values() 
			if video.get("start_time_iso") is not None
			if self.is_within_display_period(video, start_times, start_limit, end_limit)
		]
		
		# 開始時間でソートする
		sorted_schedules = sorted(
			valid_schedules, 
			key=lambda x: x["start_time_iso"]
		)

		# 更新日時（現在）と配信情報を保存
		public_data = {
			"updated_at": current_date.isoformat(),
			"all_schedules": sorted_schedules
		}
		await self.lives_json_store.put(OUTPUT_KEY, json.dumps(public_data, ensure_ascii=ENSURE_ASCIi))
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
		requset_ids |= single_video_ids

		# リクエスト
		response, start_times, removed_ids = await self.youtube_data_api.get_video_infos_async(target_ids=list(requset_ids), vtubers=vtubers)

		# キャッシュから明確に受け取ることのできなかったデータ
		#  ＝ 非公開などでレスポンスに乗らなくなったデータを削除
		for rid in removed_ids:
			total_schedules.pop(rid, None)

		# 単体のIDを削除する
		response_keys = set(response.keys())
		# 更新を受け取ったか削除されたなら
		# removed_ids と response_keys を結合したものに対して single_video_ids でマスクする
		delete_single_video_ids = list(single_video_ids & (removed_ids | response_keys))
		await self.youtube_notices_cache.delete_list_async(delete_single_video_ids)

		# レスポンスに乗っていたデータを更新
		# エラーなどで更新されなかったデータは response にも removed_ids にも乗らないので
		# 古いデータがそのまま残る
		total_schedules.update(response)

		total_schedules_count = len(total_schedules)

		# 期間外のデータを削除
		current_date = datetime.now(timezone.utc)
		start_limit = (current_date - timedelta(days=BEFORE_DAYS))
		end_limit = (current_date + timedelta(days=AFTER_DAYS))
		new_schedules = {
			id: video for id, video in total_schedules.items()
			if self.is_expired_cache(video, start_times, start_limit)
		}
		#print(f"Cleanup: {total_schedules_count} -> {len(new_schedules)}")

		# キャッシュ保存
		await self.youtube_repository.save_schedules_async(new_schedules)

		# 公開用JSONのみ生成
		await self.save_data_json(new_schedules, start_times, current_date, start_limit, end_limit)
