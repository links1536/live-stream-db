import assert from "node:assert/strict";
import test from "node:test";

import { VTuberRepository } from "../src/repository/vtuber_repository.js";
import { TwitchStreamUpdater } from "../src/updater/twitch_stream_updater.js";
import { TwitCastingStreamUpdater } from "../src/updater/twitcasting_stream_updater.js";
import { TwitchEventSubUpdater } from "../src/updater/twitch_eventsub_updater.js";
import { TwitCastingWebhookUpdater } from "../src/updater/twitcasting_webhook_updater.js";
import { WebhookSubscriptionUpdater } from "../src/updater/webhook_subscription_updater.js";

const D1Error = new Error("D1 unavailable");

function createFailingDb()
{
	return {
		prepare: () => ({
			all: async () => {
				throw D1Error;
			}
		})
	};
}

test("D1読み取り失敗を空のマスターデータへ変換しない", async () => {
	const repository = new VTuberRepository(createFailingDb());

	for (const action of [
		() => repository.loadMasterDataAsync(),
		() => repository.loadYouTubeMapAsync(),
		() => repository.loadTwitchMapAsync(),
		() => repository.loadTwitCastingMapAsync(),
		() => repository.loadChannelLastUpdatedAsync()
	]) {
		await assert.rejects(action, D1Error);
	}
});

for (const [name, Updater, loadMapName, expectedType] of [
	["Twitch", TwitchStreamUpdater, "loadTwitchMapAsync", "twitch_clear_all"],
	["TwitCasting", TwitCastingStreamUpdater, "loadTwitCastingMapAsync", "twitcasting_clear_all"]
]) {
	test(`${name}のD1読み取り失敗時は全件削除を投入しない`, async () => {
		const sent = [];
		const updater = Object.create(Updater.prototype);
		updater.vtuberRepository = {
			[loadMapName]: async () => {
				throw D1Error;
			}
		};
		updater.updateStreamsQueue = {
			send: async body => sent.push(JSON.parse(body))
		};

		await assert.rejects(() => updater.scheduleTrigger("output-run"), D1Error);
		assert.deepEqual(sent, []);

		updater.vtuberRepository[loadMapName] = async () => ({});
		await updater.scheduleTrigger("output-run");
		assert.deepEqual(sent, [{
			type: expectedType,
			output_run_id: "output-run"
		}]);
	});
}

test("購読同期のD1読み取り失敗時は解除操作を投入しない", async () => {
	const sent = [];
	const updater = Object.create(WebhookSubscriptionUpdater.prototype);
	updater.env = {
		TWITCH_EVENTSUB_CALLBACK_URL: "https://example.com/webhooks/twitch",
		TWITCH_EVENTSUB_SECRET: "test-secret"
	};
	updater.vtuberRepository = {
		loadTwitchMapAsync: async () => {
			throw D1Error;
		}
	};
	updater.twitchApi = {
		getUsersAsync: async () => [],
		getEventSubSubscriptionsAsync: async () => ({
			subscriptions: [{
				id: "subscription-1",
				type: "stream.online",
				status: "enabled",
				condition: { broadcaster_user_id: "123" },
				transport: {
					method: "webhook",
					callback: "https://example.com/webhooks/twitch"
				}
			}],
			totalCost: 1,
			maxTotalCost: 10
		})
	};
	updater.operationQueue = {
		send: async body => sent.push(JSON.parse(body))
	};
	updater.webhookStateRepository = {
		loadTargetsAsync: async () => [],
		deleteTargetAsync: async () => {}
	};

	await assert.rejects(() => updater.scheduleTwitchSyncAsync(), D1Error);
	assert.deepEqual(sent, []);

	updater.vtuberRepository.loadTwitchMapAsync = async () => ({});
	await updater.scheduleTwitchSyncAsync();
	assert.deepEqual(sent, [{
		type: "twitch_eventsub_delete",
		subscription_id: "subscription-1"
	}]);
});

test("TwitCasting WebhookのD1読み取り失敗時は成功扱いにしない", async () => {
	let outputUpdates = 0;
	const updater = Object.create(TwitCastingWebhookUpdater.prototype);
	updater.webhookSignature = "signature";
	updater.vtuberRepository = {
		loadTwitCastingMapAsync: async () => {
			throw D1Error;
		}
	};
	updater.livesJsonUpdater = {
		saveDataJsonAsync: async () => {
			outputUpdates += 1;
		}
	};
	const request = new Request("https://example.com/webhooks/twitcasting", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			signature: "signature",
			event: "livestart",
			movie: { id: "123" },
			broadcaster: { screen_id: "test_user" }
		})
	});

	await assert.rejects(() => updater.handleWebhookAsync(request), D1Error);
	assert.equal(outputUpdates, 0);
});

test("Twitch WebhookのD1読み取り失敗時はprocessedにしない", async () => {
	let processed = false;
	const updater = Object.create(TwitchEventSubUpdater.prototype);
	updater.webhookStateRepository = {
		loadMessageAsync: async () => ({
			processed_at_iso: null,
			payload: JSON.stringify({
				subscription_type: "stream.online",
				event: {
					id: "stream-1",
					broadcaster_user_login: "test_user"
				}
			})
		}),
		markMessageProcessedAsync: async () => {
			processed = true;
		}
	};
	updater.vtuberRepository = {
		loadTwitchMapAsync: async () => {
			throw D1Error;
		}
	};

	await assert.rejects(() => updater.processStoredNotificationAsync("message-1"), D1Error);
	assert.equal(processed, false);
});
