// youtube_schedule_updater.js

import { YouTubeScheduleRepository } from "../repository/youtube_schedule_repository.js";
import { VTuberRepository } from "../repository/vtuber_repository.js";
import { YouTubeDataAPI } from "../api/youtube_data_api.js";
import { DisplayScheduleQueryService } from "../query_service/diplay_schedule_query.js";
import { DateTimeUtils } from "../datetime_utils.js";
import { Log } from "../log.js";

// --- 設定 ---
const OUTPUT_KEY = "lives.json";

export class YouTubeScheduleUpdater
{
	constructor(env)
	{
		this.youtubeRepository = new YouTubeScheduleRepository(env.DB);
		this.vtuberRepository = new VTuberRepository(env.DB);
		this.youtubeDataApi = new YouTubeDataAPI(env.YOUTUBE_DATA_API_KEY);
		this.diplayScheduleQuery = new DisplayScheduleQueryService(env.DB);

		const doId = env.YOUTUBE_NOTICES_CACHE.idFromName("rss-key-cache");
		this.youtubeNoticesCache = env.YOUTUBE_NOTICES_CACHE.get(doId);

		this.livesJsonStore = env.KV_OUTPUT;
	}

	async saveDataJsonAsync(currentDateIso, startLimitIso, endLimitIso)
	{
		// DBからアクティブな配信（表示期間内）のみをJson形式で抽出
		const [publicDataStr, count] = await this.diplayScheduleQuery.loadActiveSchedulesJsonAsync(currentDateIso, startLimitIso, endLimitIso);
		await this.livesJsonStore.put(OUTPUT_KEY, publicDataStr);
		Log.info("YouTubeScheduleUpdater", `Generated ${OUTPUT_KEY} (${count} streams)`);
	}

	/**
	 * ステータス更新メインロジック
	 */
	async updateSchedules()
	{
		const removedIds = new Set();

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
		const allSchedules = []

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
					removedIds.add(videoId);
				}
			}

		}

		var modifySchedules = false;
		
		// DBに保存
		if (allSchedules.length > 0) {
			modifySchedules |= await this.youtubeRepository.saveSchedulesAsync(allSchedules);
		}

		// レスポンスを受け取りながらも乗っていないデータは非公開や削除がされている
		// 期間外クリーンアップ
		const currentDate = DateTimeUtils.getCurrentDate();
		const [startLimit, endLimit] = DateTimeUtils.getLimitDate(currentDate);
		const startLimitIso = startLimit.toISOString();
		const cleanupCount = await this.youtubeRepository.cleanupSchedulesAsync(removedIds, startLimitIso);
		modifySchedules |= cleanupCount > 0;

		// 受け取れた動画IDと削除された動画IDの数をログに出す
		const removeCount = removedIds.size;
		const foundCount = requestTargetIds.length - removeCount;
		Log.info("YouTubeScheduleUpdater", `Update complete: ${foundCount} active, ${removeCount} removed, ${cleanupCount} cleaned.`);

		// 処理が成功したので、単体IDキャッシュを削除する
		if (singleVideoIds?.length) {
			await this.youtubeNoticesCache.bulkDeleteAsync(singleVideoIds);
		}

		// 更新があればJson書き換え
		if (!modifySchedules)
			return;

		// 公開用 JSON 生成
		const currentDateIso = currentDate.toISOString();
		const endLimitIso = endLimit.toISOString();
		await this.saveDataJsonAsync(currentDateIso, startLimitIso, endLimitIso);
	}
}
