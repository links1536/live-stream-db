import { HttpUtils } from "../httputils.js";

// --- 設定定数 ---
const MASTER_DATA_KEY = "streamers.json"
const MASTER_YOUTUBE_MAP_KEY = "streamers_youtube_map.json"
const LAST_UPDATED_KEY = "lastupdate.json"

export class VTuberRepository
{
	constructor(kv_master, kv_cache)
	{
		this.masterStore = kv_master;
		this.cacheStore = kv_cache;
		this.lastLastUpdateHash = null;
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
	 * YouTube ID マップを読み込む
	 */
	async loadYouTubeMapAsync()
	{
		const data = await this.masterStore.get(MASTER_YOUTUBE_MAP_KEY);
		if (data)
			return JSON.parse(data);
		return {};
	}

	/**
	 * KVからチャンネルごとの最終更新日時を読み込む
	 */
	async loadChannelLastUpdatedAsync()
	{
		const { value, metadata } = await this.cacheStore.getWithMetadata(LAST_UPDATED_KEY);
		this.lastLastUpdateHash = metadata?.hash || null;

		if (value)
			return JSON.parse(value);
		return {};
	}

	/**
	 * KVにチャンネルごとの最終更新日時を保存する
	 */
	async saveChannelLastUpdatedAsync(last_updated)
	{
		const dataStr = JSON.stringify(last_updated);
		const newHash = HttpUtils.quickHash(dataStr);

		if (this.lastLastUpdateHash === newHash) {
			console.log(`${LAST_UPDATED_KEY} unchanged. skip update.`);
			return;
		}

		await this.cacheStore.put(LAST_UPDATED_KEY, dataStr, {
			metadata: { hash: newHash }
		});
		this.lastLastUpdateHash = newHash;
	}
}