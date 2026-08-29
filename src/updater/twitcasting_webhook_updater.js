import { TwitCastingAPI } from "../api/twitcasting_api.js";
import { TwitCastingStreamRepository } from "../repository/twitcasting_stream_repository.js";
import { VTuberRepository } from "../repository/vtuber_repository.js";
import { LivesJsonUpdater } from "./lives_json_updater.js";
import { Log } from "../log.js";

export class TwitCastingWebhookUpdater
{
	constructor(env)
	{
		this.webhookSignature = env.TWITCASTING_WEBHOOK_SIGNATURE;
		this.twitcastingApi = new TwitCastingAPI(
			env.TWITCASTING_CLIENT_ID,
			env.TWITCASTING_CLIENT_SECRET
		);
		this.twitcastingStreamRepository = new TwitCastingStreamRepository(env.DB);
		this.vtuberRepository = new VTuberRepository(env.DB);
		this.livesJsonUpdater = new LivesJsonUpdater(env);
	}

	async registerAllAsync()
	{
		const twitcastingMap = await this.vtuberRepository.loadTwitCastingMapAsync();
		const screenIds = Object.keys(twitcastingMap);
		let registeredCount = 0;
		let failedCount = 0;

		for (const screenId of screenIds) {
			try {
				const user = await this.twitcastingApi.getUserInfoAsync(screenId);
				if (!user?.id) {
					failedCount += 1;
					continue;
				}

				const registered = await this.twitcastingApi.registerWebhookAsync(
					user.id,
					TwitCastingAPI.WEBHOOK_EVENTS
				);
				if (registered)
					registeredCount += 1;
				else
					failedCount += 1;
			}
			catch (e) {
				failedCount += 1;
				Log.error("TwitCastingWebhookUpdater", `WebHook registration failed (${screenId}): ${e.message}`);
			}
		}

		Log.info(
			"TwitCastingWebhookUpdater",
			`WebHook registration completed: ${registeredCount} succeeded, ${failedCount} failed.`
		);
		return { registeredCount, failedCount };
	}

	async handleWebhookAsync(request)
	{
		if (!this.webhookSignature) {
			Log.error("TwitCastingWebhookUpdater", "TWITCASTING_WEBHOOK_SIGNATURE is not configured");
			return new Response("Webhook signature is not configured", { status: 503 });
		}

		let payload;
		try {
			payload = await request.json();
		}
		catch {
			return new Response("Invalid JSON", { status: 400 });
		}

		if (!this.signaturesMatch(payload?.signature, this.webhookSignature))
			return new Response("Unauthorized", { status: 401 });
		if (!TwitCastingAPI.WEBHOOK_EVENTS.includes(payload?.event))
			return new Response("Unknown webhook event", { status: 400 });
		const validationError = this.getPayloadValidationError(payload);
		if (validationError)
			return new Response(validationError, { status: 400 });

		const dirty = await this.applyEventAsync(payload);
		// D1更新後に出力保存だけ失敗した再送でも、終了状態をlives.jsonへ反映する
		if (dirty === true || (dirty === false && payload.event === "liveend"))
			await this.livesJsonUpdater.saveDataJsonAsync();

		return new Response(null, { status: 204 });
	}

	async applyEventAsync(payload)
	{
		if (payload.event === "livescheduledelete") {
			return await this.twitcastingStreamRepository.deleteStreamByIdAsync(payload.live_schedule_id);
		}

		const screenId = payload.broadcaster?.screen_id ?? payload.live_schedule?.user_screen_id;
		const twitcastingMap = await this.vtuberRepository.loadTwitCastingMapAsync();
		if (!Object.prototype.hasOwnProperty.call(twitcastingMap, screenId)) {
			Log.info("TwitCastingWebhookUpdater", `Ignored WebHook for unregistered user: ${screenId}`);
			return null;
		}

		if (payload.event === "livestart") {
			return await this.twitcastingStreamRepository.upsertStreamAsync(
				this.twitcastingApi.mapMovie(payload.movie, screenId, "live")
			);
		}

		if (payload.event === "liveend") {
			if (payload.movie.is_recorded !== true)
				return await this.twitcastingStreamRepository.deleteStreamByIdAsync(payload.movie.id);
			return await this.twitcastingStreamRepository.upsertStreamAsync(
				this.twitcastingApi.mapMovie(payload.movie, screenId, "archived")
			);
		}

		return await this.twitcastingStreamRepository.upsertStreamAsync(
			this.twitcastingApi.mapLiveSchedule(payload.live_schedule, screenId)
		);
	}

	getPayloadValidationError(payload)
	{
		if (payload.event === "livescheduledelete")
			return payload.live_schedule_id ? null : "Missing live_schedule_id";
		if (payload.event === "livestart" || payload.event === "liveend") {
			if (!payload.broadcaster?.screen_id)
				return "Missing TwitCasting screen ID";
			return payload.movie?.id ? null : "Missing movie";
		}
		if (!payload.live_schedule?.user_screen_id)
			return "Missing TwitCasting screen ID";
		return payload.live_schedule?.id ? null : "Missing live_schedule";
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
