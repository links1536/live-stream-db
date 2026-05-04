import { VTuberRepository } from "../repository/vtuber_repository.js";
import { TwitchAPI } from "../api/twitch_api.js";
import { TwitchStreamRepository } from "../repository/twitch_stream_repository.js";
import { DateTimeUtils } from "../datetime_utils.js";
import { Log } from "../log.js";

export class TwitchStreamUpdater
{
	constructor(env)
	{
		this.vtuberRepository = new VTuberRepository(env.DB);
		this.twitchApi = new TwitchAPI(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET);
		this.twitchStreamRepository = new TwitchStreamRepository(env.DB);
		this.updateStreamsQueue = env.QUEUE_TWITCH_UPDATE_TARGET;
		const doId = env.STREAM_UPDATE_COORDINATOR.idFromName("stream-update-coordinator");
		this.streamUpdateCoordinator = env.STREAM_UPDATE_COORDINATOR.get(doId);
	}

	async scheduleTrigger(outputRunId = null)
	{
		const twitchMap = await this.vtuberRepository.loadTwitchMapAsync();
		const userLogins = Object.keys(twitchMap);
		if (userLogins.length === 0) {
			await this.updateStreamsQueue.send(JSON.stringify({
				type: "clear_all",
				output_run_id: outputRunId
			}));
			return;
		}

		const runId = crypto.randomUUID();
		await this.streamUpdateCoordinator.initializeRunAsync(runId, userLogins.length, "twitch", outputRunId);
		Log.info("TwitchStreamUpdater", `Checking ${userLogins.length} Twitch users...`);
		for (const userLogin of userLogins) {
			Log.info("TwitchStreamUpdater", `Enqueue Twitch user: ${userLogin}`);
			await this.updateStreamsQueue.send(JSON.stringify({
				type: "user_update",
				run_id: runId,
				user_login: userLogin
			}));
		}
	}

	async updateStreamByUserLogin(userLogin)
	{
		if (!userLogin)
			return;

		const userLogins = [userLogin];
		const users = await this.twitchApi.getUsersAsync(userLogins);
		if (users == null) {
			Log.error("TwitchStreamUpdater", "Skipping Twitch refresh because Twitch users request failed");
			return;
		}

		const liveStreams = await this.twitchApi.getLiveStreamsAsync(userLogins);
		if (liveStreams == null) {
			Log.error("TwitchStreamUpdater", "Skipping Twitch refresh because Twitch streams request failed");
			return;
		}

		const currentDate = DateTimeUtils.getCurrentDate();
		const [startLimit] = DateTimeUtils.getLimitDate(currentDate);
		const archivedStreams = await this.twitchApi.getArchivedVideosAsync(users, startLimit.toISOString());
		if (archivedStreams == null) {
			Log.error("TwitchStreamUpdater", "Skipping Twitch refresh because Twitch videos request failed");
			return;
		}

		return await this.twitchStreamRepository.replaceStreamsByUserLoginsAsync(userLogins, [
			...liveStreams,
			...archivedStreams
		]);
	}
}
