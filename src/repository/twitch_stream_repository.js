import { Log } from "../log.js";

export class TwitchStreamRepository
{
	constructor(db)
	{
		this.db = db;
	}

	async replaceStreamsAsync(streams)
	{
		const batch = [];
		batch.push(this.db.prepare("DELETE FROM twitch_streams"));

		if (streams?.length) {
			const insertStmt = this.db.prepare(`
				INSERT INTO twitch_streams (
					twitch_id, user_login, title, thumbnail, start_time_iso, published_at_iso, url, status
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`);

			for (const stream of streams) {
				batch.push(insertStmt.bind(
					stream.twitch_id ?? null,
					stream.user_login ?? null,
					stream.title ?? null,
					stream.thumbnail ?? null,
					stream.start_time_iso ?? null,
					stream.published_at_iso ?? null,
					stream.url ?? null,
					stream.status ?? "live"
				));
			}
		}

		const results = await this.db.batch(batch);
		const totalChanges = results.reduce((sum, res) => sum + (res.meta?.changes || 0), 0);
		Log.info("TwitchStreamRepository", `D1: Replaced ${streams?.length ?? 0} twitch streams (${totalChanges} changes).`);
	}
}
