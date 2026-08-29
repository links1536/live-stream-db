import assert from "node:assert/strict";
import test from "node:test";

import { TwitchEventSubUpdater } from "../src/updater/twitch_eventsub_updater.js";

function createStoredNotificationUpdater(subscriptionType)
{
	let attempt = 0;
	let outputUpdates = 0;
	let processed = 0;
	const updater = Object.create(TwitchEventSubUpdater.prototype);
	updater.webhookStateRepository = {
		loadMessageAsync: async () => ({
			processed_at_iso: null,
			payload: JSON.stringify({
				subscription_type: subscriptionType,
				event: {
					id: "stream-1",
					broadcaster_user_login: "test_user",
					started_at: "2026-08-29T00:00:00Z"
				},
				message_timestamp: "2026-08-29T00:00:00Z"
			})
		}),
		markMessageProcessedAsync: async () => {
			processed += 1;
		}
	};
	updater.vtuberRepository = {
		loadTwitchMapAsync: async () => ({ test_user: {} })
	};
	updater.twitchApi = {
		getLiveStreamsAsync: async () => [{
			twitch_id: "stream-1",
			user_login: "test_user",
			status: "live"
		}]
	};
	updater.twitchStreamRepository = {
		upsertStreamAsync: async () => attempt++ === 0,
		deleteLiveStreamsByUserLoginAsync: async () => ({
			dirty: attempt++ === 0,
			streams: []
		})
	};
	updater.eventQueue = {
		send: async () => {}
	};
	updater.livesJsonUpdater = {
		saveDataJsonAsync: async () => {
			outputUpdates += 1;
			if (outputUpdates === 1)
				throw new Error("KV unavailable");
		}
	};
	return {
		updater,
		getOutputUpdates: () => outputUpdates,
		getProcessed: () => processed
	};
}

for (const subscriptionType of ["stream.online", "stream.offline"]) {
	test(`${subscriptionType}はD1変更後の公開JSON保存失敗を再試行する`, async () => {
		const state = createStoredNotificationUpdater(subscriptionType);

		await assert.rejects(
			() => state.updater.processStoredNotificationAsync("message-1"),
			/KV unavailable/
		);
		assert.equal(state.getProcessed(), 0);

		const dirty = await state.updater.processStoredNotificationAsync("message-1");
		assert.equal(dirty, false);
		assert.equal(state.getOutputUpdates(), 2);
		assert.equal(state.getProcessed(), 1);
	});
}

test("未登録ユーザーの通知は公開JSONを保存せずprocessedにする", async () => {
	let outputUpdates = 0;
	let processed = 0;
	const updater = Object.create(TwitchEventSubUpdater.prototype);
	updater.webhookStateRepository = {
		loadMessageAsync: async () => ({
			processed_at_iso: null,
			payload: JSON.stringify({
				subscription_type: "stream.online",
				event: { broadcaster_user_login: "unknown" }
			})
		}),
		markMessageProcessedAsync: async () => {
			processed += 1;
		}
	};
	updater.processOnlineAsync = async () => ({ handled: false, dirty: false });
	updater.livesJsonUpdater = {
		saveDataJsonAsync: async () => {
			outputUpdates += 1;
		}
	};

	await updater.processStoredNotificationAsync("message-1");

	assert.equal(outputUpdates, 0);
	assert.equal(processed, 1);
});

test("録画保存後の公開JSON保存失敗をarchive retryで再試行する", async () => {
	let archiveAttempt = 0;
	let outputUpdates = 0;
	const updater = Object.create(TwitchEventSubUpdater.prototype);
	updater.tryArchiveAsync = async () => ({
		found: true,
		dirty: archiveAttempt++ === 0
	});
	updater.livesJsonUpdater = {
		saveDataJsonAsync: async () => {
			outputUpdates += 1;
			if (outputUpdates === 1)
				throw new Error("KV unavailable");
		}
	};
	updater.enqueueArchiveRetryAsync = async () => {
		throw new Error("unexpected retry");
	};

	await assert.rejects(
		() => updater.processArchiveRetryAsync("test_user", "stream-1", 1),
		/KV unavailable/
	);
	const found = await updater.processArchiveRetryAsync("test_user", "stream-1", 1);

	assert.equal(found, true);
	assert.equal(outputUpdates, 2);
});
