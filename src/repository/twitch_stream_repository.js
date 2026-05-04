import { Log } from "../log.js";

export class TwitchStreamRepository
{
	constructor(db)
	{
		this.db = db;
	}

	async clearAllAsync()
	{
		const result = await this.db.prepare("DELETE FROM twitch_streams").run();
		const changes = result.meta?.changes || 0;
		Log.info("TwitchStreamRepository", `D1: Cleared ${changes} twitch streams.`);
		return changes > 0;
	}

	async replaceStreamsByUserLoginsAsync(userLogins, streams)
	{
		const currentStreams = await this.loadStreamsByUserLoginsAsync(userLogins);
		const normalizedCurrent = this.normalizeStreams(currentStreams);
		const normalizedNext = this.normalizeStreams(streams);
		if (JSON.stringify(normalizedCurrent) === JSON.stringify(normalizedNext)) {
			Log.info("TwitchStreamRepository", `D1: No changes for ${userLogins?.length ?? 0} Twitch users.`);
			return false;
		}

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
		return totalChanges > 0;
	}

	async loadStreamsByUserLoginsAsync(userLogins)
	{
		if (!userLogins?.length)
			return [];

		const placeholders = userLogins.map(() => "?").join(",");
		const { results } = await this.db.prepare(`
			SELECT twitch_id, user_login, title, thumbnail, start_time_iso, published_at_iso, url, status
			FROM twitch_streams
			WHERE user_login IN (${placeholders})
		`).bind(...userLogins).all();
		return results || [];
	}

	normalizeStreams(streams)
	{
		return [...(streams || [])]
			.map(stream => ({
				twitch_id: stream.twitch_id ?? null,
				user_login: stream.user_login ?? null,
				title: stream.title ?? null,
				thumbnail: stream.thumbnail ?? null,
				start_time_iso: stream.start_time_iso ?? null,
				published_at_iso: stream.published_at_iso ?? null,
				url: stream.url ?? null,
				status: stream.status ?? "live"
			}))
			.sort((a, b) => {
				const left = `${a.user_login ?? ""}:${a.twitch_id ?? ""}`;
				const right = `${b.user_login ?? ""}:${b.twitch_id ?? ""}`;
				return left.localeCompare(right);
			});
	}
}
