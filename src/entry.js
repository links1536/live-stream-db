// entry.js
// Cloudflare Workers 用メインエントリポイント

import { YouTubeWebSubUpdater } from "./updater/youtube_websub_updater.js";
import { YouTubeRssFeedUpdater } from "./updater/youtube_rss_feed_updater.js";
import { YouTubeScheduleUpdater } from "./updater/youtube_schedule_updater.js";
import { TwitchStreamUpdater } from "./updater/twitch_stream_updater.js";
import { LivesJsonUpdater } from "./updater/lives_json_updater.js";
import { YouTubeWebSub } from "./api/youtube_websub.js";
import { AdminService } from "./admin_service.js";
import { Log } from "./log.js";

// Durable Object のエクスポート（必須）
export { YouTubeNoticesCache } from "./repository/youtube_notices_cache.js";

function methodNotAllowed(allow)
{
	return new Response("Method Not Allowed", {
		status: 405,
		headers: {
			"Allow": allow,
			"Content-Type": "text/plain; charset=utf-8"
		}
	});
}

async function runTwitchUpdate(env)
{
	const twitchUpdater = new TwitchStreamUpdater(env);
	await twitchUpdater.updateStreamsAsync();
	const livesJsonUpdater = new LivesJsonUpdater(env);
	await livesJsonUpdater.saveDataJsonAsync();
}

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
			const adminPath = path.slice("/admin".length) || "/";
			const adminPostHandlers = {
				"/youtube-websub-register": async () => {
					const updater = new YouTubeWebSubUpdater(env);
					await updater.registerWebsub();
					return new Response("WebSub registration triggered");
				},
				"/youtube-fetch-rss": async () => {
					const updater = new YouTubeRssFeedUpdater(env);
					await updater.scheduleTrigger();
					return new Response("RSS feed fetch triggered");
				},
				"/youtube-update": async () => {
					const updater = new YouTubeScheduleUpdater(env);
					await updater.scheduleTrigger();
					return new Response("Schedule update triggered");
				},
				"/twitch-update": async () => {
					await runTwitchUpdate(env);
					return new Response("Twitch update triggered");
				}
			};

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

			if (adminPath === "/")
				return request.method === "GET"
					? await AdminService.handleRequest(request, env)
					: methodNotAllowed("GET");

			const adminPostHandler = adminPostHandlers[adminPath];
			if (adminPostHandler) {
				if (request.method !== "POST")
					return methodNotAllowed("POST");
				return await adminPostHandler();
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
			case env.QUEUE_NAME_YOUTUBE_WEBSUB_REGISTER:
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
			case env.QUEUE_NAME_YOUTUBE_SCHEDULE_UPDATE:
				const scheduleUpdater = new YouTubeScheduleUpdater(env);

				let updateLast = false;
				for (const msg of batch.messages) {
					const bodyText = msg.body?.trim();
					if (!bodyText)
						continue;

					updateLast = bodyText === "update_last";
					if (updateLast == true)
						continue;

					await scheduleUpdater.updateSchedules(JSON.parse(bodyText));

				}

				if (updateLast)
				{
					await scheduleUpdater.updateSchedulesLast();
					const twitchUpdater = new TwitchStreamUpdater(env);
					await twitchUpdater.updateStreamsAsync();
					const livesJsonUpdater = new LivesJsonUpdater(env);
					await livesJsonUpdater.saveDataJsonAsync();
				}

				// 成功時は ack
				batch.ackAll();

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
