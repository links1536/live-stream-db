// youtube_schedule_updater.js

import { YouTubeScheduleRepository } from "../repository/youtube_schedule_repository.js";
import { VTuberRepository } from "../repository/vtuber_repository.js";
import { YouTubeDataAPI } from "../api/youtube_data_api.js";
import { HttpUtils } from "../httputils.js";
import { DisplayScheduleQueryService } from "../query_service/diplay_schedule_query.js";

// --- 設定 ---
const MS_PER_DAY = 86400000;
const BEFORE_DAYS = 1 * MS_PER_DAY;
const AFTER_DAYS = 7 * MS_PER_DAY;
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

	async saveDataJson(currentDate)
	{
		// 期間外クリーンアップ用の現在時刻
		const startLimit = (currentDate - BEFORE_DAYS);
		const endLimit = (currentDate + AFTER_DAYS);

		// DBからアクティブな配信（表示期間内）のみを抽出
		const displaySchedules = await this.diplayScheduleQuery.loadSchedulesAsync(startLimit, endLimit);

		const publicData = {
			updated_at: new Date(currentDate).toISOString(),
			all_schedules: displaySchedules,
		};

		//const publicDataStr = JSON.stringify(publicData);
		//await this.livesJsonStore.put(OUTPUT_KEY, publicDataStr);

		console.log(`Generated ${OUTPUT_KEY} (${displaySchedules.length} streams)`);
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
		const singleVideoIds = await this.youtubeNoticesCache.getAll();
		if (singleVideoIds != null && singleVideoIds.length > 0) {
			for (const id of singleVideoIds) {
				requestIds.add(id);
			}
		}

		console.log(`Checking ${requestIds.length} video IDs...`);

		const chunkSize = YouTubeDataAPI.CHUNK_SIZE;
		for (let i = 0; i < requestIds.length; i += chunkSize) {
			const chunk = requestIds.slice(i, i + chunkSize);
			try {
				const [schedules, foundIds] = youtubeDataApi.getVideoInfosAsync(chunk);
				if (schedules == null || schedules.length <= 0
				 || foundIds == null || foundIds.length <= 0
				) {
					continue;
				}

				// APIから返ってこなかったIDを削除対象に追加
				for (const videoId of chunk) {
					if (!foundIds.has(videoId)) {
						removedIds.add(videoId);
					}
				}

				// DBに保存
				this.youtubeRepository.saveSchedulesAsync(schedules);
			}
			catch (e) {
				//エラーがあって処理できなかったIDはなにもしない
				console.error(`API Error: ${e.message}`);
				continue;
			}
		}

		// レスポンスを受け取りながらも乗っていないデータは非公開や削除がされている
		if (removedIds.length > 0) {
			this.youtubeRepository.deleteSchedulesAsync(removedIds);
		}

		// 期間外クリーンアップ
		const currentDate = new Date().getTime();
		const startLimitIso = new Date(currentDate - BEFORE_DAYS).toISOString();
		await this.youtubeRepository.cleanupOldSchedulesAsync(startLimitIso);

		console.log(`Update complete: ${foundIds.length} active, ${ridList.length} removed.`);

		// 公開用 JSON 生成
		await this.saveDataJson(currentDate);

		// 処理が成功したので、単体IDキャッシュを削除する
		const deleteSingleVideoIds = [];
		if (singleVideoIds?.length) {
			for (const id of singleVideoIds) {
				if (removedIds.has(id) || (id in foundIds)) {
					deleteSingleVideoIds.push(id);
				}
			}
			if (deleteSingleVideoIds.length > 0) {
				await this.youtubeNoticesCache.deleteListAsync(deleteSingleVideoIds);
			}
		}
	}
}
