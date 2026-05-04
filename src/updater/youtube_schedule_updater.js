// youtube_schedule_updater.js

import { YouTubeScheduleRepository } from "../repository/youtube_schedule_repository.js";
import { YouTubeDataAPI } from "../api/youtube_data_api.js";
import { DateTimeUtils } from "../datetime_utils.js";
import { Log } from "../log.js";

export class YouTubeScheduleUpdater
{
	constructor(env)
	{
		this.youtubeRepository = new YouTubeScheduleRepository(env.DB, env.KV_CACHE);
		this.youtubeDataApi = new YouTubeDataAPI(env.YOUTUBE_DATA_API_KEY);

		this.updateSchedulesQueue = env.QUEUE_YOUTUBE_UPDATE_TARGET;

		const doId = env.YOUTUBE_NOTICES_CACHE.idFromName("rss-key-cache");
		this.youtubeNoticesCache = env.YOUTUBE_NOTICES_CACHE.get(doId);
		const streamCoordinatorId = env.STREAM_UPDATE_COORDINATOR.idFromName("stream-update-coordinator");
		this.streamUpdateCoordinator = env.STREAM_UPDATE_COORDINATOR.get(streamCoordinatorId);
	}

	async scheduleTrigger(outputRunId = null)
	{
		// キャッシュ済みIDを読み込み
		const targetIds = await this.youtubeRepository.getScheduleIdsAsync();
		
		// リクエスト対象ID
		const requestIds = new Set(targetIds);

		// 単体IDキャッシュ
		const singleVideoIds = await this.youtubeNoticesCache.getAllAsync();
		if (singleVideoIds != null && singleVideoIds.length > 0) {
			for (const id of singleVideoIds) {
				requestIds.add(id);
			}
		}

		// 出来るだけ同じ数になるように分割
		const requestTargetIds = Array.from(requestIds);
		if (requestTargetIds.length === 0) {
			if (outputRunId)
				await this.streamUpdateCoordinator.completeOutputSourceAsync(outputRunId, "youtube", false);
			return;
		}

		const runId = crypto.randomUUID();
		await this.streamUpdateCoordinator.initializeRunAsync(runId, Math.ceil(requestTargetIds.length / YouTubeDataAPI.CHUNK_SIZE), "youtube", outputRunId);
		const chunkCount = Math.ceil(requestTargetIds.length / YouTubeDataAPI.CHUNK_SIZE);
		const chunkSize = Math.min(YouTubeDataAPI.CHUNK_SIZE, Math.ceil(requestTargetIds.length / chunkCount));
		Log.info("YouTubeScheduleUpdater", `Checking ${requestTargetIds.length} video IDs...`);
		for (let i = 0; i < requestTargetIds.length; i += chunkSize) {
			const chunk = requestTargetIds.slice(i, i + chunkSize);
			Log.info("YouTubeScheduleUpdater", `Chunk: ${chunkSize} Id: ${chunk.join(",")}`);
			await this.updateSchedulesQueue.send(JSON.stringify({
				type: "youtube_chunk",
				run_id: runId,
				video_ids: chunk
			}));
		}
		
		// リクエストを投げたので単体IDキャッシュを削除する
		await this.youtubeNoticesCache.bulkDeleteAsync(singleVideoIds);
	}

