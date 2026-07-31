import { TwitchAPI } from "../api/twitch_api.js";
import { TwitchStreamRepository } from "../repository/twitch_stream_repository.js";
import { VTuberRepository } from "../repository/vtuber_repository.js";
import { WebhookStateRepository } from "../repository/webhook_state_repository.js";
import { LivesJsonUpdater } from "./lives_json_updater.js";
import { DateTimeUtils } from "../datetime_utils.js";
import { Log } from "../log.js";

const MESSAGE_MAX_AGE_MS = 10 * 60 * 1000;
const ARCHIVE_RETRY_DELAYS = [ 60, 240, 600 ];

export class TwitchEventSubUpdater
{
	constructor(env)
	{
		this.webhookSecret = env.TWITCH_EVENTSUB_SECRET;
		this.twitchApi = new TwitchAPI(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET);
		this.twitchStreamRepository = new TwitchStreamRepository(env.DB);
		this.vtuberRepository = new VTuberRepository(env.DB);
		this.webhookStateRepository = new WebhookStateRepository(env.DB);
		this.livesJsonUpdater = new LivesJsonUpdater(env);
		this.eventQueue = env.QUEUE_STREAM_UPDATE_TARGET;
	}

	async handleWebhookAsync(request)
	{
		if (!this.webhookSecret)
			return new Response("EventSub secret is not configured", { status: 503 });

		const messageId = request.headers.get("Twitch-Eventsub-Message-Id");
		const messageTimestamp = request.headers.get("Twitch-Eventsub-Message-Timestamp");
		const messageSignature = request.headers.get("Twitch-Eventsub-Message-Signature");
		const messageType = request.headers.get("Twitch-Eventsub-Message-Type");
		if (!messageId || !messageTimestamp || !messageSignature || !messageType)
			return new Response("Missing EventSub headers", { status: 400 });

		const timestampMs = new Date(messageTimestamp).getTime();
		if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MESSAGE_MAX_AGE_MS)
			return new Response("Expired EventSub message", { status: 403 });

		const rawBody = await request.text();
		if (!await this.verifySignatureAsync(messageId, messageTimestamp, rawBody, messageSignature))
			return new Response("Invalid EventSub signature", { status: 403 });

		let payload;
		try {
			payload = JSON.parse(rawBody);
		}
		catch {
			return new Response("Invalid JSON", { status: 400 });
		}

		if (messageType === "webhook_callback_verification") {
			if (typeof payload.challenge !== "string")
				return new Response("Missing challenge", { status: 400 });
			const length = new TextEncoder().encode(payload.challenge).byteLength;
			return new Response(payload.challenge, {
				status: 200,
				headers: {
					"Content-Type": "text/plain; charset=utf-8",
					"Content-Length": String(length)
				}
			});
		}

		if (messageType === "revocation") {
			Log.warning(
				"TwitchEventSubUpdater",
				`EventSub revoked: ${payload.subscription?.type ?? "unknown"} / ${payload.subscription?.status ?? "unknown"}`
			);
			return new Response(null, { status: 204 });
		}

		if (messageType !== "notification")
			return new Response("Unknown EventSub message type", { status: 400 });

		const subscriptionType = payload.subscription?.type;
		if (subscriptionType !== "stream.online" && subscriptionType !== "stream.offline")
			return new Response("Unsupported EventSub subscription", { status: 400 });
		if (!payload.event?.broadcaster_user_login)
			return new Response("Missing broadcaster", { status: 400 });

