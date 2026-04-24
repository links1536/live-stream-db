// repository/youtube_schedule_repository.js

import { HttpUtils } from "../httputils.js";

/**
 * YouTube Data APIを利用するクラス
 */

const SCHEDULE_KEY = "status.json";

export class YouTubeScheduleRepository
{
	constructor(kv_cache)
	{
		this.cacheStore = kv_cache;
		this.lastHash = null;
	}

	/**
	 * KVからキャッシュを読み込む
	 */
	async loadSchedulesAsync()
	{
		const { value, metadata } = await this.cacheStore.getWithMetadata(SCHEDULE_KEY);
		this.lastHash = metadata?.hash || null;

		if (value)
			return JSON.parse(value);
		return {};
	}

	/**
	 * KVにキャッシュを保存する
	 */
	async saveSchedulesAsync(schedules)
	{
		const dataStr = JSON.stringify(schedules);
		const newHash = HttpUtils.quickHash(dataStr);

		if (this.lastHash === newHash) {
			console.log(`${SCHEDULE_KEY} unchanged. skip update.`);
			return;
		}

		await this.cacheStore.put(SCHEDULE_KEY, dataStr, {
			metadata: { hash: newHash }
		});
		this.lastHash = newHash;
		console.log(`${SCHEDULE_KEY} updated (${Object.keys(schedules).length} items)`);
	}
}