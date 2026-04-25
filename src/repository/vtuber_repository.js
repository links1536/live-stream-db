// --- 設定定数 ---
const MASTER_DATA_KEY = "streamers.json"
const MASTER_YOUTUBE_MAP_KEY = "streamers_youtube_map.json"

export class VTuberRepository
{
	constructor(kv_master, db)
	{
		this.masterStore = kv_master;
		this.db = db;
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
	 * DBからチャンネルごとの最終更新日時を読み込む
	 */
	async loadChannelLastUpdatedAsync()
	{
		try {
			const { results } = await this.db.prepare("SELECT * FROM rss_last_updated").all();
			const lastUpdated = {};
			for (const row of results) {
				lastUpdated[row.channel_id] = row.last_updated;
			}
			return lastUpdated;
		}
		catch (e) {
			console.error(`Failed to load last updated: ${e.message}`);
			return {};
		}
	}

	/**
	 * DBにチャンネルごとの最終更新日時を保存する
	 */
	async saveChannelLastUpdatedAsync(last_updated)
	{
		const entries = Object.entries(last_updated);
		if (entries.length === 0)
			return;

		const stmt = this.db.prepare("INSERT OR REPLACE INTO rss_last_updated (channel_id, last_updated) VALUES (?, ?)");
		const batch = entries.map(([id, time]) => stmt.bind(id, time ?? null));

		await this.db.batch(batch);
		console.log(`D1: Updated ${entries.length} items in rss_last_updated table.`);
	}
}