		await this.webhookStateRepository.saveMessageAsync(
			"twitch",
			messageId,
			JSON.stringify({
				subscription_type: subscriptionType,
				event: payload.event,
				message_timestamp: messageTimestamp
			}),
			messageTimestamp
		);
		await this.eventQueue.send(
			JSON.stringify({
				type: "twitch_eventsub_notification",
				message_id: messageId
			}),
			{ delaySeconds: 0 }
		);
		return new Response(null, { status: 204 });
	}

	async processStoredNotificationAsync(messageId)
	{
		const stored = await this.webhookStateRepository.loadMessageAsync("twitch", messageId);
		if (!stored || stored.processed_at_iso)
			return false;

		const payload = JSON.parse(stored.payload);
		let dirty = false;
		if (payload.subscription_type === "stream.online")
			dirty = await this.processOnlineAsync(payload.event);
		else if (payload.subscription_type === "stream.offline")
			dirty = await this.processOfflineAsync(payload.event, payload.message_timestamp);

		if (dirty)
			await this.livesJsonUpdater.saveDataJsonAsync();
		await this.webhookStateRepository.markMessageProcessedAsync("twitch", messageId);
		return dirty;
	}

	async processOnlineAsync(event)
	{
		const userLogin = event.broadcaster_user_login.toLowerCase();
		if (!await this.isRegisteredUserAsync(userLogin))
			return false;

		const streams = await this.twitchApi.getLiveStreamsAsync([userLogin]);
		const stream = streams?.find(item => item.twitch_id === String(event.id))
			?? streams?.[0]
			?? {
				twitch_id: String(event.id),
				source_stream_id: String(event.id),
				user_login: userLogin,
				title: null,
				thumbnail: "",
				start_time_iso: event.started_at ?? null,
				published_at_iso: null,
				url: `https://www.twitch.tv/${userLogin}`,
				status: "live",
				platform: "twitch"
			};

		const dirty = await this.twitchStreamRepository.upsertStreamAsync(stream);
		if (streams == null || streams.length === 0) {
			await this.eventQueue.send(
				JSON.stringify({
					type: "twitch_live_refresh",
					user_login: userLogin,
					stream_id: String(event.id)
				}),
				{ delaySeconds: 60 }
			);
		}
		return dirty;
	}

	async refreshLiveAsync(userLogin, streamId)
	{
		if (!await this.isRegisteredUserAsync(userLogin))
			return false;

		const streams = await this.twitchApi.getLiveStreamsAsync([userLogin]);
		if (streams == null)
			throw new Error(`Failed to refresh Twitch live stream: ${userLogin}`);

		const stream = streams.find(item => item.twitch_id === String(streamId));
		if (!stream)
			return false;

		const dirty = await this.twitchStreamRepository.upsertStreamAsync(stream);
		if (dirty)
			await this.livesJsonUpdater.saveDataJsonAsync();
		return dirty;
	}

	async processOfflineAsync(event, messageTimestamp)
	{
		const userLogin = event.broadcaster_user_login.toLowerCase();
		if (!await this.isRegisteredUserAsync(userLogin))
			return false;

		const deletion = await this.twitchStreamRepository.deleteLiveStreamsByUserLoginAsync(
			userLogin,
			messageTimestamp
		);
		let dirty = deletion.dirty;
		for (const stream of deletion.streams) {
			const sourceStreamId = stream.source_stream_id ?? stream.twitch_id;
			const archiveResult = await this.tryArchiveAsync(userLogin, sourceStreamId);
			dirty = dirty || archiveResult.dirty;
			if (!archiveResult.found)
				await this.enqueueArchiveRetryAsync(userLogin, sourceStreamId, 1);
		}
		return dirty;
	}

	async processArchiveRetryAsync(userLogin, sourceStreamId, attempt)
	{
		const archiveResult = await this.tryArchiveAsync(userLogin, sourceStreamId);
		if (archiveResult.dirty)
			await this.livesJsonUpdater.saveDataJsonAsync();
		if (!archiveResult.found && attempt < ARCHIVE_RETRY_DELAYS.length)
			await this.enqueueArchiveRetryAsync(userLogin, sourceStreamId, attempt + 1);
		return archiveResult.found;
	}

	async tryArchiveAsync(userLogin, sourceStreamId)
	{
		const existing = await this.twitchStreamRepository.loadStreamBySourceStreamIdAsync(
			sourceStreamId,
			"archived"
		);
		if (existing)
			return { found: true, dirty: false };

		const users = await this.twitchApi.getUsersAsync([userLogin]);
		if (users == null)
			return { found: false, dirty: false };
		if (users.length === 0)
			return { found: false, dirty: false };

		const currentDate = DateTimeUtils.getCurrentDate();
		const [startLimit] = DateTimeUtils.getLimitDate(currentDate);
		const archives = await this.twitchApi.getArchivedVideosAsync(users, startLimit.toISOString());
		if (archives == null)
			return { found: false, dirty: false };

		const archive = archives.find(item => item.source_stream_id === String(sourceStreamId));
		if (!archive)
			return { found: false, dirty: false };

		const dirty = await this.twitchStreamRepository.upsertStreamAsync(archive);
		return { found: true, dirty };
	}

	async enqueueArchiveRetryAsync(userLogin, sourceStreamId, attempt)
	{
		const delaySeconds = ARCHIVE_RETRY_DELAYS[attempt - 1];
		if (delaySeconds == null)
			return;

		await this.eventQueue.send(
			JSON.stringify({
				type: "twitch_archive_retry",
				user_login: userLogin,
				source_stream_id: sourceStreamId,
				attempt
			}),
			{ delaySeconds }
		);
	}

	async isRegisteredUserAsync(userLogin)
	{
		const twitchMap = await this.vtuberRepository.loadTwitchMapAsync();
		return Object.keys(twitchMap).some(key => key.toLowerCase() === userLogin.toLowerCase());
	}

	async verifySignatureAsync(messageId, messageTimestamp, rawBody, actualSignature)
	{
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey(
			"raw",
			encoder.encode(this.webhookSecret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"]
		);
		const signature = await crypto.subtle.sign(
			"HMAC",
			key,
			encoder.encode(`${messageId}${messageTimestamp}${rawBody}`)
		);
		const expectedSignature = "sha256=" + Array.from(new Uint8Array(signature))
			.map(byte => byte.toString(16).padStart(2, "0"))
			.join("");
		return this.signaturesMatch(actualSignature, expectedSignature);
	}

	signaturesMatch(actual, expected)
	{
		if (typeof actual !== "string" || typeof expected !== "string")
			return false;

		const actualBytes = new TextEncoder().encode(actual);
		const expectedBytes = new TextEncoder().encode(expected);
		const length = Math.max(actualBytes.length, expectedBytes.length);
		let difference = actualBytes.length ^ expectedBytes.length;
		for (let i = 0; i < length; i++)
			difference |= (actualBytes[i] ?? 0) ^ (expectedBytes[i] ?? 0);
		return difference === 0;
	}
}
