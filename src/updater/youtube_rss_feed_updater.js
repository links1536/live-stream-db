import { YouTubeRSSFetcher } from '../api/youtube_rss_fetcher.js';

// --- 設定 ---
const BEFORE_DAYS = 1;

export class YouTubeRssFeedUpdater {
	/**
	 * ステータス更新メインロジック
	 * @param {Object} env - Cloudflare Workersの環境変数 (KV, Durable Objects等)
	 */
	constructor(env)
	{
		// リポジトリクラスもJS版に移植されている前提です
		this.vtuberRepository = new VTuberRepository(env.KV_MASTER, env.KV_CACHE);

		// Durable Object のバインディング
		// env.YOUTUBE_NOTICES_CACHE は Durable Object Namespace
		const doId = env.YOUTUBE_NOTICES_CACHE.idFromName("rss-key-cache");
		this.youtubeNoticesCache = env.YOUTUBE_NOTICES_CACHE.get(doId);
	}

	/**
	 * RSSから新しいスケジュールを取得・キャッシュする
	 */
	async fetchNewSchedules()
	{
		const vtubers = await this.vtuberRepository.loadMasterDataAsync();
		const lastUpdated = await this.vtuberRepository.loadChannelLastUpdatedAsync();

		const currentDate = new Date();
		const rssFetcher = new YouTubeRSSFetcher();

		for (const vtuber of vtubers) {
			const streamerName = vtuber.Name;
			const channelIds = vtuber.YouTubeID || [];

			for (const channelId of channelIds) {
				if (!channelId)
					continue;

				// 前回の更新日時を取得 (デフォルトは1970年)
				const lastUpdatedStr = lastUpdated[channelId] || "1970-01-01T00:00:00Z";
				const lastUpdatedDate = new Date(lastUpdatedStr);

				// 15分以内の再取得はスキップ (15 * 60 * 1000 ms)
				if (currentDate.getTime() - lastUpdatedDate.getTime() < 15 * 60 * 1000) {
					continue;
				}

				// RSS取得
				const videos = await rssFetcher.getVideoInfo(channelId);
				if (!videos || videos.length === 0)
					continue;

				for (const video of videos) {
					const videoId = video.video_id;
					const updatedDate = new Date(video.updated);

					// BEFORE_DAYS(1日)より古い動画はスキップ
					const limitDate = new Date(currentDate.getTime() - BEFORE_DAYS * 24 * 60 * 60 * 1000);
					if (updatedDate < limitDate) {
						continue;
					}

					// 前回更新日時(lastUpdatedDate)以下のものは飛ばす
					if (updatedDate.getTime() <= lastUpdatedDate.getTime()) {
						continue;
					}

					// 動画IDをキャッシュ（Durable Object）に追加
					console.log(`${streamerName} / ${channelId}: video_id=${videoId} (${video.updated})`);
					await this.youtubeNoticesCache.add(videoId);
				}

				// チャンネルごとの最終更新日時を記録
				lastUpdated[channelId] = currentDate.toISOString();
			}
		}

		// KV等へ最終更新日時を保存
		await this.vtuberRepository.saveChannelLastUpdatedAsync(lastUpdated);
	}
}