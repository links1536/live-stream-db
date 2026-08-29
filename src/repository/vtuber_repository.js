
import { Log } from "../log.js";

// --- 設定定数 ---
const MASTER_DATA_KEY = "streamers.json"
const MASTER_YOUTUBE_MAP_KEY = "streamers_youtube_map.json"

export class VTuberRepository
{
	constructor(db)
	{
		this.db = db;
	}

	/**
	 * DBからマスターデータを読み込む
	 * merge.pyのスキーマに基づいて、VTuberと関連データを統合して返す
	 */
	async loadMasterDataAsync()
	{
		try {
			// JSON集約関数を使用して1回のクエリで全データを取得
			const { results: allData } = await this.db.prepare(`
			SELECT 
				v.id,
				v.name,
				v.agency,
				v.color,
				json_group_array(DISTINCT vt.tag) FILTER (WHERE vt.tag IS NOT NULL) as tags,
				json_group_array(DISTINCT yc.channel_id) FILTER (WHERE yc.channel_id IS NOT NULL) as youtube_ids,
				json_group_array(DISTINCT tu.user_login) FILTER (WHERE tu.user_login IS NOT NULL) as twitch_ids,
				json_group_array(DISTINCT tc.screen_id) FILTER (WHERE tc.screen_id IS NOT NULL) as twitcasting_ids
			FROM vtubers v
			LEFT JOIN vtuber_tags vt ON v.id = vt.vtuber_id
			LEFT JOIN youtube_channels yc ON v.id = yc.vtuber_id
			LEFT JOIN twitch_users tu ON v.id = tu.vtuber_id
			LEFT JOIN twitcasting_users tc ON v.id = tc.vtuber_id
			GROUP BY v.id
			ORDER BY v.id
			`).all();

			const masterData = [];
			for (const row of allData) {
				const entry = {
					Name: row.name,
					Agency: row.agency,
					Color: row.color
				};

				const tags = row.tags ? JSON.parse(row.tags).filter(Boolean) : [];
				const youtubeIds = row.youtube_ids ? JSON.parse(row.youtube_ids).filter(Boolean) : [];
				const twitchIds = row.twitch_ids ? JSON.parse(row.twitch_ids).filter(Boolean) : [];
				const twitcastingIds = row.twitcasting_ids ? JSON.parse(row.twitcasting_ids).filter(Boolean) : [];

				if (tags.length > 0)
					entry.Tags = tags;
				if (youtubeIds.length > 0)
					entry.YouTubeID = youtubeIds;
				if (twitchIds.length > 0)
					entry.TwitchID = twitchIds;
				if (twitcastingIds.length > 0)
					entry.TwitCastingID = twitcastingIds;

				masterData.push(entry);
			}
			return masterData;
		}
		catch (e) {
			Log.error("VTuberRepository", `Failed to load master data: ${e.message}`);
			throw e;
		}
	}

	/**
	 * YouTube ID マップを読み込む
	 * YouTubeID -> VTuber 情報へのマッピング
	 */
	async loadYouTubeMapAsync()
	{
		try {
			const { results } = await this.db.prepare(`
				SELECT 
					yc.channel_id,
					v.id,
					v.name,
					v.agency,
					v.color
				FROM youtube_channels yc
				JOIN vtubers v ON yc.vtuber_id = v.id
			`).all();

			const youtubeMap = {};

			for (const row of results) {
				youtubeMap[row.channel_id] = {
					id: row.id,
					Name: row.name,
					Agency: row.agency,
					Color: row.color
				};
			}

			return youtubeMap;
		}
		catch (e) {
			Log.error("VTuberRepository", `Failed to load YouTube map: ${e.message}`);
			throw e;
		}
	}

	async loadTwitchMapAsync()
	{
		try {
			const { results } = await this.db.prepare(`
				SELECT
					tu.user_login,
					v.id,
					v.name,
					v.agency,
					v.color
				FROM twitch_users tu
				JOIN vtubers v ON tu.vtuber_id = v.id
			`).all();

			const twitchMap = {};
			for (const row of results) {
				twitchMap[row.user_login] = {
					id: row.id,
					Name: row.name,
					Agency: row.agency,
					Color: row.color
				};
			}

			return twitchMap;
		}
		catch (e) {
			Log.error("VTuberRepository", `Failed to load Twitch map: ${e.message}`);
			throw e;
		}
	}

	async loadTwitCastingMapAsync()
	{
		try {
			const { results } = await this.db.prepare(`
				SELECT
					tc.screen_id,
					v.id,
					v.name,
					v.agency,
					v.color
				FROM twitcasting_users tc
				JOIN vtubers v ON tc.vtuber_id = v.id
			`).all();

			const twitcastingMap = {};
			for (const row of results) {
				twitcastingMap[row.screen_id] = {
					id: row.id,
					Name: row.name,
					Agency: row.agency,
					Color: row.color
				};
			}

			return twitcastingMap;
		}
		catch (e) {
			Log.error("VTuberRepository", `Failed to load TwitCasting map: ${e.message}`);
			throw e;
		}
	}

	/**
	 * DBからチャンネルごとの最終更新日時を読み込む
	 */
	async loadChannelLastUpdatedAsync()
	{
		try {
			const { results } = await this.db.prepare("SELECT * FROM rss_last_updated").all();
			const lastUpdated = {};
			for (const row of results) {
				lastUpdated[row.channel_id] = row.last_updated;
			}
			return lastUpdated;
		}
		catch (e) {
			Log.error("VTuberRepository", `Failed to load last updated: ${e.message}`);
			throw e;
		}
	}

	/**
	 * DBにチャンネルごとの最終更新日時を保存する
	 */
	async saveChannelLastUpdatedAsync(last_updated)
	{
		const entries = Object.entries(last_updated);
		if (entries.length === 0)
			return;

		const stmt = this.db.prepare(`
			INSERT INTO rss_last_updated (channel_id, last_updated) 
			VALUES (?, ?)
			ON CONFLICT(channel_id) DO UPDATE SET
				last_updated = EXCLUDED.last_updated
			WHERE last_updated IS NOT EXCLUDED.last_updated
		`);
		const batch = entries.map(([id, time]) => stmt.bind(id, time ?? null));

		const results = await this.db.batch(batch);
		const totalChanges = results.reduce((sum, res) => sum + (res.meta?.changes || 0), 0);
		Log.info("VTuberRepository", `D1: Updated ${totalChanges} / ${entries.length} items in rss_last_updated table.`);
	}
}
