// repository/youtube_schedule_repository.js
import { Log } from "../log.js";

const YOUTUBE_VIDEO_ID_KEY = "youtube_video_ids.json"

/**
 * YouTube Data APIを利用するクラス
 */
export class YouTubeScheduleRepository
{
	constructor(db, kvCache)
	{
		this.db = db;
		this.kvCache = kvCache;
	}

	/**
	 * 動画IDのみを返す
	 */
	async getScheduleIdsAsync()
	{
		try {
			//const { results } = await this.db.prepare("SELECT video_id FROM youtube_schedules").all();
			//return results.map(r => r.video_id);

			// KVからIDリストを取得する
			var json = await this.kvCache.get(YOUTUBE_VIDEO_ID_KEY);
			return JSON.parse(json);
		}
		catch (e) {
			Log.error("YouTubeScheduleRepository", `Failed to get schedule IDs: ${e.message}`);
			return [];
		}
	}

	/**
	 * キャッシュを更新する
	 */
	async updateScheduleIdsAsync()
	{
		const { results } = await this.db.prepare("SELECT video_id FROM youtube_schedules").all();
		const videoIds = results.map(r => r.video_id);
		
		// KVからIDリストを取得する
		const json = JSON.stringify(videoIds);
		await this.kvCache.put(YOUTUBE_VIDEO_ID_KEY, json);
	}

	/**
	 * DBにキャッシュを保存する
	 */
	async saveSchedulesAsync(schedules)
	{
		if (schedules.length === 0)
			return;

		const stmt = this.db.prepare(`
			INSERT INTO youtube_schedules (
				video_id, channel_id, 
				title, thumbnail, start_time_iso, status
			) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(video_id) DO UPDATE SET
				channel_id = EXCLUDED.channel_id,
				title = EXCLUDED.title,
				thumbnail = EXCLUDED.thumbnail,
				start_time_iso = EXCLUDED.start_time_iso,
				status = EXCLUDED.status
			WHERE 
				title IS NOT EXCLUDED.title OR 
				thumbnail IS NOT EXCLUDED.thumbnail OR
				start_time_iso IS NOT EXCLUDED.start_time_iso OR
				status IS NOT EXCLUDED.status
		`);

		const batch = [];
		for (const schedule of schedules) {
			batch.push(
				stmt.bind(
					schedule.video_id,
					schedule.channel_id ?? null,
					schedule.title ?? null,
					schedule.thumbnail ?? null,
					schedule.start_time_iso ?? null,
					schedule.status ?? null
				)
			);
		}

		const results = await this.db.batch(batch);
		const totalChanges = results.reduce((sum, res) => sum + (res.meta?.changes || 0), 0);
		Log.info("YouTubeScheduleRepository", `D1: Updated ${totalChanges} / ${schedules.length} items in schedules table.`);

		// 変更があったかを返す
		return totalChanges > 0;
	}

	/**
	 * 期間外の古いデータを一括削除する
	 */
	async cleanupSchedulesAsync(removeVideoIds, startLimitIso)
	{
		let sql = "";
		let params = [];

		if (removeVideoIds && removeVideoIds.length > 0) {
			const placeholders = removeVideoIds.map(() => "?").join(",");
			sql = `DELETE FROM youtube_schedules WHERE start_time_iso < ? OR video_id IN (${placeholders})`;
			params = [startLimitIso, ...removeVideoIds];
		}
		else {
			sql = `DELETE FROM youtube_schedules WHERE start_time_iso < ?`;
			params = [startLimitIso];
		}

		// 実行
		const result = await this.db.prepare(sql).bind(...params).run();
		const changes = result.meta?.changes || 0;

		// ログに出す
		Log.info(removeVideoIds?.length > 0
			? `D1: Cleaned up ${result.meta.changes} (${removeVideoIds.length}) items from schedules table.`
			: `D1: Cleaned up ${result.meta.changes} items from schedules table.`
		);

		return changes;
	}
}