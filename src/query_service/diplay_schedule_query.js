// repository/youtube_schedule_repository.js

/**
 * YouTube Data APIを利用するクラス
 */

export class DisplayScheduleQueryService
{
	constructor(db)
	{
		this.db = db;
	}

	/**
	 * DBから特定のアクティブな配信を読み込む（KV出力用）
	 */
	async loadActiveSchedulesAsync(startLimit, endLimit)
	{
		try {
			// 表示期間内のものを取得
			const startLimitIso = new Date(startLimit).toISOString();
			const endLimitIso = new Date(endLimit).toISOString();
			const { results } = await this.db.prepare(
				`
				SELECT * FROM display_schedules
				WHERE start_time_iso IS NOT NULL
				AND start_time_iso >= ? AND start_time_iso <= ?
				`
			)
			.bind(startLimitIso, endLimitIso)
			.all();
			
			// プログラムで扱う為の形に整形して返す
			return results
				.map(row => ({
					...row,
					//tags: row.tags ? row.tags.sp : []
				}));
		}
		catch (e) {
			console.error(`Failed to load active schedules: ${e.message}`);
			return [];
		}
	}
}