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
					//tags: row.tags ? row.tags.split(/\s*,\s*/) : []
				}));
		}
		catch (e) {
			console.error(`Failed to load active schedules: ${e.message}`);
			return [];
		}
	}

	async loadActiveSchedulesJsonAsync(currentDate, startLimit, endLimit)
	{
		const startLimitIso = new Date(startLimit).toISOString();
		const endLimitIso = new Date(endLimit).toISOString();

		/*
			{
				"streamer_name": "紅炎メルト",
				"color": "#FB5D2E",
				"agency": "ぽけぶい",
				"tags": [
					"ぽけぶい"
				],
				"video_id": "OGkt5rWhlO0",
				"title": "【 ドラゴンクエストⅤ 】裏ダンジョンを冒険する！！！！！！#??【 #紅炎メルト / #ぽけぶい  】",
				"thumbnail": "https://i.ytimg.com/vi/OGkt5rWhlO0/maxresdefault_live.jpg",
				"start_time_iso": "2026-04-25T15:00:00Z",
				"status": "upcoming"
			},
		 */

		const { results } = await this.db.prepare(`
			SELECT json_group_array(
				json_object(
					'updated_at', ?,
					'all_schedules', 
					COALESCE(
						json_group_array(
							json_object(
								'streamer_name', streamer_name,
								'color', color,
								'agency', agency,
								'tags', IIF(tags IS NULL, json_array(), json_array(tags)) 
								'title', title,
								'thumbnail', tithumbnailtle,
								'start_time_iso', start_time_iso,
								'status', status
							)
						),
						json_array()
					)
				)
			) AS schedules_json,
			COUNT(*) AS schedule_count 
			FROM display_schedules
			WHERE start_time_iso IS NOT NULL
			AND start_time_iso >= ?
			AND start_time_iso <= ?
		`)
		.bind(new Date(currentDate).toISOString(), startLimitIso, endLimitIso)
		.raw();

		// results[0][0] に JSON文字列が入っている
		const publicDataJsonStr = results?.[0]?.[0] || '{"updated_at":"", "all_schedules":[]}';
		const count = results?.[0]?.[1] || 0;
		return [publicDataJsonStr, count];
	}
}