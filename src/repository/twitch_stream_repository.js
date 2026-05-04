import { Log } from "../log.js";

export class TwitchStreamRepository
{
	constructor(db)
	{
		this.db = db;
	}

	async clearAllAsync()
	{
		await this.db.prepare("DELETE FROM twitch_streams").run();
		Log.info("TwitchStreamRepository", "D1: Cleared all twitch streams.");
	}

	async replaceStreamsByUserLoginsAsync(userLogins, streams)
	{
		const batch = [];

		if (userLogins?.length) {
			const placeholders = userLogins.map(() => "?").join(",");
			const deleteStmt = this.db.prepare(`DELETE FROM twitch_streams WHERE user_login IN (${placeholders})`);
			batch.push(deleteStmt.bind(...userLogins));
		}

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
		Log.info("TwitchStreamRepository", `D1: Replaced ${streams?.length ?? 0} twitch streams for ${userLogins?.length ?? 0} users (${totalChanges} changes).`);
	}
}
