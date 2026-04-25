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
	 * DBからキャッシュを読み込む
	 */
	async loadSchedulesAsync()
	{
		try {
			const { results } = await this.db.prepare("SELECT * FROM schedules").all();
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
	 * DBから特定のアクティブな配信を読み込む（KV出力用）
	 */
	async loadActiveSchedulesAsync(startLimit, endLimit)
	{
		try {
			// 表示期間内のものを取得
			const { results } = await this.db.prepare(
				"SELECT * FROM schedules WHERE start_time_iso IS NOT NULL"
			).all();
			
			// フィルタリング（本来はSQLのWHEREで行うのが理想的だが、startLimitの比較のためJS側で実施）
			return results
				.map(row => ({
					...row,
					tags: row.tags ? JSON.parse(row.tags) : []
				}))
				.filter(video => {
					const startTime = Date.parse(video.start_time_iso);
					return startTime >= startLimit && startTime <= endLimit;
				});
		}
		catch (e) {
			console.error(`Failed to load active schedules: ${e.message}`);
			return [];
		}
	}

	/**
	 * DBにキャッシュを保存する
	 */
	async saveSchedulesAsync(schedules)
	{
		const entries = Object.entries(schedules);
		if (entries.length === 0)
			return;

		const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO schedules (
				video_id, streamer_name, agency, tags, color, 
				title, thumbnail, start_time_iso, status, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		const batch = entries.map(([id, s]) => 
			stmt.bind(
				id, 
				s.streamer_name ?? null, 
				s.agency ?? null, 
				JSON.stringify(s.tags ?? []), 
				s.color ?? null,
				s.title ?? null, 
				s.thumbnail ?? null, 
				s.start_time_iso ?? null, 
				s.status ?? null, 
				Date.now()
			)
		);

		await this.db.batch(batch);
		console.log(`D1: Updated ${entries.length} items in schedules table.`);
	}

	/**
	 * 古いデータを削除する
	 */
	async deleteSchedulesAsync(videoIds)
	{
		if (videoIds.length === 0) return;
		const placeholders = videoIds.map(() => "?").join(",");
		await this.db.prepare(`DELETE FROM schedules WHERE video_id IN (${placeholders})`).bind(...videoIds).run();
	}

	/**
	 * 期間外の古いデータを一括削除する
	 */
	async cleanupOldSchedulesAsync(limitIso)
	{
		await this.db.prepare("DELETE FROM schedules WHERE start_time_iso < ?").bind(limitIso).run();
	}
}