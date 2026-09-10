// entry.js
// Cloudflare Workers 用メインエントリポイント

import { YouTubeWebSubUpdater } from "./updater/youtube_websub_updater.js";
import { YouTubeRssFeedUpdater } from "./updater/youtube_rss_feed_updater.js";
import { YouTubeScheduleUpdater } from "./updater/youtube_schedule_updater.js";
import { TwitchStreamUpdater } from "./updater/twitch_stream_updater.js";
import { TwitCastingStreamUpdater } from "./updater/twitcasting_stream_updater.js";
import { TwitCastingWebhookUpdater } from "./updater/twitcasting_webhook_updater.js";
import { TwitchEventSubUpdater } from "./updater/twitch_eventsub_updater.js";
import { WebhookSubscriptionUpdater } from "./updater/webhook_subscription_updater.js";
import { LivesJsonUpdater } from "./updater/lives_json_updater.js";
import { AdminService } from "./admin_service.js";
import { Log } from "./log.js";
import { LOG_FLAGS } from "./constants/log_flags.js";

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

async function enqueueLivesJsonUpdateAsync(env, outputRunId, source, dirty)
{
	if (!outputRunId)
		return false;
	const doId = env.STREAM_UPDATE_COORDINATOR.idFromName("stream-update-coordinator");
	const outputCoordinator = env.STREAM_UPDATE_COORDINATOR.get(doId);
	const completion = await outputCoordinator.completeOutputSourceAsync(outputRunId, source, dirty);
	if (completion == null)
		return false;

	if (completion.should_update) {
		await env.QUEUE_STREAM_UPDATE_TARGET.send(JSON.stringify({
			type: "lives_json_update",
			output_run_id: outputRunId,
			source,
			dirty
		}));
	}
	if (completion.is_last)
		await outputCoordinator.finalizeOutputRunAsync(outputRunId);
	return completion.should_update;
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

		if (path === "/webhooks/twitcasting") {
			if (request.method !== "POST")
				return methodNotAllowed("POST");
			const updater = new TwitCastingWebhookUpdater(env);
			return await updater.handleWebhookAsync(request);
		}

		if (path === "/webhooks/twitch") {
			if (request.method !== "POST")
				return methodNotAllowed("POST");
			const updater = new TwitchEventSubUpdater(env);
			return await updater.handleWebhookAsync(request);
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
				"/youtube-websub-register-missing": async () => {
					const updater = new YouTubeWebSubUpdater(env);
					const result = await updater.registerMissingWebsubAsync();
					return Response.json(result);
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
					return new Response("Triggered YouTube schedule update");
				},
				"/twitch-update": async () => {
					const { outputRunId } = await initializeOutputRunAsync(env, [ "twitch" ]);
					const updater = new TwitchStreamUpdater(env);
					await updater.scheduleTrigger(outputRunId);
					return new Response("Triggered Twitch stream update");
				},
				"/twitcasting-update": async () => {
					const { outputRunId } = await initializeOutputRunAsync(env, [ "twitcasting" ]);
					const updater = new TwitCastingStreamUpdater(env);
					await updater.scheduleTrigger(outputRunId);
					return new Response("Triggered TwitCasting stream update");
				},
				"/twitcasting-webhook-register": async () => {
					const updater = new TwitCastingWebhookUpdater(env);
					const result = await updater.registerAllAsync();
					return Response.json(result);
				},
				"/webhook-subscriptions-sync": async () => {
					const updater = new WebhookSubscriptionUpdater(env);
					const result = await updater.scheduleAllAsync();
					return Response.json(result);
				},
				"/full-update": async () => {
					const { outputRunId } = await initializeOutputRunAsync(env, [ "youtube", "twitch", "twitcasting" ]);
					const youtubeUpdater = new YouTubeScheduleUpdater(env);
					await youtubeUpdater.scheduleTrigger(outputRunId);
					const twitchUpdater = new TwitchStreamUpdater(env);
					await twitchUpdater.scheduleTrigger(outputRunId);
					const twitcastingUpdater = new TwitCastingStreamUpdater(env);
					await twitcastingUpdater.scheduleTrigger(outputRunId);
					return new Response("Triggered full stream update");
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

			if (adminPath === "/lives.json")
				return request.method === "GET"
					? await AdminService.downloadLivesJsonAsync(env)
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
		if (controller.cron === "30 23 * * *") {
			// 毎日 UTC23:30 - 全プラットフォームの通知購読同期
			const updater = new WebhookSubscriptionUpdater(env);
			await updater.scheduleAllAsync();
			Log.rawInfo(LOG_FLAGS.ENTRY, "✅ Webhook subscription synchronization completed (scheduled)");
		}
		else if (controller.cron === "45 23 * * *") {
			// 毎日 UTC23:45 - Twitch / TwitCasting の通知漏れを整合
			const { outputRunId } = await initializeOutputRunAsync(env, [ "twitch", "twitcasting" ]);
			const twitchUpdater = new TwitchStreamUpdater(env);
			await twitchUpdater.scheduleTrigger(outputRunId);
			const twitcastingUpdater = new TwitCastingStreamUpdater(env);
			await twitcastingUpdater.scheduleTrigger(outputRunId);
			Log.rawInfo(LOG_FLAGS.ENTRY, "✅ Twitch / TwitCasting reconciliation triggered (scheduled)");
		}
		else if (controller.cron === "45 * * * *") {
			// 毎時45分 - RSS フィード取得
			const updater = new YouTubeRssFeedUpdater(env);
			await updater.scheduleTrigger();
			Log.rawInfo(LOG_FLAGS.ENTRY, "✅ RSS feed fetch completed (scheduled)");
		}
		else if (controller.cron === "*/5 * * * *") {
			// 5分ごと - YouTube のスケジュール更新
			const { outputRunId } = await initializeOutputRunAsync(env, [ "youtube" ]);
			const youtubeUpdater = new YouTubeScheduleUpdater(env);
			await youtubeUpdater.scheduleTrigger(outputRunId);
			Log.rawInfo(LOG_FLAGS.ENTRY, "✅ YouTube schedule update completed (scheduled)");
		}
		else {
			Log.rawWarning(`[WARN] Unknown cron trigger: ${controller.cron}`);
		}
	},

	/**
	 * Queue メッセージ処理
	 */
	async queue(batch, env, ctx)
	{
		Log.rawInfo(LOG_FLAGS.ENTRY, `Processing queue: ${batch.queue}`);

		switch (batch.queue) {
			case env.QUEUE_NAME_YOUTUBE_WEBSUB_REGISTER:
				const youtubeWebSubUpdater = new YouTubeWebSubUpdater(env);
				for (const msg of batch.messages) {
					Log.rawInfo(LOG_FLAGS.ENTRY, `Processing queue message: ${msg.body}`);
					
					try {
						let action = "subscribe";
						let channelId = msg.body;
						let streamerName = null;
						try {
							const operation = JSON.parse(msg.body);
							action = operation.action ?? action;
							channelId = operation.channel_id;
							streamerName = operation.streamer_name ?? null;
						}
						catch {
							// 旧形式のチャンネルID文字列も引き続き処理する
						}
						if (!channelId)
							throw new Error("Missing YouTube channel ID");
						const success = await youtubeWebSubUpdater.processSubscriptionOperationAsync(
							action,
							channelId,
							env.YOUTUBE_WEBSUB_CALLBACK_URL,
							streamerName
						);
						if (!success)
							throw new Error(`YouTube WebSub ${action} failed: ${channelId}`);
						// 成功時は ack
						msg.ack();
					}
					catch (err) {
						Log.rawError(`Failed to process message ${msg.body}:`, err);
						// 一括登録時に同じ失敗要因へリクエストを繰り返さない
						msg.ack();
					}
				}
				break;
			case env.QUEUE_NAME_STREAM_UPDATE:
				for (const msg of batch.messages) {
					const bodyText = msg.body?.trim();
					if (!bodyText)
						continue;

					const body = JSON.parse(bodyText);

					// YouTubeのスケジュール更新
					if (body.type === "youtube_video_batch_update") {
						if (!body.run_id || !Array.isArray(body.video_ids))
							continue;

						const scheduleUpdater = new YouTubeScheduleUpdater(env);
						const dirty = await scheduleUpdater.updateSchedules(body.video_ids);
						const runState = await scheduleUpdater.streamUpdateCoordinator.completeRunItemAsync(body.run_id, msg.id, dirty);
						if (!runState?.is_last)
							continue;

						if (runState.dirty) {
							await scheduleUpdater.youtubeRepository.updateScheduleIdsAsync();
						}
						await enqueueLivesJsonUpdateAsync(env, runState.output_run_id, runState.source, runState.dirty);
						await scheduleUpdater.streamUpdateCoordinator.finalizeRunAsync(body.run_id);
						continue;
					}

					// Twitchのスケジュール更新
					if (body.type === "twitch_user_batch_update") {
						if (!Array.isArray(body.user_logins) || !body.run_id)
							continue;

						const twitchUpdater = new TwitchStreamUpdater(env);
						const dirty = await twitchUpdater.updateStreamsByUserLogins(body.user_logins);
						const runState = await twitchUpdater.streamUpdateCoordinator.completeRunItemAsync(body.run_id, msg.id, dirty);
						if (runState?.is_last) {
							await enqueueLivesJsonUpdateAsync(env, runState.output_run_id, runState.source, runState.dirty);
							await twitchUpdater.streamUpdateCoordinator.finalizeRunAsync(body.run_id);
						}
						continue;
					}

					if (body.type === "twitch_eventsub_notification") {
						if (!body.message_id)
							continue;
						const updater = new TwitchEventSubUpdater(env);
						await updater.processStoredNotificationAsync(body.message_id);
						continue;
					}

					if (body.type === "twitch_live_refresh") {
						if (!body.user_login || !body.stream_id)
							continue;
						const updater = new TwitchEventSubUpdater(env);
						await updater.refreshLiveAsync(body.user_login, body.stream_id);
						continue;
					}

					if (body.type === "twitch_archive_retry") {
						if (!body.user_login || !body.source_stream_id || !body.attempt)
							continue;
						const updater = new TwitchEventSubUpdater(env);
						await updater.processArchiveRetryAsync(
							body.user_login,
							body.source_stream_id,
							body.attempt
						);
						continue;
					}

					if (body.type === "twitch_eventsub_create") {
						const updater = new WebhookSubscriptionUpdater(env);
						const success = await updater.processTwitchCreateAsync(
							body.event_type,
							body.broadcaster_user_id
						);
						if (!success)
							throw new Error("Twitch EventSub creation failed");
						continue;
					}

					if (body.type === "twitch_eventsub_delete") {
						const updater = new WebhookSubscriptionUpdater(env);
						const success = await updater.processTwitchDeleteAsync(body.subscription_id);
						if (!success)
							throw new Error("Twitch EventSub deletion failed");
						continue;
					}

					if (body.type === "twitch_eventsub_replace") {
						const updater = new WebhookSubscriptionUpdater(env);
						const success = await updater.processTwitchReplaceAsync(
							body.subscription_id,
							body.event_type,
							body.broadcaster_user_id
						);
						if (!success)
							throw new Error("Twitch EventSub replacement failed");
						continue;
					}

					if (body.type === "twitcasting_webhook_register") {
						const updater = new WebhookSubscriptionUpdater(env);
						const success = await updater.processTwitCastingRegisterAsync(body.user_id, body.events);
						if (!success)
							throw new Error("TwitCasting WebHook registration failed");
						continue;
					}

					if (body.type === "twitcasting_user_resolve_batch") {
						if (!Array.isArray(body.screen_ids) || body.screen_ids.length === 0)
							continue;
						const updater = new WebhookSubscriptionUpdater(env);
						await updater.processTwitCastingUserResolutionAsync(body.screen_ids);
						continue;
					}

					if (body.type === "twitcasting_webhook_remove") {
						const updater = new WebhookSubscriptionUpdater(env);
						const success = await updater.processTwitCastingRemoveAsync(body.user_id, body.events);
						if (!success)
							throw new Error("TwitCasting WebHook removal failed");
						continue;
					}

					if (body.type === "stream_source_complete") {
						await enqueueLivesJsonUpdateAsync(env, body.output_run_id, body.source, body.dirty === true);
						continue;
					}

					// Twitchの配信をすべて削除
					if (body.type === "twitch_clear_all") {
						const twitchUpdater = new TwitchStreamUpdater(env);
						const dirty = await twitchUpdater.twitchStreamRepository.clearAllAsync();
						await enqueueLivesJsonUpdateAsync(env, body.output_run_id, "twitch", dirty);
						continue;
					}

					// TwitCastingの配信更新
					if (body.type === "twitcasting_user_batch_update") {
						if (!Array.isArray(body.screen_ids) || !body.run_id)
							continue;

						const twitcastingUpdater = new TwitCastingStreamUpdater(env);
						const dirty = await twitcastingUpdater.updateStreamsByScreenIds(body.screen_ids);
						const runState = await twitcastingUpdater.streamUpdateCoordinator.completeRunItemAsync(body.run_id, msg.id, dirty);
						if (runState?.is_last) {
							await enqueueLivesJsonUpdateAsync(env, runState.output_run_id, runState.source, runState.dirty);
							await twitcastingUpdater.streamUpdateCoordinator.finalizeRunAsync(body.run_id);
						}
						continue;
					}

					// TwitCastingの配信をすべて削除
					if (body.type === "twitcasting_clear_all") {
						const twitcastingUpdater = new TwitCastingStreamUpdater(env);
						const dirty = await twitcastingUpdater.twitcastingStreamRepository.clearAllAsync();
						await enqueueLivesJsonUpdateAsync(env, body.output_run_id, "twitcasting", dirty);
						continue;
					}

					// lives.jsonを更新
					if (body.type === "lives_json_update") {
						const livesJsonUpdater = new LivesJsonUpdater(env);
						await livesJsonUpdater.saveDataJsonAsync();
						continue;
					}

					Log.rawWarning(`[WARN] Unknown stream update message type: ${body.type}`);
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
						Log.rawWarning("[WARN] Empty channel ID in queue message");
						msg.ack();
					}
				}

				if (channelIds.length > 0) {
					await rssUpdater.fetchNewSchedulesByTargets(channelIds);
					
					// 処理成功後に全ackを送信
					for (const msg of batch.messages) {
						msg.ack();
					}
					Log.rawInfo(LOG_FLAGS.ENTRY, `[INFO] Processed ${channelIds.length} channels`);
				}
				break;
			default:
				Log.rawError(`Unknown queue: ${batch.queue}`);
				break;
		}
	},
};
