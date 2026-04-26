// youtube_schedule_updater.js

import { YouTubeScheduleRepository } from "../repository/youtube_schedule_repository.js";
import { VTuberRepository } from "../repository/vtuber_repository.js";
import { YouTubeDataAPI } from "../api/youtube_data_api.js";
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

	async saveDataJsonAsync(currentDate)
	{
		// 期間外クリーンアップ用の現在時刻
		const startLimit = (currentDate - BEFORE_DAYS);
		const endLimit = (currentDate + AFTER_DAYS);

		/*
		// DBからアクティブな配信（表示期間内）のみを抽出
		const displaySchedules = await this.diplayScheduleQuery.loadActiveSchedulesAsync(startLimit, endLimit);

		const publicData = {
			updated_at: new Date(currentDate).toISOString(),
			all_schedules: displaySchedules,
		};

		const publicDataStr = JSON.stringify(publicData);
		await this.livesJsonStore.put(OUTPUT_KEY, publicDataStr);
		*/
		
		// DBからアクティブな配信（表示期間内）のみをJson形式で抽出
		const  [publicDataJsonStr, count] = await this.diplayScheduleQuery.loadActiveSchedulesJsonAsync(currentDate, startLimit, endLimit);
		await this.livesJsonStore.put(OUTPUT_KEY, publicDataStr);

		console.log(`Generated ${OUTPUT_KEY} (${count} streams)`);
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

		// バッチをまとめて行う
		const allSchedules = []

		// 出来るだけ同じ数になるように分割
		const requestTargetIds = Array.from(requestIds);
		const chunkCount = Math.ceil(requestTargetIds.length / YouTubeDataAPI.CHUNK_SIZE);
		const chunkSize = Math.min(YouTubeDataAPI.CHUNK_SIZE, Math.ceil(requestTargetIds.length / chunkCount));
		console.log(`Checking ${requestTargetIds.length} video IDs...`);
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
		const currentDate = new Date().getTime();
		const startLimitIso = new Date(currentDate - BEFORE_DAYS).toISOString();
		modifySchedules |= 	await this.youtubeRepository.cleanupSchedulesAsync(removedIds, startLimitIso);

		// 受け取れた動画IDと削除された動画IDの数をログに出す
		const removeCount = removedIds.size;
		const foundCount = requestTargetIds.length - removeCount;
		console.log(`Update complete: ${foundCount} active, ${removeCount} removed.`);
		
	
		// 処理が成功したので、単体IDキャッシュを削除する
		if (singleVideoIds?.length) {
			await this.youtubeNoticesCache.deleteListAsync(singleVideoIds);
		}

		// 更新があればJson書き換え
		//if (!modifySchedules)
		//	return;
		// 公開用 JSON 生成
		await this.saveDataJsonAsync(currentDate);
	}
}
