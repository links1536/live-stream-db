import { TwitchAPI } from "../api/twitch_api.js";
import { TwitCastingAPI } from "../api/twitcasting_api.js";
import { VTuberRepository } from "../repository/vtuber_repository.js";
import { WebhookStateRepository } from "../repository/webhook_state_repository.js";
import { YouTubeWebSubUpdater } from "./youtube_websub_updater.js";
import { Log } from "../log.js";

const TWITCH_EVENT_TYPES = [ "stream.online", "stream.offline" ];

export class WebhookSubscriptionUpdater
{
	constructor(env)
	{
		this.env = env;
		this.vtuberRepository = new VTuberRepository(env.DB);
		this.webhookStateRepository = new WebhookStateRepository(env.DB);
		this.twitchApi = new TwitchAPI(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET);
		this.twitcastingApi = new TwitCastingAPI(
			env.TWITCASTING_CLIENT_ID,
			env.TWITCASTING_CLIENT_SECRET
		);
		this.operationQueue = env.QUEUE_STREAM_UPDATE_TARGET;
	}

	async scheduleAllAsync()
	{
		const youtubeUpdater = new YouTubeWebSubUpdater(this.env);
		const run = async (platform, action) => {
			try {
				return await action();
			}
			catch (e) {
				Log.error("WebhookSubscriptionUpdater", `${platform} subscription sync failed: ${e.message}`);
				return { error: e.message };
			}
		};
		const youtube = await run("YouTube", () => youtubeUpdater.scheduleSubscriptionSyncAsync());
		const twitch = await run("Twitch", () => this.scheduleTwitchSyncAsync());
		const twitcasting = await run("TwitCasting", () => this.scheduleTwitCastingSyncAsync());
		await this.cleanupAsync();
		return { youtube, twitch, twitcasting };
	}

	async scheduleTwitchSyncAsync()
	{
		const callbackUrl = this.env.TWITCH_EVENTSUB_CALLBACK_URL;
		const secret = this.env.TWITCH_EVENTSUB_SECRET;
		let callback;
		try {
			callback = new URL(callbackUrl);
		}
		catch {
			throw new Error("Twitch EventSub callback URL is invalid");
		}
		if (callback.protocol !== "https:"
			|| (callback.port && callback.port !== "443")
			|| !secret
			|| secret.length < 10
			|| secret.length > 100
			|| !/^[\x20-\x7e]+$/.test(secret))
			throw new Error("Twitch EventSub callback URL or secret is not configured correctly");

		const twitchMap = await this.vtuberRepository.loadTwitchMapAsync();
		const userLogins = Object.keys(twitchMap);
		const users = await this.twitchApi.getUsersAsync(userLogins);
		if (users == null)
			throw new Error("Failed to resolve Twitch users");

		const remoteResult = await this.twitchApi.getEventSubSubscriptionsAsync();
		if (remoteResult == null)
			throw new Error("Failed to load Twitch EventSub subscriptions");

		const desired = new Map();
		for (const user of users) {
			await this.webhookStateRepository.upsertTargetAsync("twitch", user.login.toLowerCase(), String(user.id));
			for (const type of TWITCH_EVENT_TYPES)
				desired.set(`${type}:${user.id}`, { type, userId: String(user.id) });
		}

		const enabled = new Set();
		let deleteCount = 0;
		for (const subscription of remoteResult.subscriptions) {
			if (!TWITCH_EVENT_TYPES.includes(subscription.type))
				continue;
			if (subscription.transport?.method !== "webhook"
				|| subscription.transport?.callback !== callbackUrl)
				continue;

			const key = `${subscription.type}:${subscription.condition?.broadcaster_user_id}`;
			const usableStatus = subscription.status === "enabled"
				|| subscription.status === "webhook_callback_verification_pending";
			if (usableStatus && desired.has(key) && !enabled.has(key)) {
				enabled.add(key);
				continue;
			}
			if (!usableStatus && desired.has(key) && !enabled.has(key)) {
				enabled.add(key);
				deleteCount++;
				await this.operationQueue.send(JSON.stringify({
					type: "twitch_eventsub_replace",
					subscription_id: subscription.id,
					event_type: subscription.type,
					broadcaster_user_id: subscription.condition?.broadcaster_user_id
				}));
				continue;
			}

			deleteCount++;
			await this.operationQueue.send(JSON.stringify({
				type: "twitch_eventsub_delete",
				subscription_id: subscription.id
			}));
		}

		let createCount = 0;
		for (const [key, target] of desired) {
			if (enabled.has(key))
				continue;
			createCount++;
			await this.operationQueue.send(JSON.stringify({
				type: "twitch_eventsub_create",
				event_type: target.type,
				broadcaster_user_id: target.userId
			}));
		}

		const projectedCost = remoteResult.totalCost + createCount;
		if (remoteResult.maxTotalCost > 0 && projectedCost > remoteResult.maxTotalCost) {
			Log.warning(
				"WebhookSubscriptionUpdater",
				`Twitch EventSub projected cost ${projectedCost} exceeds ${remoteResult.maxTotalCost}; deletions will run before creations.`
			);
		}

		const desiredLogins = new Set(userLogins.map(value => value.toLowerCase()));
		for (const target of await this.webhookStateRepository.loadTargetsAsync("twitch")) {
			if (!desiredLogins.has(target.target_key.toLowerCase()))
				await this.webhookStateRepository.deleteTargetAsync("twitch", target.target_key);
		}

		return {
			targetCount: users.length,
			createCount,
			deleteCount,
			totalCost: remoteResult.totalCost,
			maxTotalCost: remoteResult.maxTotalCost
		};
	}

