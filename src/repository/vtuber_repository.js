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
			const { results: vtubers } = await this.db.prepare(`
				SELECT 
					v.id,
					v.name,
					v.agency,
					v.color
				FROM vtubers v
				ORDER BY v.id
			`).all();

			const masterData = [];

			for (const vtuber of vtubers) {
				// タグを取得
				const { results: tagResults } = await this.db.prepare(`
					SELECT tag FROM vtuber_tags WHERE vtuber_id = ?
				`).bind(vtuber.id).all();
				const tags = tagResults.map(r => r.tag).filter(Boolean);

				// YouTube チャンネル ID を取得
				const { results: youtubeResults } = await this.db.prepare(`
					SELECT channel_id FROM youtube_channels WHERE vtuber_id = ?
				`).bind(vtuber.id).all();
				const youtubeIds = youtubeResults.map(r => r.channel_id).filter(Boolean);

				// Twitch ユーザーを取得
				const { results: twitchResults } = await this.db.prepare(`
					SELECT user_login FROM twitch_users WHERE vtuber_id = ?
				`).bind(vtuber.id).all();
				const twitchIds = twitchResults.map(r => r.user_login).filter(Boolean);

				// TwitCasting ユーザーを取得
				const { results: twitcastingResults } = await this.db.prepare(`
					SELECT screen_id FROM twitcasting_users WHERE vtuber_id = ?
				`).bind(vtuber.id).all();
				const twitcastingIds = twitcastingResults.map(r => r.screen_id).filter(Boolean);

				// VTuber エントリを構築
				const entry = {
					Name: vtuber.name,
					Agency: vtuber.agency,
					Color: vtuber.color
				};

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
			console.error(`Failed to load master data: ${e.message}`);
			return [];
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
			console.error(`Failed to load YouTube map: ${e.message}`);
			return {};
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
			console.error(`Failed to load last updated: ${e.message}`);
			return {};
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
		console.log(`D1: Updated ${totalChanges} / ${entries.length} items in rss_last_updated table.`);
	}
}
