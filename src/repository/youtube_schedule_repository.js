// repository/youtube_schedule_repository.js

/**
 * YouTube Data APIを利用するクラス
 */
export class YouTubeScheduleRepository
{
	constructor(kv_cache)
	{
		this.cacheStore = kv_cache;
	}

	/**
	 * KVからキャッシュを読み込む
	 */
	async loadSchedulesAsync()
	{
		const data = await this.cacheStore.get(SCHEDULE_KEY);
		if (data)
			return JSON.parse(data);
		return {};
	}

	/**
	 * KVにキャッシュを保存する
	 */
	async saveSchedulesAsync(schedules)
	{
		await this.cacheStore.put(SCHEDULE_KEY, JSON.stringify(schedules));
	}
}