from datetime import time
import json

from updater import format_elapsed_time

# --- 設定定数 ---
SCHEDULE_KEY = "status.json"
ENSURE_ASCIi = False

class YouTubeScheduleRepository:
	"""YouTube Data APIを利用するクラス"""

	def __init__(self, kv_cache):
		self.cache_store = kv_cache

	async def load_schedules_async(self) -> dict:
		"""KVからキャッシュを読み込む"""
		data = await self.cache_store.get(SCHEDULE_KEY)
		if not data:
			return {}
		
		step_start = time.perf_counter()
		schedules = json.loads(data)
		print(f"[PERF] load_schedules_async deserialize: {format_elapsed_time(step_start)}")

		return schedules

	async def save_schedules_async(self, schedules):
		"""KVにキャッシュを保存する"""
		
		step_start = time.perf_counter()
		json_data = json.dumps(schedules, ensure_ascii=ENSURE_ASCIi)
		print(f"[PERF] save_schedules_async serialize: {format_elapsed_time(step_start)}")

		await self.cache_store.put(SCHEDULE_KEY, json_data)
