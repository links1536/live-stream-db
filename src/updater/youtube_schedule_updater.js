// youtube_schedule_updater.js

import { YouTubeScheduleRepository } from "../repository/youtube_schedule_repository.js";
import { VTuberRepository } from "../repository/vtuber_repository.js";
import { YouTubeDataAPI } from "../api/youtube_data_api.js";

// --- 設定 ---
const BEFORE_DAYS = 1;
const AFTER_DAYS = 7;
const OUTPUT_KEY = "lives.json";

export class YouTubeScheduleUpdater
{
	constructor(env)
	{
		this.youtubeRepository = new YouTubeScheduleRepository(env.KV_CACHE);
		this.vtuberRepository = new VTuberRepository(env.KV_MASTER, env.KV_CACHE);
		this.youtubeDataApi = new YouTubeDataAPI(env.YOUTUBE_DATA_API_KEY);

		const doId = env.YOUTUBE_NOTICES_CACHE.idFromName("rss-key-cache");
		this.youtubeNoticesCache = env.YOUTUBE_NOTICES_CACHE.get(doId);

		this.livesJsonStore = env.KV_OUTPUT;
	}

	async saveDataJson(validSchedules, currentDate)
	{
		const publicData = {
			updated_at: new Date(currentDate).toISOString(),
			all_schedules: validSchedules,
		};

		await this.livesJsonStore.put(OUTPUT_KEY, JSON.stringify(publicData));
		console.log(`Generated ${OUTPUT_KEY} (${validSchedules.length} streams)`);
	}

	async updateSchedules()
	{
		// マスター読み込み
		const vtubers = await this.vtuberRepository.loadMasterDataAsync();
		const youtubeIdMap = await this.vtuberRepository.loadYouTubeMapAsync();

		// キャッシュ読み込み
		let totalSchedules = (await this.youtubeRepository.loadSchedulesAsync()) || {};

		// リクエスト対象ID
		const requestIds = new Set();
		for (const id in totalSchedules) {
			requestIds.add(id);
		}

		// 単体IDキャッシュ
		const singleVideoIds = await this.youtubeNoticesCache.getAll();

		if (singleVideoIds?.length) {
			for (const id of singleVideoIds) {
				requestIds.add(id);
			}
		}

		// YouTube Data API 呼び出し
		const apiResult = await this.youtubeDataApi.getVideoInfosAsync(
			Array.from(requestIds),
			youtubeIdMap
		);
		const [response, startTimes, removedIds] = apiResult;

		// 削除されたデータをキャッシュから除外
		for (const rid of removedIds) {
			delete totalSchedules[rid];
		}

		// 最新データで上書き
		Object.assign(totalSchedules, response);

		// 期間外クリーンアップ用の現在時刻
		const currentDate = new Date().getTime();
		const msPerDay = 86400000; // 24 * 60 * 60 * 1000
		const startLimit = (currentDate - BEFORE_DAYS * msPerDay);
		const endLimit = (currentDate + AFTER_DAYS * msPerDay);

		// 期間外（古すぎる）データを削除 → 残すのは startLimit 以降のもの
		const newCacheSchedules = {};
		const displaySchedules = [];
		for (const id in totalSchedules) {
			const video = totalSchedules[id];
			const startTime = startTimes[id];

			// startTime がない場合は残す
			// ある場合は startLimit 以上なら残す
			if (!startTime || startTime >= startLimit) {
				newCacheSchedules[id] = video;
				
				// 表示期間内（未来＋直近の過去）か判定
				if (startTime && startTime <= endLimit) {
					displaySchedules.push(video);
				}
			}
		}

		// キャッシュ保存
		await this.youtubeRepository.saveSchedulesAsync(newCacheSchedules);

		// 公開用 JSON 生成
		await this.saveDataJson(displaySchedules, currentDate);

		// 処理が成功したので、単体IDキャッシュを削除する
		const deleteSingleVideoIds = [];
		if (singleVideoIds?.length) {
			for (const id of singleVideoIds) {
				if (removedIds.has(id) || (id in response)) {
					deleteSingleVideoIds.push(id);
				}
			}
		}

		if (deleteSingleVideoIds.length > 0) {
			await this.youtubeNoticesCache.deleteListAsync(deleteSingleVideoIds);
		}
	}
}