	async scheduleTwitCastingSyncAsync()
	{
		const remoteWebhooks = await this.twitcastingApi.getWebhooksAsync();
		if (remoteWebhooks == null)
			throw new Error("Failed to load TwitCasting WebHooks");

		const twitcastingMap = await this.vtuberRepository.loadTwitCastingMapAsync();
		const screenIds = Object.keys(twitcastingMap);
		const desired = new Map();
		let resolutionComplete = true;
		for (const screenId of screenIds) {
			const user = await this.twitcastingApi.getUserInfoAsync(screenId);
			if (!user?.id) {
				resolutionComplete = false;
				Log.warning("WebhookSubscriptionUpdater", `TwitCasting user resolution failed: ${screenId}`);
				continue;
			}
			await this.webhookStateRepository.upsertTargetAsync("twitcasting", screenId, String(user.id));
			for (const event of TwitCastingAPI.WEBHOOK_EVENTS)
				desired.set(`${user.id}:${event}`, { userId: String(user.id), event });
		}

		const remote = new Set();
		const removeByUser = new Map();
		for (const webhook of remoteWebhooks) {
			const key = `${webhook.user_id}:${webhook.event}`;
			remote.add(key);
			if (desired.has(key) || !resolutionComplete)
				continue;
			if (!removeByUser.has(String(webhook.user_id)))
				removeByUser.set(String(webhook.user_id), []);
			removeByUser.get(String(webhook.user_id)).push(webhook.event);
		}

		const addByUser = new Map();
		for (const [key, target] of desired) {
			if (remote.has(key))
				continue;
			if (!addByUser.has(target.userId))
				addByUser.set(target.userId, []);
			addByUser.get(target.userId).push(target.event);
		}

		for (const [userId, events] of removeByUser) {
			await this.operationQueue.send(JSON.stringify({
				type: "twitcasting_webhook_remove",
				user_id: userId,
				events
			}));
		}
		for (const [userId, events] of addByUser) {
			await this.operationQueue.send(JSON.stringify({
				type: "twitcasting_webhook_register",
				user_id: userId,
				events
			}));
		}

		if (resolutionComplete) {
			const desiredScreenIds = new Set(screenIds);
			for (const target of await this.webhookStateRepository.loadTargetsAsync("twitcasting")) {
				if (!desiredScreenIds.has(target.target_key))
					await this.webhookStateRepository.deleteTargetAsync("twitcasting", target.target_key);
			}
		}

		return {
			targetCount: desired.size / TwitCastingAPI.WEBHOOK_EVENTS.length,
			registerCount: addByUser.size,
			removeCount: removeByUser.size,
			resolutionComplete
		};
	}

	async processTwitchCreateAsync(eventType, broadcasterUserId)
	{
		return await this.twitchApi.createEventSubSubscriptionAsync(
			eventType,
			broadcasterUserId,
			this.env.TWITCH_EVENTSUB_CALLBACK_URL,
			this.env.TWITCH_EVENTSUB_SECRET
		);
	}

	async processTwitchDeleteAsync(subscriptionId)
	{
		return await this.twitchApi.deleteEventSubSubscriptionAsync(subscriptionId);
	}

	async processTwitchReplaceAsync(subscriptionId, eventType, broadcasterUserId)
	{
		const deleted = await this.processTwitchDeleteAsync(subscriptionId);
		if (!deleted)
			return false;
		return await this.processTwitchCreateAsync(eventType, broadcasterUserId);
	}

	async processTwitCastingRegisterAsync(userId, events)
	{
		return await this.twitcastingApi.registerWebhookAsync(userId, events);
	}

	async processTwitCastingRemoveAsync(userId, events)
	{
		return await this.twitcastingApi.removeWebhookAsync(userId, events);
	}

	async cleanupAsync()
	{
		const before = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
		await this.webhookStateRepository.cleanupMessagesAsync(before);
	}
}
