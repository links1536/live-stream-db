import { HttpUtils } from "../httputils.js";
import { Log } from "../log.js";

const TWITCH_TOKEN_ENDPOINT = "https://id.twitch.tv/oauth2/token";
const TWITCH_STREAMS_ENDPOINT = "https://api.twitch.tv/helix/streams";
const TWITCH_USERS_ENDPOINT = "https://api.twitch.tv/helix/users";
const TWITCH_VIDEOS_ENDPOINT = "https://api.twitch.tv/helix/videos";
const TWITCH_MAX_USERS_PER_REQUEST = 100;

export class TwitchAPI
{
	constructor(clientId, clientSecret)
	{
		this.clientId = clientId;
		this.clientSecret = clientSecret;
		this.accessToken = null;
	}

	static get CHUNK_SIZE()
	{
		return TWITCH_MAX_USERS_PER_REQUEST;
	}

	async getAccessTokenAsync()
	{
		if (this.accessToken)
			return this.accessToken;

		if (!this.clientId || !this.clientSecret) {
			Log.error("TwitchAPI", "Twitch API credentials are not configured");
			return null;
		}

		const params = new URLSearchParams({
			client_id: this.clientId,
			client_secret: this.clientSecret,
			grant_type: "client_credentials"
		});
		const response = await HttpUtils.post(
			TWITCH_TOKEN_ENDPOINT,
			{ "Content-Type": "application/x-www-form-urlencoded" },
			params.toString()
		);
		if (!response.ok) {
			Log.error("TwitchAPI", `Token Error: ${response.status} ${await response.text()}`);
			return null;
		}

		const json = await response.json();
		this.accessToken = json.access_token ?? null;
		return this.accessToken;
	}

	async getLiveStreamsAsync(userLogins)
	{
		if (!userLogins || userLogins.length === 0)
			return [];

		const headers = await this.getAuthHeadersAsync();
		if (!headers)
			return null;
		const liveStreams = [];

		for (let i = 0; i < userLogins.length; i += TwitchAPI.CHUNK_SIZE) {
			const chunk = userLogins.slice(i, i + TwitchAPI.CHUNK_SIZE);
			const params = new URLSearchParams();
			for (const userLogin of chunk) {
				params.append("user_login", userLogin);
			}

			const response = await HttpUtils.get(`${TWITCH_STREAMS_ENDPOINT}?${params.toString()}`, headers);
			if (!response.ok) {
				Log.error("TwitchAPI", `Streams Error: ${response.status} ${await response.text()}`);
				return null;
			}

			const json = await response.json();
			for (const stream of json.data ?? []) {
				liveStreams.push({
					twitch_id: stream.id,
					user_login: stream.user_login,
					title: stream.title ?? null,
					thumbnail: TwitchAPI.formatThumbnailUrl(stream.thumbnail_url),
					start_time_iso: stream.started_at ?? null,
					published_at_iso: null,
					url: `https://www.twitch.tv/${stream.user_login}`,
					status: "live",
					platform: "twitch"
				});
			}
		}

		return liveStreams;
	}

	async getUsersAsync(userLogins)
	{
		if (!userLogins || userLogins.length === 0)
			return [];

		const headers = await this.getAuthHeadersAsync();
		if (!headers)
			return null;

		const users = [];
		for (let i = 0; i < userLogins.length; i += TwitchAPI.CHUNK_SIZE) {
			const chunk = userLogins.slice(i, i + TwitchAPI.CHUNK_SIZE);
			const params = new URLSearchParams();
			for (const userLogin of chunk) {
				params.append("login", userLogin);
			}

			const response = await HttpUtils.get(`${TWITCH_USERS_ENDPOINT}?${params.toString()}`, headers);
			if (!response.ok) {
				Log.error("TwitchAPI", `Users Error: ${response.status} ${await response.text()}`);
				return null;
			}

			const json = await response.json();
			users.push(...(json.data ?? []));
		}

		return users;
	}

	async getArchivedVideosAsync(users, startLimitIso)
	{
		if (!users || users.length === 0)
			return [];

		const headers = await this.getAuthHeadersAsync();
		if (!headers)
			return null;

		const archivedVideos = [];
		const startLimitTime = new Date(startLimitIso).getTime();

		for (const user of users) {
			let cursor = null;
			let pageCount = 0;

			do {
				const params = new URLSearchParams({
					user_id: user.id,
					type: "archive",
					first: "20"
				});
				if (cursor)
					params.append("after", cursor);

				const response = await HttpUtils.get(`${TWITCH_VIDEOS_ENDPOINT}?${params.toString()}`, headers);
				if (!response.ok) {
					Log.error("TwitchAPI", `Videos Error: ${response.status} ${await response.text()}`);
					return null;
				}

				const json = await response.json();
				const videos = json.data ?? [];
				let foundOlderVideo = false;

				for (const video of videos) {
					const publishedAt = video.published_at ?? video.created_at ?? null;
					const publishedTime = publishedAt ? new Date(publishedAt).getTime() : 0;
					if (publishedTime < startLimitTime) {
						foundOlderVideo = true;
						continue;
					}

					archivedVideos.push({
						twitch_id: video.id,
						user_login: user.login,
						title: video.title ?? null,
						thumbnail: TwitchAPI.formatThumbnailUrl(video.thumbnail_url),
						start_time_iso: video.created_at ?? null,
						published_at_iso: video.published_at ?? video.created_at ?? null,
						url: video.url ?? `https://www.twitch.tv/${user.login}/videos`,
						status: "archived",
						platform: "twitch"
					});
				}

				cursor = foundOlderVideo ? null : json.pagination?.cursor ?? null;
				pageCount++;
			}
			while (cursor && pageCount < 3);
		}

		return archivedVideos;
	}

	async getAuthHeadersAsync()
	{
		const accessToken = await this.getAccessTokenAsync();
		if (!accessToken)
			return null;

		return {
			"Client-Id": this.clientId,
			"Authorization": `Bearer ${accessToken}`
		};
	}

	static formatThumbnailUrl(template)
	{
		if (!template)
			return "";

		return template
			.replace("%{width}", "640")
			.replace("%{height}", "360")
			.replace("{width}", "640")
			.replace("{height}", "360");
	}
}
