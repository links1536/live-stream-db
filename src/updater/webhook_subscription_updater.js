import { TwitchAPI } from "../api/twitch_api.js";
import { TwitCastingAPI } from "../api/twitcasting_api.js";
import { VTuberRepository } from "../repository/vtuber_repository.js";
import { WebhookStateRepository } from "../repository/webhook_state_repository.js";
import { YouTubeWebSubUpdater } from "./youtube_websub_updater.js";
import { Log } from "../log.js";

const TWITCH_EVENT_TYPES = [ "stream.online", "stream.offline" ];
const TWITCASTING_TARGET_REVALIDATION_MS = 30 * 24 * 60 * 60 * 1000;
const TWITCASTING_RESOLUTION_BATCH_SIZE = 5;
const TWITCASTING_RESOLUTION_BATCHES_PER_WINDOW = 2;
const TWITCASTING_RATE_LIMIT_WINDOW_SECONDS = 60;

function isReusableTwitCastingTarget(target, nowMs = Date.now())
{
	if (!target?.external_user_id || !target.updated_at_iso)
		return false;
	const updatedAtMs = Date.parse(target.updated_at_iso);
	return Number.isFinite(updatedAtMs)
		&& nowMs - updatedAtMs < TWITCASTING_TARGET_REVALIDATION_MS;
}

function addTwitCastingDesiredEvents(desired, userId)
{
	for (const event of TwitCastingAPI.WEBHOOK_EVENTS)
		desired.set(`${userId}:${event}`, { userId, event });
}

function groupTwitCastingEventsByUser(webhooks, predicate)
{
	const byUser = new Map();
	for (const webhook of webhooks) {
		const userId = String(webhook.user_id);
		if (!predicate(userId, webhook.event))
			continue;
		if (!byUser.has(userId))
			byUser.set(userId, []);
		byUser.get(userId).push(webhook.event);
	}
	return byUser;
}

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
		const desiredScreenIds = new Set(screenIds);
		const storedTargets = await this.webhookStateRepository.loadTargetsAsync("twitcasting");
		const storedByScreenId = new Map(storedTargets.map(target => [ target.target_key, target ]));
		const desired = new Map();
		const unresolvedScreenIds = [];
		for (const screenId of screenIds) {
			const target = storedByScreenId.get(screenId);
			if (!isReusableTwitCastingTarget(target)) {
				unresolvedScreenIds.push(screenId);
				continue;
			}
			addTwitCastingDesiredEvents(desired, String(target.external_user_id));
		}
		const resolutionComplete = unresolvedScreenIds.length === 0;

		for (let i = 0; i < unresolvedScreenIds.length; i += TWITCASTING_RESOLUTION_BATCH_SIZE) {
			const batchIndex = Math.floor(i / TWITCASTING_RESOLUTION_BATCH_SIZE);
			const delaySeconds = (Math.floor(batchIndex / TWITCASTING_RESOLUTION_BATCHES_PER_WINDOW) + 1)
				* TWITCASTING_RATE_LIMIT_WINDOW_SECONDS;
			await this.operationQueue.send(JSON.stringify({
				type: "twitcasting_user_resolve_batch",
				screen_ids: unresolvedScreenIds.slice(i, i + TWITCASTING_RESOLUTION_BATCH_SIZE)
			}), { delaySeconds });
		}

		const removedTargets = storedTargets.filter(target => !desiredScreenIds.has(target.target_key));
		const removedUserIds = new Set(removedTargets
			.map(target => target.external_user_id == null ? null : String(target.external_user_id))
			.filter(Boolean));

		const remote = new Set();
		const removeByUser = groupTwitCastingEventsByUser(remoteWebhooks, (userId, event) => {
			const key = `${userId}:${event}`;
			remote.add(key);
			return !desired.has(key) && (resolutionComplete || removedUserIds.has(userId));
		});

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

		for (const target of removedTargets)
			await this.webhookStateRepository.deleteTargetAsync("twitcasting", target.target_key);

		return {
			targetCount: desired.size / TwitCastingAPI.WEBHOOK_EVENTS.length,
			unresolvedCount: unresolvedScreenIds.length,
			resolutionBatchCount: Math.ceil(unresolvedScreenIds.length / TWITCASTING_RESOLUTION_BATCH_SIZE),
			registerCount: addByUser.size,
			removeCount: removeByUser.size,
			resolutionComplete
		};
	}

	async processTwitCastingUserResolutionAsync(screenIds)
	{
		const uniqueScreenIds = [...new Set(screenIds.filter(value => typeof value === "string" && value.length > 0))];
		if (uniqueScreenIds.length === 0)
			return { resolvedCount: 0, registerCount: 0, removeCount: 0 };
		if (uniqueScreenIds.length > TWITCASTING_RESOLUTION_BATCH_SIZE)
			throw new Error("TwitCasting user resolution batch is too large");

		const storedTargets = await this.webhookStateRepository.loadTargetsAsync("twitcasting");
		const storedByScreenId = new Map(storedTargets.map(target => [ target.target_key, target ]));
		const resolved = new Map();
		const previousUserIds = new Set();
		const failedScreenIds = [];

		for (const screenId of uniqueScreenIds) {
			const stored = storedByScreenId.get(screenId);
			if (isReusableTwitCastingTarget(stored)) {
				resolved.set(screenId, String(stored.external_user_id));
				continue;
			}

			const user = await this.twitcastingApi.getUserInfoAsync(screenId);
			if (!user?.id) {
				failedScreenIds.push(screenId);
				continue;
			}

			const userId = String(user.id);
			if (stored?.external_user_id != null && String(stored.external_user_id) !== userId)
				previousUserIds.add(String(stored.external_user_id));
			await this.webhookStateRepository.upsertTargetAsync("twitcasting", screenId, userId);
			resolved.set(screenId, userId);
		}

		const resolvedUserIds = new Set(resolved.values());
		const removeByUser = new Map();
		for (const userId of previousUserIds) {
			if (resolvedUserIds.has(userId))
				continue;
			const webhooks = await this.twitcastingApi.getWebhooksAsync(userId);
			if (webhooks == null)
				throw new Error(`Failed to load TwitCasting WebHooks for previous user: ${userId}`);
			if (webhooks.length > 0)
				removeByUser.set(userId, webhooks.map(webhook => webhook.event));
		}
		const addByUser = new Map();
		for (const userId of resolvedUserIds) {
			const webhooks = await this.twitcastingApi.getWebhooksAsync(userId);
			if (webhooks == null)
				throw new Error(`Failed to load TwitCasting WebHooks for resolved user: ${userId}`);
			const remoteEvents = new Set(webhooks.map(webhook => webhook.event));
			const missingEvents = TwitCastingAPI.WEBHOOK_EVENTS.filter(event => !remoteEvents.has(event));
			if (missingEvents.length > 0)
				addByUser.set(userId, missingEvents);
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
		if (failedScreenIds.length > 0)
			throw new Error(`TwitCasting user resolution failed: ${failedScreenIds.join(",")}`);

		return {
			resolvedCount: resolved.size,
			registerCount: addByUser.size,
			removeCount: removeByUser.size
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
