// updater/youtube_websub_updater.js

import { YouTubeWebSub } from "../api/youtube_websub.js";
import { VTuberRepository } from "../repository/vtuber_repository.js";
import { YouTubeNoticesCache } from "../repository/youtube_notices_cache.js";

import { response } from "../http.js";

export class YouTubeWebSubUpdater
{
	constructor(env)
	{
		this.vtuber_repository = new VTuberRepository(env.KV_MASTER, env.KV_CACHE);
		this.youtube_websub = new YouTubeWebSub(
			env.YOUTUBE_WEBSUB_VERIFY_TOKEN,
			env.YOUTUBE_WEBSUB_SECRETS
		);
		this.youtube_websub_queue = env.RESISTER_YOUTUBE_WEBHOOK_IDS;

		const doId = env.YOUTUBE_NOTICES_CACHE.idFromName("rss-key-cache");
		this.youtube_notices_cache = env.YOUTUBE_NOTICES_CACHE.get(doId);
	}

	/**
	 * WebSub を登録する（Queue にチャンネルIDを送信）
	 */
	async register_websub(callbackUrl = null)
	{
		const vtubers = await this.vtuber_repository.load_master_data_async();

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
				await this.youtube_websub_queue.send(channelId);
			}
		}

		console.log(`✅ WebSub registration enqueued for ${vtuberCount} VTubers`);
	}

	/**
	 * YouTube からの WebSub (PubSubHubbub) 通知を処理する
	 */
	async handle_youtube_webhook(request)
	{
		// GET リクエスト（検証用）
		if (request.method === "GET") {
			return await this.youtube_websub.process_get(request);
		}

		// POST リクエスト（通知受信）
		const videoIds = await this.youtube_websub.process_post(request);

		if (videoIds && videoIds.length > 0) {
			for (const videoId of videoIds) {
				await this.youtube_notices_cache.add(videoId);
			}
			console.log(`✅ Received ${videoIds.length} new video(s) from WebSub`);
		}

		// 成功レスポンス
		return response("", {
			"Status": 200,
			"Content-Type": "text/plain",
		});
	}
}