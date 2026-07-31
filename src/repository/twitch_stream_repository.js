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
					twitch_id, source_stream_id, user_login, title, thumbnail, start_time_iso, published_at_iso, url, status
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`);

			for (const stream of streams) {
				batch.push(insertStmt.bind(
					stream.twitch_id ?? null,
					stream.source_stream_id ?? stream.twitch_id ?? null,
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

	async upsertStreamAsync(stream)
	{
		if (!stream?.twitch_id)
			return false;

		const current = await this.loadStreamByIdAsync(stream.twitch_id);
		const normalizedCurrent = current ? this.normalizeStreams([current])[0] : null;
		const normalizedNext = this.normalizeStreams([stream])[0];
		if (JSON.stringify(normalizedCurrent) === JSON.stringify(normalizedNext))
			return false;

		const result = await this.db.prepare(`
			INSERT INTO twitch_streams (
				twitch_id, source_stream_id, user_login, title, thumbnail, start_time_iso, published_at_iso, url, status
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(twitch_id) DO UPDATE SET
				source_stream_id = excluded.source_stream_id,
				user_login = excluded.user_login,
				title = excluded.title,
				thumbnail = excluded.thumbnail,
				start_time_iso = excluded.start_time_iso,
				published_at_iso = excluded.published_at_iso,
				url = excluded.url,
				status = excluded.status
		`).bind(
			normalizedNext.twitch_id,
			normalizedNext.source_stream_id,
			normalizedNext.user_login,
			normalizedNext.title,
			normalizedNext.thumbnail,
			normalizedNext.start_time_iso,
			normalizedNext.published_at_iso,
			normalizedNext.url,
			normalizedNext.status
		).run();
		const changes = result.meta?.changes || 0;
		Log.info("TwitchStreamRepository", `D1: Upserted Twitch stream ${stream.twitch_id} (${changes} changes).`);
		return changes > 0;
	}

	async deleteLiveStreamsByUserLoginAsync(userLogin, endedAtIso = null)
	{
		if (!userLogin)
			return { dirty: false, streams: [] };

		const currentStreams = await this.loadLiveStreamsByUserLoginAsync(userLogin);
		const endedAtTime = endedAtIso ? new Date(endedAtIso).getTime() : Number.POSITIVE_INFINITY;
		const targets = currentStreams.filter(stream => {
			const startedAtTime = stream.start_time_iso ? new Date(stream.start_time_iso).getTime() : 0;
			return !Number.isFinite(endedAtTime) || !Number.isFinite(startedAtTime) || startedAtTime <= endedAtTime;
		});
		if (targets.length === 0)
			return { dirty: false, streams: [] };

		const ids = targets.map(stream => stream.twitch_id);
		const placeholders = ids.map(() => "?").join(",");
		const result = await this.db.prepare(
			`DELETE FROM twitch_streams WHERE twitch_id IN (${placeholders})`
		).bind(...ids).run();
		const changes = result.meta?.changes || 0;
		Log.info("TwitchStreamRepository", `D1: Deleted ${changes} live Twitch streams for ${userLogin}.`);
		return { dirty: changes > 0, streams: targets };
	}

	async loadStreamByIdAsync(twitchId)
	{
		if (!twitchId)
			return null;

		return await this.db.prepare(`
			SELECT twitch_id, source_stream_id, user_login, title, thumbnail, start_time_iso, published_at_iso, url, status
			FROM twitch_streams
			WHERE twitch_id = ?
		`).bind(String(twitchId)).first();
	}

	async loadStreamBySourceStreamIdAsync(sourceStreamId, status = null)
	{
		if (!sourceStreamId)
			return null;

		if (status) {
			return await this.db.prepare(`
				SELECT twitch_id, source_stream_id, user_login, title, thumbnail, start_time_iso, published_at_iso, url, status
				FROM twitch_streams
				WHERE source_stream_id = ? AND status = ?
				LIMIT 1
			`).bind(String(sourceStreamId), status).first();
		}

		return await this.db.prepare(`
			SELECT twitch_id, source_stream_id, user_login, title, thumbnail, start_time_iso, published_at_iso, url, status
			FROM twitch_streams
			WHERE source_stream_id = ?
			LIMIT 1
		`).bind(String(sourceStreamId)).first();
	}

	async loadLiveStreamsByUserLoginAsync(userLogin)
	{
		if (!userLogin)
			return [];

		const { results } = await this.db.prepare(`
			SELECT twitch_id, source_stream_id, user_login, title, thumbnail, start_time_iso, published_at_iso, url, status
			FROM twitch_streams
			WHERE user_login = ? AND status = 'live'
		`).bind(userLogin).all();
		return results || [];
	}

	async loadStreamsByUserLoginsAsync(userLogins)
	{
		if (!userLogins?.length)
			return [];

		const placeholders = userLogins.map(() => "?").join(",");
		const { results } = await this.db.prepare(`
			SELECT twitch_id, source_stream_id, user_login, title, thumbnail, start_time_iso, published_at_iso, url, status
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
				source_stream_id: stream.source_stream_id ?? stream.twitch_id ?? null,
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
