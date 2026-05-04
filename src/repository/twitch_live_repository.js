import { Log } from "../log.js";

export class TwitchLiveRepository
{
	constructor(db)
	{
		this.db = db;
	}

	async replaceLiveStreamsAsync(streams)
	{
		const batch = [];
		batch.push(this.db.prepare("DELETE FROM twitch_live_streams"));

		if (streams?.length) {
			const insertStmt = this.db.prepare(`
				INSERT INTO twitch_live_streams (
					user_login, title, thumbnail, start_time_iso, viewer_count, url, status
				) VALUES (?, ?, ?, ?, ?, ?, ?)
			`);

			for (const stream of streams) {
				batch.push(insertStmt.bind(
					stream.user_login ?? null,
					stream.title ?? null,
					stream.thumbnail ?? null,
					stream.start_time_iso ?? null,
					stream.viewer_count ?? 0,
					stream.url ?? null,
					stream.status ?? "live"
				));
			}
		}

		const results = await this.db.batch(batch);
		const totalChanges = results.reduce((sum, res) => sum + (res.meta?.changes || 0), 0);
		Log.info("TwitchLiveRepository", `D1: Replaced ${streams?.length ?? 0} twitch live streams (${totalChanges} changes).`);
	}
}