	/**
	 * ステータス更新メインロジック
	 */
	async updateSchedules(requestTargetIds)
	{
		// チャンク単位でリクエストする
		const [schedules, foundIds] = await this.youtubeDataApi.getVideoInfosAsync(requestTargetIds);
		if (schedules == null || foundIds == null) {
			return;
		}

		// APIから返ってこなかったIDを削除対象に追加
		const removedIds = []
		for (const videoId of requestTargetIds) {
			if (!foundIds.has(videoId)) {
				Log.info("YouTubeScheduleUpdater", `Missing Video ID: ${videoId}`);
				removedIds.push(videoId);
			}
		}

		// DBに保存
		// レスポンスを受け取りながらも乗っていないデータは非公開や削除がされている
		// 期間外クリーンアップ
		const currentDate = DateTimeUtils.getCurrentDate();
		const [startLimit] = DateTimeUtils.getLimitDate(currentDate);
		const startLimitIso = startLimit.toISOString();
		const [ updateCount, cleanupCount, modifySchedules ] = await this.youtubeRepository.saveAndCleanupSchedulesAsync(schedules, removedIds, startLimitIso);

		// 受け取れた動画IDと削除された動画IDの数をログに出す
		const removeCount = removedIds.length;
		const foundCount = requestTargetIds.length - removeCount;
		Log.info("YouTubeScheduleUpdater", `Update complete: ${foundCount} active, ${removeCount} removed, ${cleanupCount} cleaned.`);

		// 処理が成功したので、単体IDキャッシュを削除する
		if (foundIds?.size) {
			await this.youtubeNoticesCache.bulkDeleteAsync(Array.from(foundIds));
		}

		return modifySchedules;
	}

	/**
	 * ステータス更新メインロジック
	 */
	async updateSchedulesAll()
	{
		// キャッシュ済みIDを読み込み
		const targetIds = await this.youtubeRepository.getScheduleIdsAsync();

		// リクエスト対象ID
		const requestIds = new Set(targetIds);

		// 単体IDキャッシュ
		const singleVideoIds = await this.youtubeNoticesCache.getAllAsync();
		if (singleVideoIds != null && singleVideoIds.length > 0) {
			for (const id of singleVideoIds) {
				requestIds.add(id);
			}
		}

		// バッチをまとめて行う
		const allSchedules = [];

		// APIに乗ってこないなどで消すID
		const removedIds = [];

		// 出来るだけ同じ数になるように分割
		const requestTargetIds = Array.from(requestIds);
		const chunkCount = Math.ceil(requestTargetIds.length / YouTubeDataAPI.CHUNK_SIZE);
		const chunkSize = Math.min(YouTubeDataAPI.CHUNK_SIZE, Math.ceil(requestTargetIds.length / chunkCount));
		Log.info("YouTubeScheduleUpdater", `Checking ${requestTargetIds.length} video IDs...`);
		for (let i = 0; i < requestTargetIds.length; i += chunkSize) {
			// チャンク単位でリクエストする
			const chunk = requestTargetIds.slice(i, i + chunkSize);
			const [schedules, foundIds] = await this.youtubeDataApi.getVideoInfosAsync(chunk);
			if (schedules == null || foundIds == null) {
				continue;
			}

			allSchedules.push(...schedules);

			// APIから返ってこなかったIDを削除対象に追加
			for (const videoId of chunk) {
				if (!foundIds.has(videoId)) {
					Log.info("YouTubeScheduleUpdater", `Missing Video ID: ${videoId}`);
					removedIds.push(videoId);
				}
			}

		}

		// DBに保存
		// レスポンスを受け取りながらも乗っていないデータは非公開や削除がされている
		// 期間外クリーンアップ
		const currentDate = DateTimeUtils.getCurrentDate();
		const [startLimit] = DateTimeUtils.getLimitDate(currentDate);
		const startLimitIso = startLimit.toISOString();
		const [ updateCount, cleanupCount, modifySchedules ] = await this.youtubeRepository.saveAndCleanupSchedulesAsync(allSchedules, removedIds, startLimitIso);

		// 受け取れた動画IDと削除された動画IDの数をログに出す
		const removeCount = removedIds.length;
		const foundCount = requestTargetIds.length - removeCount;
		Log.info("YouTubeScheduleUpdater", `Update complete: ${foundCount} active, ${removeCount} removed, ${cleanupCount} cleaned.`);

		// 処理が成功したので、単体IDキャッシュを削除する
		if (singleVideoIds?.length) {
			await this.youtubeNoticesCache.bulkDeleteAsync(singleVideoIds);
		}

		// 更新があればJson書き換え
		if (!modifySchedules)
			return;

		// IDのキャッシュを更新する
		await this.youtubeRepository.updateScheduleIdsAsync();

	}
}
