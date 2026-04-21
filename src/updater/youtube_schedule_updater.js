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

	/**
	 * start_times から開始時刻（ms timestamp）を取得
	 * Python の get_video_start_time と同等
	 */
	getVideoStartTime(videoData, startTimes)
	{
		const videoId = videoData?.video_id;
		if (!videoId)
			return null;
		return startTimes?.[videoId];
	}

	isWithinCachePeriod(videoData, startTimes, startLimit)
	{
		const startTime = this.getVideoStartTime(videoData, startTimes);
		if (!startTime)
			return true;
		return startLimit <= startTime;
	}

	isWithinDisplayPeriod(videoData, startTimes, startLimit, endLimit)
	{
		const startTime = this.getVideoStartTime(videoData, startTimes);
		if (!startTime)
			return false;
		console.log(`[Display] ${videoData?.video_id} ${startTime}`)
		return startLimit <= startTime && startTime <= endLimit;
	}


	async saveDataJson(schedules, startTimes, currentDate, startLimit, endLimit)
	{
		// 開始時間がある + 表示期間内のものだけ
		const validSchedules = [];
		for (const [id, video] of Object.entries(schedules)) {
			if (this.isWithinDisplayPeriod(video, startTimes, startLimit, endLimit)) {
				validSchedules.push(video);
			}
		}

		// 開始時間でソート
		const sortedSchedules = validSchedules.toSorted
			? validSchedules.toSorted((a, b) => new Date(a.start_time_iso) - new Date(b.start_time_iso))
			: [...validSchedules].sort((a, b) => new Date(a.start_time_iso) - new Date(b.start_time_iso));

		const publicData = {
			updated_at: currentDate.toISOString(),
			all_schedules: sortedSchedules,
		};

		await this.livesJsonStore.put(OUTPUT_KEY, JSON.stringify(publicData));
		console.log(`Generated ${OUTPUT_KEY} (${validSchedules.length} streams)`);
	}

	async updateSchedules()
	{
		// マスター読み込み
		const vtubers = await this.vtuberRepository.loadMasterDataAsync();

		// キャッシュ読み込み
		let totalSchedules = (await this.youtubeRepository.loadSchedulesAsync()) || {};

		// リクエスト対象ID
		let requestIds = new Set(Object.keys(totalSchedules));

		// 単体IDキャッシュ
		const singleVideoIds = await this.youtubeNoticesCache.getAll();
		console.log(`Single Count: ${singleVideoIds?.length || 0}`);

		if (singleVideoIds?.length) {
			singleVideoIds.forEach((id) => requestIds.add(id));
		}

		// YouTube Data API 呼び出し
		const apiResult = await this.youtubeDataApi.getVideoInfosAsync(
			Array.from(requestIds),
			vtubers
		);

		const { response = {}, startTimes = {}, removedIds = [] } = Array.isArray(apiResult)
			? { response: apiResult[0] || {}, startTimes: apiResult[1] || {}, removedIds: apiResult[2] || [] }
			: apiResult || {};

		// 削除されたデータをキャッシュから除外
		removedIds.forEach((rid) => {
			delete totalSchedules[rid];
		});

		// 最新データで上書き
		Object.assign(totalSchedules, response);

		// 期間外クリーンアップ用の現在時刻
		const currentDate = new Date();
		const msPerDay = 86400000; // 24 * 60 * 60 * 1000
		const startLimit = currentDate.getTime() - BEFORE_DAYS * msPerDay;
		const endLimit = currentDate.getTime() + AFTER_DAYS * msPerDay;

		// 期間外（古すぎる）データを削除 → 残すのは startLimit 以降のもの
		const newSchedules = {};
		for (const [id, video] of Object.entries(totalSchedules)) {
			if (this.isWithinCachePeriod(video, startTimes, startLimit)) {
				newSchedules[id] = video;
			}
		}

		// キャッシュ保存
		await this.youtubeRepository.saveSchedulesAsync(newSchedules);

		// 公開用 JSON 生成
		await this.saveDataJson(newSchedules, startTimes, currentDate, startLimit, endLimit);

		// 単体IDキャッシュのクリーンアップ
		const responseKeys = new Set(Object.keys(response));
		const removedSet = new Set(removedIds);
		const deleteSingleVideoIds = (singleVideoIds || []).filter(
			(id) => removedSet.has(id) || responseKeys.has(id)
		);
		//await this.youtubeNoticesCache.deleteListAsync(deleteSingleVideoIds);
	}
}