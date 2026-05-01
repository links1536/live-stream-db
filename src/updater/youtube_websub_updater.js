// updater/youtube_websub_updater.js

import { YouTubeWebSub } from "../api/youtube_websub.js";
import { VTuberRepository } from "../repository/vtuber_repository.js";
import { HttpUtils } from "../httputils.js";

export class YouTubeWebSubUpdater
{
	constructor(env)
	{
		this.vtuberRepository = new VTuberRepository(env.DB);
		this.youtubeWebsub = new YouTubeWebSub(
			env.YOUTUBE_WEBSUB_VERIFY_TOKEN,
			env.YOUTUBE_WEBSUB_SECRETS
		);
		this.youtubeWebsubQueue = env.QUEUE_YOUTUBE_WEBSUB_REGISTER;

		const doId = env.YOUTUBE_NOTICES_CACHE.idFromName("rss-key-cache");
		this.youtubeNoticesCache = env.YOUTUBE_NOTICES_CACHE.get(doId);
	}

	/**
	 * WebSub を登録する（Queue にチャンネルIDを送信）
	 */
	async registerWebsub(callbackUrl = null)
	{
		const vtubers = await this.vtuberRepository.loadMasterDataAsync();

		const vtuberCount = vtubers.length;
		let index = 0;

		for (const vtuber of vtubers) {
			index += 1;

			const streamerName = vtuber.Name || vtuber.get?.("Name") || "Unknown";
			const channelIds = vtuber.YouTubeID || vtuber.get?.("YouTubeID");

			if (!channelIds || channelIds.length === 0) {
				continue;
			}

			for (const channelId of channelIds) {
				if (!channelId)
					continue;

				console.log(`${streamerName}: ${channelId} (${index} / ${vtuberCount}) enqueue`);

				// Queue にチャンネルIDを送信
				await this.youtubeWebsubQueue.send(channelId);
			}
		}

		console.log(`✅ WebSub registration enqueued for ${vtuberCount} VTubers`);
	}

	/**
	 * YouTube からの WebSub (PubSubHubbub) 通知を処理する
	 */
	async handleYoutubeWebhook(request)
	{
		// GET リクエスト（検証用）
		if (request.method === "GET") {
			return await this.youtubeWebsub.processGet(request);
		}

		// POST リクエスト（通知受信）
		const videoIds = await this.youtubeWebsub.processPost(request);

		if (videoIds && videoIds.length > 0) {
			for (const videoId of videoIds) {
				await this.youtubeNoticesCache.addAsync(videoId);
			}
			console.log(`✅ Received ${videoIds.length} new video(s) from WebSub`);
		}

		// 成功レスポンス
		return HttpUtils.response(200, "", { "Content-Type": "text/plain" });
	}
}
