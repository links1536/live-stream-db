// --- 設定定数 ---
const MASTER_DATA_KEY = "master_data"
const LAST_UPDATED_KEY = "last_updated"

export class VTuberRepository
{
	constructor(kv_master, kv_cache)
	{
		this.masterStore = kv_master;
		this.cacheStore = kv_cache;
	}

	/**
	 * KVからマスターデータを読み込む
	 */
	async loadMasterDataAsync()
	{
		const data = await this.masterStore.get(MASTER_DATA_KEY);
		if (data)
			return JSON.parse(data);
		return [];
	}

	/**
	 * KVからチャンネルごとの最終更新日時を読み込む
	 */
	async loadChannelLastUpdatedAsync()
	{
		const data = await this.cacheStore.get(LAST_UPDATED_KEY)
		if (data)
			return JSON.parse(data);
		return {};
	}

	/**
	 * KVにチャンネルごとの最終更新日時を保存する
	 */
	async saveChannelLastUpdatedAsync(last_updated)
	{
		await this.cacheStore.put(LAST_UPDATED_KEY, JSON.stringify(last_updated))
	}
}