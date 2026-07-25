import { Log } from "../log.js";

export class TwitCastingStreamRepository
{
	constructor(db)
	{
		this.db = db;
	}

	async clearAllAsync()
	{
		const result = await this.db.prepare("DELETE FROM twitcasting_streams").run();
		const changes = result.meta?.changes || 0;
		Log.info("TwitCastingStreamRepository", `D1: Cleared ${changes} TwitCasting streams.`);
		return changes > 0;
	}

	async replaceStreamsByScreenIdsAsync(screenIds, streams)
	{
		const currentStreams = await this.loadStreamsByScreenIdsAsync(screenIds);
		const normalizedCurrent = this.normalizeStreams(currentStreams);
		const normalizedNext = this.normalizeStreams(streams);
		if (JSON.stringify(normalizedCurrent) === JSON.stringify(normalizedNext)) {
			Log.info("TwitCastingStreamRepository", `D1: No changes for ${screenIds?.length ?? 0} TwitCasting users.`);
			return false;
		}

		const batch = [];
		if (screenIds?.length) {
			const placeholders = screenIds.map(() => "?").join(",");
			const deleteStmt = this.db.prepare(`DELETE FROM twitcasting_streams WHERE screen_id IN (${placeholders})`);
			batch.push(deleteStmt.bind(...screenIds));
		}

		if (streams?.length) {
			const insertStmt = this.db.prepare(`
				INSERT INTO twitcasting_streams (
					twitcasting_id, screen_id, title, thumbnail, start_time_iso, published_at_iso, url, status
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`);

			for (const stream of streams) {
				batch.push(insertStmt.bind(
					stream.twitcasting_id ?? null,
					stream.screen_id ?? null,
					stream.title ?? null,
					stream.thumbnail ?? null,
					stream.start_time_iso ?? null,
					stream.published_at_iso ?? null,
					stream.url ?? null,
					stream.status ?? "upcoming"
				));
			}
		}

		const results = await this.db.batch(batch);
		const totalChanges = results.reduce((sum, res) => sum + (res.meta?.changes || 0), 0);
		Log.info("TwitCastingStreamRepository", `D1: Replaced ${streams?.length ?? 0} streams for ${screenIds?.length ?? 0} TwitCasting users (${totalChanges} changes).`);
		return totalChanges > 0;
	}

	async loadStreamsByScreenIdsAsync(screenIds)
	{
		if (!screenIds?.length)
			return [];

		const placeholders = screenIds.map(() => "?").join(",");
		const { results } = await this.db.prepare(`
			SELECT twitcasting_id, screen_id, title, thumbnail, start_time_iso, published_at_iso, url, status
			FROM twitcasting_streams
			WHERE screen_id IN (${placeholders})
		`).bind(...screenIds).all();
		return results || [];
	}

	normalizeStreams(streams)
	{
		return [...(streams || [])]
			.map(stream => ({
				twitcasting_id: stream.twitcasting_id ?? null,
				screen_id: stream.screen_id ?? null,
				title: stream.title ?? null,
				thumbnail: stream.thumbnail ?? null,
				start_time_iso: stream.start_time_iso ?? null,
				published_at_iso: stream.published_at_iso ?? null,
				url: stream.url ?? null,
				status: stream.status ?? "upcoming"
			}))
			.sort((a, b) => {
				const left = `${a.screen_id ?? ""}:${a.twitcasting_id ?? ""}`;
				const right = `${b.screen_id ?? ""}:${b.twitcasting_id ?? ""}`;
				return left.localeCompare(right);
			});
	}
}
