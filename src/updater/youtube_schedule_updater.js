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
		const startTotal = performance.now();
		let totalIoWait = 0;

		// マスター読み込み
		const startMaster = performance.now();
		const vtubers = await this.vtuberRepository.loadMasterDataAsync();
		const waitMaster = performance.now() - startMaster;
		totalIoWait += waitMaster;
		console.log(`[PERF] loadMasterDataAsync IO wait: ${waitMaster.toFixed(2)}ms`);

		// キャッシュ読み込み
		const startLoadCache = performance.now();
		let totalSchedules = (await this.youtubeRepository.loadSchedulesAsync()) || {};
		const waitLoadCache = performance.now() - startLoadCache;
		totalIoWait += waitLoadCache;
		console.log(`[PERF] loadSchedulesAsync IO wait: ${waitLoadCache.toFixed(2)}ms`);

		// リクエスト対象ID
		let requestIds = new Set(Object.keys(totalSchedules));

		// 単体IDキャッシュ
		const startNotices = performance.now();
		const singleVideoIds = await this.youtubeNoticesCache.getAll();
		const waitNotices = performance.now() - startNotices;
		totalIoWait += waitNotices;
		console.log(`[PERF] youtubeNoticesCache.getAll IO wait: ${waitNotices.toFixed(2)}ms`);
		console.log(`Single Count: ${singleVideoIds?.length || 0}`);

		if (singleVideoIds?.length) {
			singleVideoIds.forEach((id) => requestIds.add(id));
		}

		// YouTube Data API 呼び出し
		const startApi = performance.now();
		const apiResult = await this.youtubeDataApi.getVideoInfosAsync(
			Array.from(requestIds),
			vtubers
		);
		const apiTime = performance.now() - startApi;
		// apiResult に IO 待ち時間が含まれるように後ほど修正
		const [response, startTimes, removedIds, apiIoWait = 0] = apiResult;
		totalIoWait += apiIoWait;

		// 削除されたデータをキャッシュから除外
		removedIds.forEach((rid) => {
			delete totalSchedules[rid];
		});

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
		const startSaveCache = performance.now();
		await this.youtubeRepository.saveSchedulesAsync(newCacheSchedules);
		const waitSaveCache = performance.now() - startSaveCache;
		totalIoWait += waitSaveCache;
		console.log(`[PERF] saveSchedulesAsync IO wait: ${waitSaveCache.toFixed(2)}ms`);

		// 公開用 JSON 生成
		const startSaveJson = performance.now();
		await this.saveDataJson(displaySchedules, currentDate);
		const waitSaveJson = performance.now() - startSaveJson;
		totalIoWait += waitSaveJson;
		console.log(`[PERF] saveDataJson IO wait: ${waitSaveJson.toFixed(2)}ms`);

		// 処理が成功したので、単体IDキャッシュを削除する
		const startDeleteNotices = performance.now();
		const responseKeys = new Set(Object.keys(response));
		const removedSet = new Set(removedIds);
		const deleteSingleVideoIds = (singleVideoIds || []).filter(
			(id) => removedSet.has(id) || responseKeys.has(id)
		);
		await this.youtubeNoticesCache.deleteListAsync(deleteSingleVideoIds);
		const waitDeleteNotices = performance.now() - startDeleteNotices;
		totalIoWait += waitDeleteNotices;
		console.log(`[PERF] deleteListAsync IO wait: ${waitDeleteNotices.toFixed(2)}ms`);

		const totalTime = performance.now() - startTotal;
		const pureCpuTime = totalTime - totalIoWait;
		console.log(`[PERF] updateSchedules TOTAL: ${totalTime.toFixed(2)}ms (IO Wait: ${totalIoWait.toFixed(2)}ms, Pure CPU: ${pureCpuTime.toFixed(2)}ms)`);
	}
}
