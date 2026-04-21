// --- 設定定数 ---
const MASTER_DATA_KEY = "master_data"
const LAST_UPDATED_KEY = "last_updated"

export class VTuberRepository
{
	constructor(kv_master, kv_cache)
	{
		self.master_store = kv_master;
		self.cache_store = kv_cache;
	}

	/**
	 * KVからマスターデータを読み込む
	 */
	async load_master_data_async()
	{
		var data = await self.master_store.get(MASTER_DATA_KEY);
		if (data)
			return JSON.parse(data);
		return [];
	}

	/**
	 * KVからチャンネルごとの最終更新日時を読み込む
	 */
	async load_channel_last_updated_async()
	{
		var data = await self.cache_store.get(LAST_UPDATED_KEY)
		if (data)
			return JSON.parse(data);
		return {};
	}

	/**
	 * KVにチャンネルごとの最終更新日時を保存する
	 */
	async save_channel_last_updated_async(last_updated)
	{
		await self.cache_store.put(LAST_UPDATED_KEY, JSON.stringify(last_updated))
	}
}