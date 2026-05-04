// repository/youtube_schedule_repository.js
import { Log } from "../log.js";

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
				WHERE COALESCE(start_time_iso, published_at_iso) IS NOT NULL
				AND COALESCE(start_time_iso, published_at_iso) >= ? AND COALESCE(start_time_iso, published_at_iso) <= ?
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
			Log.error("DisplayScheduleQueryService", `Failed to load active schedules: ${e.message}`);
			return [];
		}
	}

	async loadActiveSchedulesJsonAsync(currentDateIso, startLimitIso, endLimitIso)
	{

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
				"published_at_iso": "2026-04-25T14:50:00Z",
				"display_time_iso": "2026-04-25T15:00:00Z",
				"status": "upcoming"
			},
		 */

		const queryResult = await this.db.prepare(`
			WITH filtered_schedules AS (
				-- 先にスケジュールを期間で絞る
				SELECT *,
					COALESCE(start_time_iso, published_at_iso) AS display_time_iso
				FROM youtube_schedules
				WHERE COALESCE(start_time_iso, published_at_iso) IS NOT NULL
					AND COALESCE(start_time_iso, published_at_iso) >= ?2
					AND COALESCE(start_time_iso, published_at_iso) <= ?3
			),
			aggregated_tags AS (
				-- 事前に VTuber に対してタグをまとめておく
				SELECT vtuber_id, json_group_array(tag) AS tags_json
				FROM vtuber_tags
				GROUP BY vtuber_id
			)
			SELECT 
				json_object(
					'updated_at', ?1,
					'all_schedules', COALESCE(
						json_group_array(
							json_object(
								'streamer_name', v.name,
								'color', v.color,
								'agency', v.agency,
								'tags', COALESCE(json(at.tags_json), json_array()),
								'video_id', schedule.video_id,
								'title', schedule.title,
								'thumbnail', schedule.thumbnail,
								'start_time_iso', schedule.start_time_iso,
								'published_at_iso', schedule.published_at_iso,
								'display_time_iso', schedule.display_time_iso,
								'status', schedule.status
							)
						), 
						json_array()
					)
				) AS schedules_json,
				COUNT(*) AS schedule_count
			FROM filtered_schedules schedule
			JOIN youtube_channels channel ON schedule.channel_id = channel.channel_id
			JOIN vtubers v ON channel.vtuber_id = v.id
			LEFT JOIN aggregated_tags at ON v.id = at.vtuber_id;
		`)
		.bind(currentDateIso, startLimitIso, endLimitIso)
		.first();

		// first() はオブジェクトを返すため、カラム名を指定して取得する
		const publicDataJsonStr = queryResult?.schedules_json ?? '{"updated_at":"", "all_schedules":[]}';
		const count = queryResult?.schedule_count ?? 0;

		return [publicDataJsonStr, count];
	}
}
