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

		// データ更新があるなら、KVのIDリストを更新する
		if (totalChanges > 0) {
			const videoIds = schedules.map(s => s.video_id);
			await this.kvCache.put(YOUTUBE_VIDEO_ID_KEY, JSON.stringify(videoIds));
		}

		// 変更があったかを返す
		return totalChanges > 0;
	}

	/**
	 * 期間外の古いデータを一括削除する
	 */
	async cleanupSchedulesAsync(removeVideoIds, startLimitIso)
	{
		if (removeVideoIds != null && removeVideoIds.length > 0) {
			const placeholders = removeVideoIds.map(() => "?").join(",");
			const result = await this.db.prepare(`DELETE FROM youtube_schedules WHERE start_time_iso < ? OR video_id IN (${placeholders})`)
				.bind(startLimitIso, ...removeVideoIds).run();
			Log.info("YouTubeScheduleRepository", `D1: Cleaned up ${result.meta.changes} (${removeVideoIds.length}) items from schedules table.`);
			
			// 変更があったかを返す
			return result.meta.changes;
		}
		else{
			const result = await this.db.prepare("DELETE FROM youtube_schedules WHERE start_time_iso < ?")
				.bind(startLimitIso).run();
			Log.info("YouTubeScheduleRepository", `D1: Cleaned up ${result.meta.changes} items from schedules table.`);

			// 変更があったかを返す
			return result.meta.changes;
		}
	}
}