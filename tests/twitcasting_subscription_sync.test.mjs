import assert from "node:assert/strict";
import test from "node:test";
import { TwitCastingAPI } from "../src/api/twitcasting_api.js";
import { WebhookSubscriptionUpdater } from "../src/updater/webhook_subscription_updater.js";

function target(screenId, userId, updatedAt = new Date().toISOString())
{
	return {
		platform: "twitcasting",
		target_key: screenId,
		external_user_id: userId,
		updated_at_iso: updatedAt
	};
}

function webhooks(userId)
{
	return TwitCastingAPI.WEBHOOK_EVENTS.map(event => ({ user_id: userId, event }));
}

function createUpdater({ screenIds = [], targets = [], remoteWebhooks = [], getUserInfoAsync = async () => null } = {})
{
	const sent = [];
	const deleted = [];
	const stored = new Map(targets.map(value => [ value.target_key, value ]));
	const updater = Object.create(WebhookSubscriptionUpdater.prototype);
	updater.vtuberRepository = {
		loadTwitCastingMapAsync: async () => Object.fromEntries(screenIds.map(screenId => [ screenId, {} ]))
	};
	updater.webhookStateRepository = {
		loadTargetsAsync: async () => [...stored.values()],
		upsertTargetAsync: async (platform, screenId, userId) => {
			stored.set(screenId, target(screenId, userId));
		},
		deleteTargetAsync: async (platform, screenId) => {
			deleted.push(screenId);
			stored.delete(screenId);
		}
	};
	updater.twitcastingApi = {
		getWebhooksAsync: async userId => userId == null
			? remoteWebhooks
			: remoteWebhooks.filter(webhook => String(webhook.user_id) === String(userId)),
		getUserInfoAsync
	};
	updater.operationQueue = {
		send: async (body, options) => sent.push({ body: JSON.parse(body), options })
	};
	return { updater, sent, deleted, stored };
}

test("解決バッチでは対象user IDのWebHookだけを取得する", async () => {
	const paths = [];
	const api = new TwitCastingAPI("client", "secret");
	api.getAsync = async path => {
		paths.push(path);
		return Response.json({
			all_count: 1,
			webhooks: [{ user_id: "100/200", event: "livestart" }]
		});
	};

	const result = await api.getWebhooksAsync("100/200");

	assert.deepEqual(paths, [ "/webhooks?user_id=100%2F200" ]);
	assert.equal(result.length, 1);
});

test("保存済みのTwitCasting user IDを再利用する", async () => {
	let userInfoCalls = 0;
	const { updater, sent } = createUpdater({
		screenIds: [ "known_user" ],
		targets: [ target("known_user", "100") ],
		remoteWebhooks: webhooks("100"),
		getUserInfoAsync: async () => {
			userInfoCalls += 1;
			return { id: "100" };
		}
	});

	const result = await updater.scheduleTwitCastingSyncAsync();

	assert.equal(userInfoCalls, 0);
	assert.equal(result.targetCount, 1);
	assert.equal(result.unresolvedCount, 0);
	assert.deepEqual(sent, []);
});

test("60人を超える未解決対象をレート制限単位で遅延Queueへ分割する", async () => {
	const screenIds = Array.from({ length: 65 }, (_, index) => `user_${index}`);
	let userInfoCalls = 0;
	const { updater, sent } = createUpdater({
		screenIds,
		getUserInfoAsync: async screenId => {
			userInfoCalls += 1;
			return { id: `id_${screenId}` };
		}
	});

	const result = await updater.scheduleTwitCastingSyncAsync();
	const resolutionMessages = sent.filter(value => value.body.type === "twitcasting_user_resolve_batch");

	assert.equal(result.unresolvedCount, 65);
	assert.equal(result.resolutionBatchCount, 13);
	assert.deepEqual(resolutionMessages.map(value => value.body.screen_ids.length), [ 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5 ]);
	assert.deepEqual(resolutionMessages.map(value => value.options.delaySeconds), [ 60, 60, 120, 120, 180, 180, 240, 240, 300, 300, 360, 360, 420 ]);

	for (const message of resolutionMessages)
		await updater.processTwitCastingUserResolutionAsync(message.body.screen_ids);

	assert.equal(userInfoCalls, 65);
	assert.equal(sent.filter(value => value.body.type === "twitcasting_webhook_register").length, 65);
});

test("一部解決失敗後のQueue再試行では未解決対象だけをAPIで再解決する", async () => {
	const calls = [];
	let secondUserAttempts = 0;
	const remoteWebhooks = [];
	const { updater, sent, stored } = createUpdater({
		remoteWebhooks,
		getUserInfoAsync: async screenId => {
			calls.push(screenId);
			if (screenId === "user_b" && secondUserAttempts++ === 0)
				return null;
			return { id: screenId === "user_a" ? "101" : "102" };
		}
	});

	await assert.rejects(
		() => updater.processTwitCastingUserResolutionAsync([ "user_a", "user_b" ]),
		/user_b/
	);
	assert.equal(stored.get("user_a").external_user_id, "101");
	assert.deepEqual(sent.map(value => value.body), [
		{ type: "twitcasting_webhook_register", user_id: "101", events: TwitCastingAPI.WEBHOOK_EVENTS }
	]);
	remoteWebhooks.push(...webhooks("101"));

	const result = await updater.processTwitCastingUserResolutionAsync([ "user_a", "user_b" ]);

	assert.deepEqual(calls, [ "user_a", "user_b", "user_b" ]);
	assert.equal(result.resolvedCount, 2);
	assert.deepEqual(sent.map(value => value.body), [
		{ type: "twitcasting_webhook_register", user_id: "101", events: TwitCastingAPI.WEBHOOK_EVENTS },
		{ type: "twitcasting_webhook_register", user_id: "102", events: TwitCastingAPI.WEBHOOK_EVENTS }
	]);
});

test("user ID解決Queueはレート制限用の最大件数を超えて処理しない", async () => {
	const { updater } = createUpdater();

	await assert.rejects(
		() => updater.processTwitCastingUserResolutionAsync([ "1", "2", "3", "4", "5", "6" ]),
		/batch is too large/
	);
});

test("screen ID削除時は旧購読を解除し、新規screen IDだけを解決する", async () => {
	const { updater, sent, deleted } = createUpdater({
		screenIds: [ "new_user" ],
		targets: [ target("old_user", "201") ],
		remoteWebhooks: webhooks("201")
	});

	const result = await updater.scheduleTwitCastingSyncAsync();

	assert.equal(result.unresolvedCount, 1);
	assert.deepEqual(deleted, [ "old_user" ]);
	assert.deepEqual(sent.map(value => value.body.type), [
		"twitcasting_user_resolve_batch",
		"twitcasting_webhook_remove"
	]);
	assert.deepEqual(sent[1].body.events, TwitCastingAPI.WEBHOOK_EVENTS);
});

test("期限切れ対応の再検証でuser ID変更へ収束する", async () => {
	const expired = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
	const { updater, sent, stored } = createUpdater({
		targets: [ target("current_user", "301", expired) ],
		remoteWebhooks: webhooks("301"),
		getUserInfoAsync: async () => ({ id: "302" })
	});

	const result = await updater.processTwitCastingUserResolutionAsync([ "current_user" ]);

	assert.equal(stored.get("current_user").external_user_id, "302");
	assert.equal(result.removeCount, 1);
	assert.equal(result.registerCount, 1);
	assert.deepEqual(sent.map(value => value.body.type), [
		"twitcasting_webhook_remove",
		"twitcasting_webhook_register"
	]);
});
