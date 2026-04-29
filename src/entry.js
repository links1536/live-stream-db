// entry.js
// Cloudflare Workers 用メインエントリポイント

import { YouTubeWebSubUpdater } from "./updater/youtube_websub_updater.js";
import { YouTubeRssFeedUpdater } from "./updater/youtube_rss_feed_updater.js";
import { YouTubeScheduleUpdater } from "./updater/youtube_schedule_updater.js";
import { YouTubeWebSub } from "./api/youtube_websub.js";
import { AdminService } from "./admin_service.js";
import { Log } from "./log.js";

// Durable Object のエクスポート（必須）
export { YouTubeNoticesCache } from "./repository/youtube_notices_cache.js";

export default {
	/**
	 * HTTP リクエスト処理
	 */
	async fetch(request, env, ctx)
	{
		const url = new URL(request.url);
		const path = url.pathname;

		// favicon.ico は空レスポンス
		if (path === "/favicon.ico") {
			return new Response("");
		}

		// WebSub 受信エンドポイント
		if (path === "/webhooks/youtube") {
			const updater = new YouTubeWebSubUpdater(env);
			return await updater.handleYoutubeWebhook(request);
		}

		// 管理機能
		if (path.startsWith("/admin")) {
			// AdminService の認証ロジックを使用
			const authHeader = request.headers.get("Authorization");
			if (!authHeader || !AdminService.checkAuth(authHeader, env)) {
				return new Response("Unauthorized", {
					status: 401,
					headers: {
						"WWW-Authenticate": 'Basic realm="Admin Dashboard", charset="UTF-8"',
						"Content-Type": "text/plain; charset=utf-8"
					}
				});
			}

			// 管理画面
			if (path === "/admin") {
				return await AdminService.handleRequest(request, env);
			}

			// WebSub 登録（手動トリガー）
			if (path === "/admin/youtube-websub-resister") {
				const updater = new YouTubeWebSubUpdater(env);
				await updater.registerWebsub();
				return new Response("WebSub registration triggered");
			}

			// RSS フィード取得（手動トリガー）
			if (path === "/admin/youtube-fetch-rss") {
				const updater = new YouTubeRssFeedUpdater(env);
				await updater.scheduleTrigger();
				return new Response("RSS feed fetch triggered");
			}

			// スケジュール更新（手動トリガー）
			if (path === "/admin/youtube-update") {
				const updater = new YouTubeScheduleUpdater(env);
				await updater.updateSchedules();
				return new Response("Schedule update triggered");
			}
		}

		// 該当なしの場合
		return new Response("No matching route", { status: 404 });
	},

	/**
	 * Cron スケジュール処理
	 */
	async scheduled(controller, env, ctx)
	{
		if (controller.cron === "0 19 * * *") {
			// 毎日 UTC19:00 - WebSub 再登録
			const updater = new YouTubeWebSubUpdater(env);
			await updater.registerWebsub(env.YOUTUBE_WEBSUB_CALLBACK_URL);
			console.log("✅ WebSub registration completed (scheduled)");

		}
		else if (controller.cron === "45 * * * *") {
			// 毎時45分 - RSS フィード取得
			const updater = new YouTubeRssFeedUpdater(env);
			await updater.scheduleTrigger();
			console.log("✅ RSS feed fetch completed (scheduled)");
		}
		else {
			// その他（デフォルト） - スケジュール更新
			const updater = new YouTubeScheduleUpdater(env);
			await updater.scheduleTrigger();
			console.log("✅ Schedule update completed (scheduled)");
		}
	},

	/**
	 * Queue メッセージ処理
	 */
	async queue(batch, env, ctx)
	{
		console.log(`Processing queue: ${batch.queue}`);

		switch (batch.queue) {
			case env.QUEUE_NAME_YOUTUBE_WEBSUB_RESISTER:
				const youtube_websub = new YouTubeWebSub(
					env.YOUTUBE_WEBSUB_VERIFY_TOKEN,
					env.YOUTUBE_WEBSUB_SECRETS
				);
				for (const msg of batch.messages) {
					console.log(`Processing queue message: ${msg.body}`);
					
					try {
						await youtube_websub.registerWebSub(
							env.YOUTUBE_WEBSUB_CALLBACK_URL,
							msg.body
						);
						// 成功時は ack
						msg.ack();
					}
					catch (err) {
						console.error(`Failed to process message ${msg.body}:`, err);
						// 失敗時は retry
						msg.retry();
					}
				}
				break;
			case env.QUEUE_NAME_YOUTUBE_SCHDULE_UPDATE:
				const scheduleUpdater = new YouTubeScheduleUpdater(env);

				let updateLast = false;
				const videoIds = [];
				for (const msg of batch.messages) {
					const videoId = msg.body?.trim();
					if (!videoId)
						continue;

					updateLast = videoId === "update_last";
					if (updateLast == true)
						continue;

					Log.info("YouTubeScheduleUpdater", `Queue: ${videoId}`);
					videoIds.push(JSON.parse(videoId));
				}

				if (videoIds.length > 0) {
					Log.info("YouTubeScheduleUpdater", `UpdateSchedules: ${videoId}`);
					await scheduleUpdater.updateSchedules(videoIds);
					
					// 処理成功後に全ackを送信
					batch.ackAll();
					console.info(`[INFO] Processed ${videoIds.length} channels`);
				}

				if (updateLast)
				{
					await scheduleUpdater.updateSchedulesLast();
				}

				break;
			case env.QUEUE_NAME_YOUTUBE_RSS_FEED:
				const rssUpdater = new YouTubeRssFeedUpdater(env);

				const channelIds = [];
				for (const msg of batch.messages) {
					const channelId = msg.body?.trim();
					if (channelId)
						channelIds.push(channelId);
					else {
						console.warn("[WARN] Empty channel ID in queue message");
						msg.ack();
					}
				}

				if (channelIds.length > 0) {
					await rssUpdater.fetchNewSchedulesByTargets(channelIds);
					
					// 処理成功後に全ackを送信
					for (const msg of batch.messages) {
						msg.ack();
					}
					console.info(`[INFO] Processed ${channelIds.length} channels`);
				}
				break;
			default:
				console.error(`Unknown queue: ${batch.queue}`);
				break;
		}
	},
};