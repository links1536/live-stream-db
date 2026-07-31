import { HttpUtils } from "../httputils.js";
import { Log } from "../log.js";

const TWITCASTING_API_ENDPOINT = "https://apiv2.twitcasting.tv";
const TWITCASTING_MAX_USERS_PER_BATCH = 15;
const TWITCASTING_API_VERSION = "2.0";
const TWITCASTING_WEBHOOK_EVENTS = [
	"livestart",
	"liveend",
	"liveschedulecreate",
	"livescheduleupdate",
	"livescheduledelete"
];

export class TwitCastingAPI
{
	constructor(clientId, clientSecret)
	{
		this.clientId = clientId;
		this.clientSecret = clientSecret;
	}

	static get CHUNK_SIZE()
	{
		return TWITCASTING_MAX_USERS_PER_BATCH;
	}

	static get WEBHOOK_EVENTS()
	{
		return TWITCASTING_WEBHOOK_EVENTS;
	}

	async getUserInfoAsync(screenId)
	{
		const response = await this.getAsync(`/users/${encodeURIComponent(screenId)}`);
		if (response == null)
			return null;
		if (!response.ok) {
			Log.error("TwitCastingAPI", `User Info Error (${screenId}): ${response.status} ${await response.text()}`);
			return null;
		}

		const json = await response.json();
		return json.user ?? null;
	}

	async registerWebhookAsync(userId, events = TWITCASTING_WEBHOOK_EVENTS)
	{
		const headers = this.getAuthHeaders();
		if (!headers)
			return false;

		const response = await HttpUtils.post(
			`${TWITCASTING_API_ENDPOINT}/webhooks`,
			{
				...headers,
				"Content-Type": "application/json"
			},
			JSON.stringify({
				user_id: String(userId),
				events
			})
		);
		if (!response.ok) {
			Log.error("TwitCastingAPI", `WebHook Registration Error (${userId}): ${response.status} ${await response.text()}`);
			return false;
		}

		return true;
	}

	async getWebhooksAsync()
	{
		const webhooks = [];
		let offset = 0;
		const limit = 50;
		let allCount = 0;

		do {
			const params = new URLSearchParams({
				limit: String(limit),
				offset: String(offset)
			});
			const response = await this.getAsync(`/webhooks?${params.toString()}`);
			if (response == null)
				return null;
			if (!response.ok) {
				Log.error("TwitCastingAPI", `WebHook List Error: ${response.status} ${await response.text()}`);
				return null;
			}

			const json = await response.json();
			const page = json.webhooks ?? [];
			webhooks.push(...page);
			allCount = json.all_count ?? webhooks.length;
			offset += page.length;
			if (page.length === 0)
				break;
		}
		while (offset < allCount);

		return webhooks;
	}

	async removeWebhookAsync(userId, events = TWITCASTING_WEBHOOK_EVENTS)
	{
		const headers = this.getAuthHeaders();
		if (!headers)
			return false;

		const params = new URLSearchParams({ user_id: String(userId) });
		for (const event of events)
			params.append("events[]", event);
		const response = await HttpUtils.delete(
			`${TWITCASTING_API_ENDPOINT}/webhooks?${params.toString()}`,
			headers
		);
		if (!response.ok && response.status !== 404) {
			Log.error("TwitCastingAPI", `WebHook Removal Error (${userId}): ${response.status} ${await response.text()}`);
			return false;
		}

		return true;
	}

	async getCurrentLiveAsync(screenId)
	{
		const response = await this.getAsync(`/users/${encodeURIComponent(screenId)}/current_live`);
		if (response == null)
			return null;
		if (response.status === 404)
			return [];
		if (!response.ok) {
			Log.error("TwitCastingAPI", `Current Live Error (${screenId}): ${response.status} ${await response.text()}`);
			return null;
		}

		const json = await response.json();
		return json.movie ? [this.mapMovie(json.movie, screenId, "live")] : [];
	}

	async getUpcomingLiveSchedulesAsync(screenId, inDays)
	{
		const params = new URLSearchParams({ in_days: String(inDays) });
		const response = await this.getAsync(
			`/users/${encodeURIComponent(screenId)}/upcoming_live_schedules?${params.toString()}`
		);
		if (response == null)
			return null;
		if (!response.ok) {
			Log.error("TwitCastingAPI", `Live Schedules Error (${screenId}): ${response.status} ${await response.text()}`);
			return null;
		}

		const json = await response.json();
		return (json.live_schedules ?? []).map(schedule => this.mapLiveSchedule(schedule, screenId));
	}

	async getArchivedMoviesAsync(screenId, startLimitIso)
	{
		const params = new URLSearchParams({
			offset: "0",
			limit: "50"
		});
		const response = await this.getAsync(
			`/users/${encodeURIComponent(screenId)}/movies?${params.toString()}`
		);
		if (response == null)
			return null;
		if (!response.ok) {
			Log.error("TwitCastingAPI", `Movies Error (${screenId}): ${response.status} ${await response.text()}`);
			return null;
		}

		const startLimitTime = new Date(startLimitIso).getTime();
		const json = await response.json();
		return (json.movies ?? [])
			.filter(movie => {
				const createdTime = Number(movie.created) * 1000;
				return Number.isFinite(createdTime) && createdTime >= startLimitTime;
			})
			.map(movie => this.mapMovie(movie, screenId, "archived"));
	}

	async getAsync(path)
	{
		const headers = this.getAuthHeaders();
		if (!headers)
			return null;

		return await HttpUtils.get(`${TWITCASTING_API_ENDPOINT}${path}`, headers);
	}

	getAuthHeaders()
	{
		if (!this.clientId || !this.clientSecret) {
			Log.error("TwitCastingAPI", "TwitCasting API credentials are not configured");
			return null;
		}

		return {
			"Accept": "application/json",
			"X-Api-Version": TWITCASTING_API_VERSION,
			"Authorization": `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`
		};
	}

	mapMovie(movie, screenId, status)
	{
		return {
			twitcasting_id: String(movie.id),
			screen_id: screenId,
			title: movie.title ?? movie.subtitle ?? null,
			thumbnail: movie.large_thumbnail ?? movie.small_thumbnail ?? "",
			start_time_iso: TwitCastingAPI.toIsoString(movie.created),
			published_at_iso: null,
			url: movie.link ?? `https://twitcasting.tv/${encodeURIComponent(screenId)}`,
			status,
			platform: "twitcasting"
		};
	}

	mapLiveSchedule(schedule, screenId)
	{
		return {
			twitcasting_id: String(schedule.id),
			screen_id: screenId,
			title: schedule.title ?? null,
			thumbnail: schedule.thumbnail ?? "",
			start_time_iso: TwitCastingAPI.toIsoString(schedule.start_at),
			published_at_iso: null,
			url: `https://twitcasting.tv/${encodeURIComponent(screenId)}`,
			status: "upcoming",
			platform: "twitcasting"
		};
	}

	static toIsoString(unixTime)
	{
		const value = Number(unixTime);
		if (!Number.isFinite(value))
			return null;

		return new Date(value * 1000).toISOString();
	}
}
