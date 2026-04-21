// repository/youtube_schedule_repository.js

/**
 * YouTube Data APIを利用するクラス
 */
export class YouTubeScheduleRepository
{
	constructor(kv_cache)
	{
		self.cache_store = kv_cache
	}

	/**
	 * KVからキャッシュを読み込む
	 */
	async load_schedules_async()
	{
		data = await self.cache_store.get(SCHEDULE_KEY)
		if (data)
			return JSON.parse(data)
		return {}
	}

	/**
	 * KVにキャッシュを保存する
	 */
	async save_schedules_async( schedules)
	{
		await self.cache_store.put(SCHEDULE_KEY, JSON.stringify(schedules))
	}
}