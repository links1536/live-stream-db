// entry.js
// Cloudflare Workers 用メインエントリポイント

import { YouTubeWebSubUpdater } from "./updater/youtube_websub_updater.js";
import { YouTubeRssFeedUpdater } from "./updater/youtube_rss_feed_updater.js";
import { YouTubeScheduleUpdater } from "./updater/youtube_schedule_updater.js";
import { TwitchStreamUpdater } from "./updater/twitch_stream_updater.js";
import { LivesJsonUpdater } from "./updater/lives_json_updater.js";
import { YouTubeWebSub } from "./api/youtube_websub.js";
import { AdminService } from "./admin_service.js";

// Durable Object のエクスポート（必須）
export { YouTubeNoticesCache } from "./repository/youtube_notices_cache.js";
export { StreamUpdateCoordinator } from "./repository/stream_update_coordinator.js";

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

async function initializeOutputRunAsync(env, sources)
{
	const doId = env.STREAM_UPDATE_COORDINATOR.idFromName("stream-update-coordinator");
	const outputCoordinator = env.STREAM_UPDATE_COORDINATOR.get(doId);
	const outputRunId = crypto.randomUUID();
	await outputCoordinator.initializeOutputRunAsync(outputRunId, sources);
	return { outputCoordinator, outputRunId };
}

async function completeOutputSourceAsync(env, outputRunId, source, dirty)
{
	if (!outputRunId)
		return false;

	const doId = env.STREAM_UPDATE_COORDINATOR.idFromName("stream-update-coordinator");
	const outputCoordinator = env.STREAM_UPDATE_COORDINATOR.get(doId);
	const completion = await outputCoordinator.completeOutputSourceAsync(outputRunId, source, dirty);
	return completion?.should_update === true;
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
					const { outputRunId } = await initializeOutputRunAsync(env, [ "youtube" ]);
					const updater = new YouTubeScheduleUpdater(env);
					await updater.scheduleTrigger(outputRunId);
					return new Response("Schedule update triggered");
				},
				"/twitch-update": async () => {
					const { outputRunId } = await initializeOutputRunAsync(env, [ "twitch" ]);
					const updater = new TwitchStreamUpdater(env);
					await updater.scheduleTrigger(outputRunId);
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
			const { outputRunId } = await initializeOutputRunAsync(env, [ "youtube", "twitch" ]);
			const youtubeUpdater = new YouTubeScheduleUpdater(env);
			await youtubeUpdater.scheduleTrigger(outputRunId);
			const twitchUpdater = new TwitchStreamUpdater(env);
			await twitchUpdater.scheduleTrigger(outputRunId);
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
				const scheduleLivesJsonUpdater = new LivesJsonUpdater(env);

				for (const msg of batch.messages) {
					const bodyText = msg.body?.trim();
					if (!bodyText)
						continue;

					const body = JSON.parse(bodyText);
					if (body.type !== "youtube_chunk" || !body.run_id || !Array.isArray(body.video_ids))
						continue;

					const dirty = await scheduleUpdater.updateSchedules(body.video_ids);
					const runState = await scheduleUpdater.streamUpdateCoordinator.completeRunItemAsync(body.run_id, dirty);
					if (runState?.is_last) {
						if (runState.dirty) {
							await scheduleUpdater.youtubeRepository.updateScheduleIdsAsync();
						}
						const shouldUpdateOutput = await completeOutputSourceAsync(env, runState.output_run_id, runState.source, runState.dirty);
						if (shouldUpdateOutput) {
							await scheduleLivesJsonUpdater.saveDataJsonAsync();
						}
					}
				}

				// 成功時は ack
				batch.ackAll();

				break;
			case env.QUEUE_NAME_TWITCH_STREAM_UPDATE:
				const twitchUpdater = new TwitchStreamUpdater(env);
				const livesJsonUpdater = new LivesJsonUpdater(env);

				for (const msg of batch.messages) {
					const bodyText = msg.body?.trim();
					if (!bodyText)
						continue;

					const body = JSON.parse(bodyText);
					if (body.type === "clear_all") {
						const dirty = await twitchUpdater.twitchStreamRepository.clearAllAsync();
						const shouldUpdateOutput = await completeOutputSourceAsync(env, body.output_run_id, "twitch", dirty);
						if (shouldUpdateOutput)
							await livesJsonUpdater.saveDataJsonAsync();
						continue;
					}

					if (body.type !== "user_update" || !body.user_login || !body.run_id)
						continue;

					const dirty = await twitchUpdater.updateStreamByUserLogin(body.user_login);
					const runState = await twitchUpdater.streamUpdateCoordinator.completeRunItemAsync(body.run_id, dirty);
					if (runState?.is_last) {
						const shouldUpdateOutput = await completeOutputSourceAsync(env, runState.output_run_id, runState.source, runState.dirty);
						if (shouldUpdateOutput)
							await livesJsonUpdater.saveDataJsonAsync();
					}
				}

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
