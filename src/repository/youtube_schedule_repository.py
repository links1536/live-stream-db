import json

# --- 設定定数 ---
MASTER_DATA_KEY = "master_data"
SCHEDULE_KEY = "status.json"
YOUTUBE_VIDEO_KEY_PREFIX = "youtube_id"

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


	async def save_single_async(self, video_id):
		"""KVにキャッシュを保存する"""
		await self.cache_store.put(f"{YOUTUBE_VIDEO_KEY_PREFIX}/{video_id}", video_id)

	async def get_single_list_async(self):
		"""KVからキャッシュを読み込む"""
		result = await self.cache_store.list(prefix = f"{YOUTUBE_VIDEO_KEY_PREFIX}/")

		# JsProxyオブジェクトをPythonの辞書に変換
		result_py = result.to_py()
		print(result_py)

		video_ids = []
		for key_data in result_py.get("keys", []):
			name = key_data.get("name", None)
			if not name:
				continue
			video_id = name.replace(f"{YOUTUBE_VIDEO_KEY_PREFIX}/", "")
			if not video_id:
				continue
			video_ids.append(video_id)

		return video_ids
	
	async def delete_single_list_async(self, video_ids: list):
		"""KVからキャッシュを削除する"""
		if not video_ids:
			return
		for video_id in video_ids:
			await self.cache_store.delete(f"{YOUTUBE_VIDEO_KEY_PREFIX}/{video_id}")