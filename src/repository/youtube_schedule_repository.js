// repository/youtube_schedule_repository.js

/**
 * YouTube Data APIを利用するクラス
 */

export class YouTubeScheduleRepository
{
	constructor(db)
	{
		this.db = db;
	}

	/**
	 * 動画IDのみを返す
	 */
	async getScheduleIdsAsync()
	{
		try {
			const { results } = await this.db.prepare("SELECT video_id FROM youtube_schedules").all();
			return results.map(r => r.video_id);
		}
		catch (e) {
			console.error(`Failed to get schedule IDs: ${e.message}`);
			return [];
		}
	}

	/**
	 * DBからキャッシュを読み込む
	 */
	async loadSchedulesAsync()
	{
		try {
			const { results } = await this.db.prepare("SELECT * FROM youtube_schedules").all();
			const schedules = {};
			for (const row of results) {
				schedules[row.video_id] = {
					...row,
					tags: row.tags ? JSON.parse(row.tags) : []
				};
			}
			return schedules;
		}
		catch (e) {
			console.error(`Failed to load schedules: ${e.message}`);
			return {};
		}
	}

	/**
	 * DBにキャッシュを保存する
	 */
	async saveSchedulesAsync(schedules)
	{
		if (schedules.length === 0)
			return;

		console.log(`保存: ${schedules.title}`);
		const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO youtube_schedules (
				video_id, channel_id, 
				title, thumbnail, start_time_iso, status
			) VALUES (?, ?, ?, ?, ?, ?)
		`);

		const batch = [];
		for (const schedule of schedules) {
			console.log(`video_id: ${schedule.video_id}`);
			console.log(`channel_id: ${schedule.channel_id}`);
			console.log(`title: ${schedule.title}`);
			console.log(`thumbnail: ${schedule.thumbnail}`);
			console.log(`start_time_iso: ${schedule.start_time_iso}`);
			console.log(`status: ${schedule.status}`);
	
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
		console.log(`bind end`);

		const results = await this.db.batch(batch);
		const totalChanges = results.reduce((sum, res) => sum + (res.meta?.changes || 0), 0);
		console.log(`D1: Updated ${totalChanges} / ${schedules.length} items in schedules table.`);
	}

	/**
	 * 古いデータを削除する
	 */
	async deleteSchedulesAsync(videoIds)
	{
		if (videoIds.length === 0)
			return;
		const placeholders = videoIds.map(() => "?").join(",");
		const result = await this.db.prepare(`DELETE FROM youtube_schedules WHERE video_id IN (${placeholders})`).bind(...videoIds).run();
		console.log(`D1: Deleted ${result.meta.changes} items from schedules table.`);
	}

	/**
	 * 期間外の古いデータを一括削除する
	 */
	async cleanupOldSchedulesAsync(limitIso)
	{
		const result = await this.db.prepare("DELETE FROM youtube_schedules WHERE start_time_iso < ?").bind(limitIso).run();
		console.log(`D1: Cleaned up ${result.meta.changes} items from schedules table.`);
	}
}