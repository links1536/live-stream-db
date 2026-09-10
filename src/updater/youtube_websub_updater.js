// updater/youtube_websub_updater.js

import { YouTubeWebSub } from "../api/youtube_websub.js";
import { VTuberRepository } from "../repository/vtuber_repository.js";
import { HttpUtils } from "../httputils.js";
import { WebhookStateRepository } from "../repository/webhook_state_repository.js";
import { Log } from "../log.js";
import { LOG_FLAGS } from "../constants/log_flags.js";

const WEBSUB_RENEWAL_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;

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
		this.webhookStateRepository = new WebhookStateRepository(env.DB);

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

				Log.rawInfo(LOG_FLAGS.YOUTUBE_WEBSUB_UPDATER, `${streamerName}: ${channelId} (${index} / ${vtuberCount}) enqueue`);

				// Queue にチャンネルIDを送信
				await this.youtubeWebsubQueue.send(channelId);
			}
		}

		Log.rawInfo(LOG_FLAGS.YOUTUBE_WEBSUB_UPDATER, `✅ WebSub registration enqueued for ${vtuberCount} VTubers`);
	}

	/**
	 * YouTube からの WebSub (PubSubHubbub) 通知を処理する
	 */
	async handleYoutubeWebhook(request)
	{
		// GET リクエスト（検証用）
		if (request.method === "GET") {
			const response = await this.youtubeWebsub.processGet(request);
			if (response.ok) {
				try {
					await this.saveSubscriptionVerificationAsync(request);
				}
				catch (e) {
					Log.rawError(`[WebSub] Failed to save subscription verification: ${e?.message ?? String(e)}`);
				}
			}
			return response;
		}

		// POST リクエスト（通知受信）
		const videoIds = await this.youtubeWebsub.processPost(request);
		if (videoIds == null)
			return HttpUtils.response(400, "Bad Request", { "Content-Type": "text/plain" });

		if (videoIds.length > 0) {
			for (const videoId of videoIds) {
				await this.youtubeNoticesCache.addAsync(videoId);
			}
			Log.rawInfo(LOG_FLAGS.YOUTUBE_WEBSUB_NEW_NOTIFICATION, `✅ Received ${videoIds.length} new video(s) from WebSub`);
		}

		// 成功レスポンス
		return HttpUtils.response(200, "", { "Content-Type": "text/plain" });
	}

	async saveSubscriptionVerificationAsync(request, nowMs = Date.now())
	{
		const { searchParams } = new URL(request.url);
		const mode = searchParams.get("hub.mode");
		const topic = searchParams.get("hub.topic");
		const channelId = new URL(topic).searchParams.get("channel_id");

		if (mode === "unsubscribe") {
			await this.webhookStateRepository.deleteTargetAsync("youtube", channelId);
			return;
		}

		const leaseSeconds = Number(searchParams.get("hub.lease_seconds"));
		const expiresAtMs = nowMs + leaseSeconds * 1000;
		if (!Number.isSafeInteger(leaseSeconds)
			|| leaseSeconds <= 0
			|| !Number.isFinite(expiresAtMs)
			|| Math.abs(expiresAtMs) > 8_640_000_000_000_000) {
			Log.rawWarning(`[WARN] [WebSub] Invalid lease seconds: channel_id=${channelId}, lease_seconds=${searchParams.get("hub.lease_seconds")}`);
			return;
		}

		const expiresAtIso = new Date(expiresAtMs).toISOString();
		await this.webhookStateRepository.upsertTargetAsync(
			"youtube",
			channelId,
			channelId,
			expiresAtIso
		);
	}

	async scheduleSubscriptionSyncAsync(nowMs = Date.now())
	{
		const youtubeMap = await this.vtuberRepository.loadYouTubeMapAsync();
		const desiredChannelIds = Object.keys(youtubeMap);
		const desiredSet = new Set(desiredChannelIds);
		const storedTargets = await this.webhookStateRepository.loadTargetsAsync("youtube");
		const storedByChannelId = new Map(storedTargets.map(target => [ target.target_key, target ]));
		const renewalThresholdMs = nowMs + WEBSUB_RENEWAL_THRESHOLD_MS;
		let subscribeCount = 0;

		for (const channelId of desiredChannelIds) {
			const expiresAtMs = Date.parse(storedByChannelId.get(channelId)?.expires_at_iso);
			if (Number.isFinite(expiresAtMs) && expiresAtMs > renewalThresholdMs)
				continue;

			subscribeCount++;
			const operation = {
				action: "subscribe",
				channel_id: channelId
			};
			const streamerName = youtubeMap[channelId]?.Name;
			if (streamerName)
				operation.streamer_name = streamerName;
			await this.youtubeWebsubQueue.send(JSON.stringify(operation));
		}

		let unsubscribeCount = 0;
		for (const target of storedTargets) {
			if (desiredSet.has(target.target_key))
				continue;
			unsubscribeCount++;
			await this.youtubeWebsubQueue.send(JSON.stringify({
				action: "unsubscribe",
				channel_id: target.target_key
			}));
		}

		return {
			subscribeCount,
			unsubscribeCount
		};
	}

	async processSubscriptionOperationAsync(action, channelId, callbackUrl, streamerName = null)
	{
		if (action !== "subscribe" && action !== "unsubscribe")
			return false;

		const subscriptionTargetLog = `action=${action}, channel_id=${channelId}`
			+ (streamerName ? `, streamer_name=${streamerName}` : "");
		Log.rawInfo(
			LOG_FLAGS.YOUTUBE_WEBSUB_SUBSCRIPTION_REQUEST,
			`[WebSub] Subscription request: ${subscriptionTargetLog}`
		);

		try {
			const success = action === "unsubscribe"
				? await this.youtubeWebsub.unregisterWebSub(callbackUrl, channelId)
				: await this.youtubeWebsub.registerWebSub(callbackUrl, channelId);
			if (!success) {
				Log.rawError(`[WebSub] Subscription failure: ${subscriptionTargetLog}`);
				return false;
			}

			if (action === "unsubscribe")
				await this.webhookStateRepository.deleteTargetAsync("youtube", channelId);
			else
				await this.webhookStateRepository.upsertTargetAsync("youtube", channelId, channelId);

			Log.rawInfo(
				LOG_FLAGS.YOUTUBE_WEBSUB_SUBSCRIPTION_SUCCESS,
				`[WebSub] Subscription success: ${subscriptionTargetLog}`
			);
			return true;
		}
		catch (e) {
			const errorMessage = e?.message ?? String(e);
			Log.rawError(`[WebSub] Subscription failure: ${subscriptionTargetLog}, error=${errorMessage}`);
			throw e;
		}
	}
}
