from api.youtube_data_api import YouTubeDataAPI
from api.youtube_rss_fetcher import YouTubeRSSFetcher
from repository.vtuber_repository import VTuberRepository
from repository.youtube_schedule_repository import YouTubeScheduleRepository

import json
from datetime import datetime, timedelta, timezone

# --- 設定 ---
PAST_DAYS = 1

# --- 設定定数 ---
MASTER_DATA_KEY = "master_data"
STATUS_KEY = "status.json"
OUTPUT_KEY = "lives.json"

class Updater:
	"""ステータス更新メインロジック"""

	def __init__(self, env):
		self.youtube_repository = YouTubeScheduleRepository(env.KV_CACHE)
		self.vtuber_repository = VTuberRepository(env.KV_MASTER, env.KV_CACHE)
		self.youtube_data_api = YouTubeDataAPI(env.YouTubeDataAPI)
		self.lives_json_store = env.KV_OUTPUT



	async def save_data_json(self, schedules):
		"""公開用JSONを生成する"""
		public_data = {
			"updated_at": datetime.now(timezone.utc).isoformat(),
			"all_schedules": schedules
		}
		await self.lives_json_store.put(OUTPUT_KEY, json.dumps(public_data, ensure_ascii=True))
		print(f"Generated {OUTPUT_KEY} ({len(schedules)} streams)")


	def is_within_period(self, video_data, start_limit):
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


	async def update_schedules(self):
		"""ステータス更新メインロジック"""

		# キャッシュを読み出し
		total_schedules = await self.youtube_repository.load_schedules_async()


		# データ更新
		requset_ids = [total_schedules.keys()]

		# 動画ID単体で記憶しているものを結合する
		single_video_ids = await self.youtube_repository.get_single_list_async()
		for video_id in single_video_ids:
			if video_id in total_schedules:
				continue
			requset_ids.append(video_id)

		# リクエスト
		response, removed_ids = await self.youtube_data_api.get_video_infos_async(requset_ids)

		# キャッシュから明確に受け取ることのできなかったデータ
		#  ＝ 非公開などでレスポンスに乗らなくなったデータを削除
		total_schedules = {
			id: video for id, video in total_schedules.items()
			if id not in removed_ids
		}

		# 単体のIDを削除する
		delete_single_video_ids = []
		for video_id in single_video_ids:
			if video_id in response or video_id in removed_ids:
				delete_single_video_ids.append(video_id)
		await self.youtube_repository.delete_single_list_async(delete_single_video_ids)

		# レスポンスに乗っていたデータを更新
		# エラーなどで更新されなかったデータは response にも removed_ids にも乗らないので
		# 古いデータがそのまま残る
		for video_id, video_data in response.items():
			total_schedules[video_id] = video_data

		# 期間外のデータを削除
		now = datetime.now(timezone.utc)
		start_limit = (now - timedelta(days=PAST_DAYS))
		new_schedules = {
			id: video for id, video in total_schedules.items()
			if self.is_within_period(video, start_limit)
		}
		print(f"Cleanup: {len(total_schedules)} -> {len(new_schedules)}")

		# キャッシュ保存
		await self.youtube_repository.save_schedules_async(new_schedules)

		# 公開用JSONのみ生成
		await self.save_data_json(new_schedules)

	async def fetch_new_schedules(self):

		vtubers = await self.vtuber_repository.load_master_data_async()
		last_updated = await self.vtuber_repository.load_channel_last_updated_async()

		current_date = datetime.now(timezone.utc)
		rss_fetcher = YouTubeRSSFetcher()

		for vtuber in vtubers:
			channel_id = vtuber.get("channel_id")
			if not channel_id:
				continue

			videos = await rss_fetcher.get_video_info(channel_id)	
			if not videos:
				continue

			# 前回の更新と比較しながらIDを覚える
			last_updated_str = last_updated.get(channel_id, None) or "1970-01-01T00:00:00+00:00"
			last_updated_datetime = datetime.fromisoformat(last_updated_str)
			for video in videos:
				updated_str = video["updated"]
				updated_date = datetime.fromisoformat(updated_str)

				# 前回更新より古いものはとばす
				if updated_date <= last_updated_datetime:
					continue

			# 動画ID単体で記憶する
			await self.youtube_repository.save_single_async(video["video_id"])

			# チャンネルの更新日時
			last_updated[channel_id] = current_date.isoformat()

		await self.vtuber_repository.save_channel_last_updated_async(last_updated)