import { VTuberRepository } from "../repository/vtuber_repository.js";
import { TwitchAPI } from "../api/twitch_api.js";
import { TwitchLiveRepository } from "../repository/twitch_live_repository.js";
import { Log } from "../log.js";

export class TwitchLiveUpdater
{
	constructor(env)
	{
		this.vtuberRepository = new VTuberRepository(env.DB);
		this.twitchApi = new TwitchAPI(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET);
		this.twitchLiveRepository = new TwitchLiveRepository(env.DB);
	}

	async updateLivesAsync()
	{
		const twitchMap = await this.vtuberRepository.loadTwitchMapAsync();
		const userLogins = Object.keys(twitchMap);
		if (userLogins.length === 0) {
			await this.twitchLiveRepository.replaceLiveStreamsAsync([]);
			return;
		}

		const liveStreams = await this.twitchApi.getLiveStreamsAsync(userLogins);
		if (liveStreams == null) {
			Log.error("TwitchLiveUpdater", "Skipping Twitch refresh because Twitch API request failed");
			return;
		}

		await this.twitchLiveRepository.replaceLiveStreamsAsync(liveStreams);
	}
}
