import assert from "node:assert/strict";
import test from "node:test";

import { YouTubeWebSubUpdater } from "../src/updater/youtube_websub_updater.js";

const CHANNEL_ID = "UC1234567890123456789012";
const REMOVED_CHANNEL_ID = "UCabcdefghijklmnopqrstuv";

test("YouTube WebSub購読キューへ配信者名を含める", async () => {
	const messages = [];
	const updater = Object.create(YouTubeWebSubUpdater.prototype);
	updater.vtuberRepository = {
		loadYouTubeMapAsync: async () => ({
			[CHANNEL_ID]: { Name: "配信者名" }
		})
	};
	updater.webhookStateRepository = {
		loadTargetsAsync: async () => [ { target_key: REMOVED_CHANNEL_ID } ]
	};
	updater.youtubeWebsubQueue = {
		send: async message => messages.push(JSON.parse(message))
	};

	await updater.scheduleSubscriptionSyncAsync();

	assert.deepEqual(messages, [
		{
			action: "subscribe",
			channel_id: CHANNEL_ID,
			streamer_name: "配信者名"
		},
		{
			action: "unsubscribe",
			channel_id: REMOVED_CHANNEL_ID
		}
	]);
});

test("YouTube WebSub購読要求にチャンネルIDと配信者名を出力する", async () => {
	const output = [];
	const originalLog = console.log;
	console.log = message => output.push(message);

	try {
		const updater = Object.create(YouTubeWebSubUpdater.prototype);
		updater.youtubeWebsub = {
			registerWebSub: async () => true
		};
		updater.webhookStateRepository = {
			upsertTargetAsync: async () => {}
		};

		const success = await updater.processSubscriptionOperationAsync(
			"subscribe",
			CHANNEL_ID,
			"https://example.com/webhooks/youtube",
			"配信者名"
		);

		assert.equal(success, true);
	}
	finally {
		console.log = originalLog;
	}

	assert.deepEqual(output, [
		`[WebSub] Subscription request: action=subscribe, channel_id=${CHANNEL_ID}, streamer_name=配信者名`,
		`[WebSub] Subscription success: action=subscribe, channel_id=${CHANNEL_ID}, streamer_name=配信者名`
	]);
});

test("配信者名がないYouTube WebSub購読要求にもチャンネルIDを出力する", async () => {
	const output = [];
	const originalLog = console.log;
	console.log = message => output.push(message);

	try {
		const updater = Object.create(YouTubeWebSubUpdater.prototype);
		updater.youtubeWebsub = {
			unregisterWebSub: async () => true
		};
		updater.webhookStateRepository = {
			deleteTargetAsync: async () => {}
		};

		const success = await updater.processSubscriptionOperationAsync(
			"unsubscribe",
			REMOVED_CHANNEL_ID,
			"https://example.com/webhooks/youtube"
		);

		assert.equal(success, true);
	}
	finally {
		console.log = originalLog;
	}

	assert.deepEqual(output, [
		`[WebSub] Subscription request: action=unsubscribe, channel_id=${REMOVED_CHANNEL_ID}`,
		`[WebSub] Subscription success: action=unsubscribe, channel_id=${REMOVED_CHANNEL_ID}`
	]);
});

test("失敗したYouTube WebSub購読要求の対象をエラー出力する", async () => {
	const output = [];
	const errors = [];
	const originalLog = console.log;
	const originalError = console.error;
	console.log = message => output.push(message);
	console.error = message => errors.push(message);

	try {
		const updater = Object.create(YouTubeWebSubUpdater.prototype);
		updater.youtubeWebsub = {
			registerWebSub: async () => false
		};
		updater.webhookStateRepository = {
			upsertTargetAsync: async () => assert.fail("失敗した購読要求を保存してはいけません")
		};

		const success = await updater.processSubscriptionOperationAsync(
			"subscribe",
			CHANNEL_ID,
			"https://example.com/webhooks/youtube",
			"配信者名"
		);

		assert.equal(success, false);
	}
	finally {
		console.log = originalLog;
		console.error = originalError;
	}

	assert.deepEqual(output, [
		`[WebSub] Subscription request: action=subscribe, channel_id=${CHANNEL_ID}, streamer_name=配信者名`
	]);
	assert.deepEqual(errors, [
		`[WebSub] Subscription failure: action=subscribe, channel_id=${CHANNEL_ID}, streamer_name=配信者名`
	]);
});

test("例外になったYouTube WebSub購読要求の対象と原因をエラー出力する", async () => {
	const output = [];
	const errors = [];
	const originalLog = console.log;
	const originalError = console.error;
	console.log = message => output.push(message);
	console.error = message => errors.push(message);

	try {
		const updater = Object.create(YouTubeWebSubUpdater.prototype);
		updater.youtubeWebsub = {
			registerWebSub: async () => {
				throw new Error("Hub unavailable");
			}
		};
		updater.webhookStateRepository = {
			upsertTargetAsync: async () => assert.fail("例外になった購読要求を保存してはいけません")
		};

		await assert.rejects(
			updater.processSubscriptionOperationAsync(
				"subscribe",
				CHANNEL_ID,
				"https://example.com/webhooks/youtube",
				"配信者名"
			),
			/Hub unavailable/
		);
	}
	finally {
		console.log = originalLog;
		console.error = originalError;
	}

	assert.deepEqual(output, [
		`[WebSub] Subscription request: action=subscribe, channel_id=${CHANNEL_ID}, streamer_name=配信者名`
	]);
	assert.deepEqual(errors, [
		`[WebSub] Subscription failure: action=subscribe, channel_id=${CHANNEL_ID}, streamer_name=配信者名, error=Hub unavailable`
	]);
});
