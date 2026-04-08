import json

# --- 設定定数 ---
MASTER_DATA_KEY = "master_data"
LAST_UPDATED_KEY = "last_updated"

class VTuberRepository:

	def __init__(self, kv_master, kv_cache):
		self.master_store = kv_master
		self.cache_store = kv_cache

	async def load_master_data_async(self) -> list:
		"""KVからマスターデータを読み込む"""
		data = await self.master_store.get(MASTER_DATA_KEY)
		if not data:
			return []
		return json.loads(data)

	async def load_channel_last_updated_async(self) -> dict:
		"""KVからチャンネルごとの最終更新日時を読み込む"""
		data = await self.cache_store.get(LAST_UPDATED_KEY)
		if not data:
			return {}
		return json.loads(data)

	async def save_channel_last_updated_async(self, last_updated) -> dict:
		"""KVにチャンネルごとの最終更新日時を保存する"""
		await self.cache_store.put(LAST_UPDATED_KEY, json.dumps(last_updated, ensure_ascii=True))
