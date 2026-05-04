import { HttpUtils } from "../httputils.js";
import { Log } from "../log.js";

const TWITCH_TOKEN_ENDPOINT = "https://id.twitch.tv/oauth2/token";
const TWITCH_STREAMS_ENDPOINT = "https://api.twitch.tv/helix/streams";
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

		const accessToken = await this.getAccessTokenAsync();
		if (!accessToken)
			return null;

		const headers = {
			"Client-Id": this.clientId,
			"Authorization": `Bearer ${accessToken}`
		};
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
					user_login: stream.user_login,
					title: stream.title ?? null,
					thumbnail: TwitchAPI.formatThumbnailUrl(stream.thumbnail_url),
					start_time_iso: stream.started_at ?? null,
					viewer_count: stream.viewer_count ?? 0,
					url: `https://www.twitch.tv/${stream.user_login}`,
					status: "live",
					platform: "twitch"
				});
			}
		}

		return liveStreams;
	}

	static formatThumbnailUrl(template)
	{
		if (!template)
			return "";

		return template
			.replace("{width}", "640")
			.replace("{height}", "360");
	}
}
