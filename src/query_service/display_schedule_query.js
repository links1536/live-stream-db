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
				"status": "upcoming",
				"platform": "youtube",
				"url": "https://www.youtube.com/watch?v=OGkt5rWhlO0"
			},
		 */

		const queryResult = await this.db.prepare(`
			WITH filtered_schedules AS (
				SELECT
					vtuber.id AS vtuber_id,
					vtuber.name AS streamer_name,
					vtuber.color,
					vtuber.agency,
					schedule.video_id,
					schedule.title,
					schedule.thumbnail,
					schedule.start_time_iso,
					schedule.published_at_iso,
					COALESCE(start_time_iso, published_at_iso) AS display_time_iso,
					schedule.status,
					'youtube' AS platform,
					'https://www.youtube.com/watch?v=' || schedule.video_id AS url
				FROM youtube_schedules schedule
				JOIN youtube_channels channel ON schedule.channel_id = channel.channel_id
				JOIN vtubers vtuber ON channel.vtuber_id = vtuber.id
				WHERE COALESCE(schedule.start_time_iso, schedule.published_at_iso) IS NOT NULL
					AND COALESCE(schedule.start_time_iso, schedule.published_at_iso) >= ?2
					AND COALESCE(schedule.start_time_iso, schedule.published_at_iso) <= ?3
				UNION ALL
				SELECT
					vtuber.id AS vtuber_id,
					vtuber.name AS streamer_name,
					vtuber.color,
					vtuber.agency,
					stream.twitch_id AS video_id,
					stream.title,
					stream.thumbnail,
					stream.start_time_iso,
					stream.published_at_iso,
					COALESCE(stream.published_at_iso, stream.start_time_iso) AS display_time_iso,
					stream.status,
					'twitch' AS platform,
					stream.url
				FROM twitch_streams stream
				JOIN twitch_users user ON stream.user_login = user.user_login
				JOIN vtubers vtuber ON user.vtuber_id = vtuber.id
				WHERE COALESCE(stream.published_at_iso, stream.start_time_iso) IS NOT NULL
					AND COALESCE(stream.published_at_iso, stream.start_time_iso) >= ?2
					AND COALESCE(stream.published_at_iso, stream.start_time_iso) <= ?3
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
								'streamer_name', vtuber.name,
								'color', schedule.color,
								'agency', schedule.agency,
								'tags', COALESCE(json(at.tags_json), json_array()),
								'video_id', schedule.video_id,
								'title', schedule.title,
								'thumbnail', schedule.thumbnail,
								'start_time_iso', schedule.start_time_iso,
								'published_at_iso', schedule.published_at_iso,
								'display_time_iso', schedule.display_time_iso,
								'status', schedule.status,
								'platform', schedule.platform,
								'url', schedule.url
							)
						), 
						json_array()
					)
				) AS schedules_json,
				COUNT(*) AS schedule_count
			FROM filtered_schedules schedule
			JOIN vtubers vtuber ON schedule.vtuber_id = vtuber.id
			LEFT JOIN aggregated_tags at ON schedule.vtuber_id = at.vtuber_id;
		`)
		.bind(currentDateIso, startLimitIso, endLimitIso)
		.first();

		// first() はオブジェクトを返すため、カラム名を指定して取得する
		const publicDataJsonStr = queryResult?.schedules_json ?? '{"updated_at":"", "all_schedules":[]}';
		const count = queryResult?.schedule_count ?? 0;

		return [publicDataJsonStr, count];
	}
}
