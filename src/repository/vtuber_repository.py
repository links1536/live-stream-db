import json

import time
from stopwatch import format_elapsed_time

# --- 設定定数 ---
MASTER_DATA_KEY = "master_data"
LAST_UPDATED_KEY = "last_updated"
ENSURE_ASCIi = False

class VTuberRepository:

	def __init__(self, kv_master, kv_cache):
		self.master_store = kv_master
		self.cache_store = kv_cache

	async def load_master_data_async(self) -> list:
		"""KVからマスターデータを読み込む"""
		data = await self.master_store.get(MASTER_DATA_KEY)
		if not data:
			return []
		
		step_start = time.perf_counter()
		vtuvers = json.loads(data)
		print(f"[PERF] load_master_data_async deserialize: {format_elapsed_time(step_start)}")

		return vtuvers

	async def load_channel_last_updated_async(self) -> dict:
		"""KVからチャンネルごとの最終更新日時を読み込む"""
		data = await self.cache_store.get(LAST_UPDATED_KEY)
		if not data:
			return {}
		
		step_start = time.perf_counter()
		last_updates = json.loads(data)
		print(f"[PERF] load_channel_last_updated_async deserialize: {format_elapsed_time(step_start)}")

		return last_updates

	async def save_channel_last_updated_async(self, last_updated) -> dict:
		"""KVにチャンネルごとの最終更新日時を保存する"""
		await self.cache_store.put(LAST_UPDATED_KEY, json.dumps(last_updated, ensure_ascii=ENSURE_ASCIi))
