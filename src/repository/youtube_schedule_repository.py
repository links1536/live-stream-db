import json

# --- 設定定数 ---
SCHEDULE_KEY = "status.json"

class YouTubeScheduleRepository:
	"""YouTube Data APIを利用するクラス"""

	def __init__(self, kv_cache):
		self.cache_store = kv_cache

	async def load_schedules_async(self) -> dict:
		"""KVからキャッシュを読み込む"""
		data = await self.cache_store.get(SCHEDULE_KEY)
		if not data:
			return {}
		return json.loads(data)

	async def save_schedules_async(self, schedules):
		"""KVにキャッシュを保存する"""
		await self.cache_store.put(SCHEDULE_KEY, json.dumps(schedules, ensure_ascii=True))
