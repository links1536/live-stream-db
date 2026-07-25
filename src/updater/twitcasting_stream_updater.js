import { VTuberRepository } from "../repository/vtuber_repository.js";
import { TwitCastingAPI } from "../api/twitcasting_api.js";
import { TwitCastingStreamRepository } from "../repository/twitcasting_stream_repository.js";
import { DateTimeUtils } from "../datetime_utils.js";
import { Log } from "../log.js";

const SECONDS_PER_RATE_LIMIT_WINDOW = 60;
const UPCOMING_DAYS = 7;

export class TwitCastingStreamUpdater
{
	constructor(env)
	{
		this.vtuberRepository = new VTuberRepository(env.DB);
		this.twitcastingApi = new TwitCastingAPI(
			env.TWITCASTING_CLIENT_ID,
			env.TWITCASTING_CLIENT_SECRET
		);
		this.twitcastingStreamRepository = new TwitCastingStreamRepository(env.DB);
		this.updateStreamsQueue = env.QUEUE_STREAM_UPDATE_TARGET;
		const doId = env.STREAM_UPDATE_COORDINATOR.idFromName("stream-update-coordinator");
		this.streamUpdateCoordinator = env.STREAM_UPDATE_COORDINATOR.get(doId);
	}

	async scheduleTrigger(outputRunId = null)
	{
		const twitcastingMap = await this.vtuberRepository.loadTwitCastingMapAsync();
		const screenIds = Object.keys(twitcastingMap);
		if (screenIds.length === 0) {
			await this.updateStreamsQueue.send(JSON.stringify({
				type: "twitcasting_clear_all",
				output_run_id: outputRunId
			}));
			return;
		}

		const batchCount = Math.ceil(screenIds.length / TwitCastingAPI.CHUNK_SIZE);
		const runId = crypto.randomUUID();
		await this.streamUpdateCoordinator.initializeRunAsync(runId, batchCount, "twitcasting", outputRunId);
		Log.info("TwitCastingStreamUpdater", `Checking ${screenIds.length} TwitCasting users...`);

		for (let i = 0; i < screenIds.length; i += TwitCastingAPI.CHUNK_SIZE) {
			const chunk = screenIds.slice(i, i + TwitCastingAPI.CHUNK_SIZE);
			const batchIndex = Math.floor(i / TwitCastingAPI.CHUNK_SIZE);
			Log.info("TwitCastingStreamUpdater", `Enqueue TwitCasting users: ${chunk.join(",")}`);
			await this.updateStreamsQueue.send(
				JSON.stringify({
					type: "twitcasting_user_batch_update",
					run_id: runId,
					screen_ids: chunk
				}),
				{ delaySeconds: (batchIndex + 1) * SECONDS_PER_RATE_LIMIT_WINDOW }
			);
		}
	}

	async updateStreamsByScreenIds(screenIds)
	{
		if (!screenIds?.length)
			return false;

		const currentDate = DateTimeUtils.getCurrentDate();
		const [startLimit] = DateTimeUtils.getLimitDate(currentDate);
		const streams = [];

		for (const screenId of screenIds) {
			const currentLives = await this.twitcastingApi.getCurrentLiveAsync(screenId);
			if (currentLives == null) {
				Log.error("TwitCastingStreamUpdater", `Skipping refresh because current live request failed: ${screenId}`);
				return false;
			}

			const upcomingSchedules = await this.twitcastingApi.getUpcomingLiveSchedulesAsync(screenId, UPCOMING_DAYS);
			if (upcomingSchedules == null) {
				Log.error("TwitCastingStreamUpdater", `Skipping refresh because live schedules request failed: ${screenId}`);
				return false;
			}

			const archivedMovies = await this.twitcastingApi.getArchivedMoviesAsync(
				screenId,
				startLimit.toISOString()
			);
			if (archivedMovies == null) {
				Log.error("TwitCastingStreamUpdater", `Skipping refresh because movies request failed: ${screenId}`);
				return false;
			}

			const streamsById = new Map();
			for (const stream of [...archivedMovies, ...upcomingSchedules, ...currentLives]) {
				streamsById.set(stream.twitcasting_id, stream);
			}
			streams.push(...streamsById.values());
		}

		return await this.twitcastingStreamRepository.replaceStreamsByScreenIdsAsync(screenIds, streams);
	}
}
