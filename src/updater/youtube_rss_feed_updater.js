import { YouTubeRSSFetcher } from "../api/youtube_rss_fetcher.js";
import { VTuberRepository } from "../repository/vtuber_repository.js";
import { DateTimeUtils } from "../datetime_utils.js";

// --- 設定 ---
export class YouTubeRssFeedUpdater {
	/**
	 * ステータス更新メインロジック
	 * @param {Object} env - Cloudflare Workersの環境変数 (KV, Durable Objects等)
	 */
	constructor(env)
	{
		// リポジトリクラスもJS版に移植されている前提です
		this.vtuberRepository = new VTuberRepository(env.DB);
		this.rssFeedTargetQueue = env.QUEUE_YOUTUBE_RSS_FEED_TARGET;

		// Durable Object のバインディング
		// env.YOUTUBE_NOTICES_CACHE は Durable Object Namespace
		const doId = env.YOUTUBE_NOTICES_CACHE.idFromName("rss-key-cache");
		this.youtubeNoticesCache = env.YOUTUBE_NOTICES_CACHE.get(doId);
	}

	async scheduleTrigger()
	{
		const vtubers = await this.vtuberRepository.loadMasterDataAsync();
		
		for (const vtuber of vtubers) {
			const streamerName = vtuber.Name;
			const channelIds = vtuber.YouTubeID || [];

			for (const channelId of channelIds) {
				if (!channelId)
					continue;
				await this.rssFeedTargetQueue.send(channelId);
				console.log(`${streamerName} / ${channelId}: enqueue`);
			}
		}
	}

	async fetchNewSchedulesByTargets(channelIds)
	{
		const lastUpdated = await this.vtuberRepository.loadChannelLastUpdatedAsync();

		const rssFetcher = new YouTubeRSSFetcher();
		
		const currentTime = DateTimeUtils.getCurrentTime();
		const currentDateIso = new Date(currentTime).toISOString();
		const [beforeTime, afterTime] = DateTimeUtils.getLimitTime(currentTime);

		for (const channelId of channelIds) {
		
			// 前回の更新日時を取得 (デフォルトは1970年)
			const lastUpdatedStr = lastUpdated[channelId] || "1970-01-01T00:00:00Z";
			const lastUpdatedTime = new Date(lastUpdatedStr).getTime();

			// RSS取得
			const videos = await rssFetcher.getVideoInfo(channelId);
			if (!videos || videos.length === 0)
				continue;

			// 動画IDをまとめる
			const videoIds = []

			for (const video of videos) {
				const videoId = video.video_id;
				const updatedTime = new Date(video.updated).getTime();

				// BEFORE_DAYS(1日)より古い動画はスキップ
				if (updatedTime < beforeTime) {
					continue;
				}

				// 前回更新日時(lastUpdatedDate)以下のものは飛ばす
				if (updatedTime <= lastUpdatedTime) {
					continue;
				}

				// 動画IDをキャッシュ（Durable Object）に追加
				videoIds.push(videoId);
			}

			// 動画IDをキャッシュ（Durable Object）に追加
			if (videoIds.length > 0) {
				await this.youtubeNoticesCache.bulkAddAsync(videoIds);

				// チャンネルごとの最終更新日時を記録（新着があった場合のみ）
				lastUpdated[channelId] = currentDateIso;
			}
		}

		// KV等へ最終更新日時を保存
		await this.vtuberRepository.saveChannelLastUpdatedAsync(lastUpdated);
	}
}