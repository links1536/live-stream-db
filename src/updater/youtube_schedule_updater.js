// youtube_schedule_updater.js

import { YouTubeScheduleRepository } from "../repository/youtube_schedule_repository.js";
import { VTuberRepository } from "../repository/vtuber_repository.js";
import { YouTubeDataAPI } from "../api/youtube_data_api.js";
import { HttpUtils } from "../httputils.js";

// --- 設定 ---
const BEFORE_DAYS = 1;
const AFTER_DAYS = 7;
const OUTPUT_KEY = "lives.json";

export class YouTubeScheduleUpdater
{
	constructor(env)
	{
		this.youtubeRepository = new YouTubeScheduleRepository(env.DB);
		this.vtuberRepository = new VTuberRepository(env.DB);
		this.youtubeDataApi = new YouTubeDataAPI(env.YOUTUBE_DATA_API_KEY);

		const doId = env.YOUTUBE_NOTICES_CACHE.idFromName("rss-key-cache");
		this.youtubeNoticesCache = env.YOUTUBE_NOTICES_CACHE.get(doId);

		this.livesJsonStore = env.KV_OUTPUT;
	}

	async saveDataJson(currentDate)
	{
		// 期間外クリーンアップ用の現在時刻
		const msPerDay = 86400000;
		const startLimit = (currentDate - BEFORE_DAYS * msPerDay);
		const endLimit = (currentDate + AFTER_DAYS * msPerDay);

		// DBからアクティブな配信（表示期間内）のみを抽出
		const displaySchedules = await this.youtubeRepository.loadActiveSchedulesAsync(startLimit, endLimit);

		const publicData = {
			updated_at: new Date(currentDate).toISOString(),
			all_schedules: displaySchedules,
		};

		const publicDataStr = JSON.stringify(publicData);
		const newHash = await HttpUtils.digestHash(publicDataStr);

		// 前回のメタデータを取得してハッシュ比較
		const { metadata } = await this.livesJsonStore.getWithMetadata(OUTPUT_KEY);
		if (metadata?.dataHash === newHash) {
			console.log(`Schedules in ${OUTPUT_KEY} unchanged. Skip generating.`);
			return;
		}

		await this.livesJsonStore.put(OUTPUT_KEY, publicDataStr, {
			metadata: { dataHash: newHash }
		});
		console.log(`Generated ${OUTPUT_KEY} (${displaySchedules.length} streams)`);
	}

	async updateSchedules()
	{
		// マスター読み込み
		const youtubeIdMap = await this.vtuberRepository.loadYouTubeMapAsync();
		if (!youtubeIdMap || youtubeIdMap.length <= 0)
			return;

		// キャッシュ読み込み
		let totalSchedules = (await this.youtubeRepository.loadSchedulesAsync()) || {};

		// リクエスト対象ID
		const requestIds = new Set(Object.keys(totalSchedules));

		// 単体IDキャッシュ
		const singleVideoIds = await this.youtubeNoticesCache.getAll();

		if (singleVideoIds?.length) {
			for (const id of singleVideoIds) {
				requestIds.add(id);
			}
		}

		console.log(`Checking ${requestIds.size} video IDs...`);

		// YouTube Data API 呼び出し
		const apiResult = await this.youtubeDataApi.getVideoInfosAsync(
			Array.from(requestIds),
			youtubeIdMap
		);
		const [response, startTimes, removedIds] = apiResult;

		// 削除対象をDBから削除
		const ridList = Array.from(removedIds);
		if (ridList.length > 0) {
			await this.youtubeRepository.deleteSchedulesAsync(ridList);
		}

		// 最新データでDBを更新
		if (Object.keys(response).length > 0) {
			await this.youtubeRepository.saveSchedulesAsync(response);
		}

		// 期間外クリーンアップ
		const currentDate = new Date().getTime();
		const msPerDay = 86400000;
		const startLimitIso = new Date(currentDate - BEFORE_DAYS * msPerDay).toISOString();
		await this.youtubeRepository.cleanupOldSchedulesAsync(startLimitIso);

		console.log(`Update complete: ${Object.keys(response).length} active, ${ridList.length} removed.`);

		// 公開用 JSON 生成
		await this.saveDataJson(currentDate);

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
