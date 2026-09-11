import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { WebhookStateRepository } from "../src/repository/webhook_state_repository.js";
import { YouTubeWebSubUpdater } from "../src/updater/youtube_websub_updater.js";

const NOW_MS = Date.parse("2026-09-10T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_CHANNEL_ID = "UC1111111111111111111111";
const DUE_CHANNEL_ID = "UC2222222222222222222222";
const UNKNOWN_CHANNEL_ID = "UC3333333333333333333333";
const NEW_CHANNEL_ID = "UC4444444444444444444444";
const REMOVED_CHANNEL_ID = "UC5555555555555555555555";
const EXPIRED_CHANNEL_ID = "UC6666666666666666666666";
const INVALID_EXPIRY_CHANNEL_ID = "UC7777777777777777777777";

function createVerificationRequest(channelId, leaseSeconds = "432000", mode = "subscribe")
{
	const url = new URL("https://example.com/webhooks/youtube");
	url.searchParams.set("hub.mode", mode);
	url.searchParams.set("hub.topic", `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`);
	url.searchParams.set("hub.challenge", "challenge");
	url.searchParams.set("hub.verify_token", "verify-token");
	if (leaseSeconds != null)
		url.searchParams.set("hub.lease_seconds", leaseSeconds);
	return new Request(url);
}

test("YouTube WebSubは期限まで2日以下の購読だけを更新する", async () => {
	const messages = [];
	const updater = Object.create(YouTubeWebSubUpdater.prototype);
	updater.vtuberRepository = {
		loadYouTubeMapAsync: async () => ({
			[ACTIVE_CHANNEL_ID]: { Name: "有効" },
			[DUE_CHANNEL_ID]: { Name: "更新対象" },
			[UNKNOWN_CHANNEL_ID]: { Name: "期限不明" },
			[NEW_CHANNEL_ID]: { Name: "新規" }
		})
	};
	updater.webhookStateRepository = {
		loadTargetsAsync: async () => [
			{
				target_key: ACTIVE_CHANNEL_ID,
				expires_at_iso: new Date(NOW_MS + 2 * DAY_MS + 1).toISOString()
			},
			{
				target_key: DUE_CHANNEL_ID,
				expires_at_iso: new Date(NOW_MS + 2 * DAY_MS).toISOString()
			},
			{
				target_key: UNKNOWN_CHANNEL_ID,
				expires_at_iso: null
			},
			{
				target_key: REMOVED_CHANNEL_ID,
				expires_at_iso: new Date(NOW_MS + 5 * DAY_MS).toISOString()
			}
		]
	};
	updater.youtubeWebsubQueue = {
		send: async message => messages.push(JSON.parse(message))
	};

	const result = await updater.scheduleSubscriptionSyncAsync(NOW_MS);

	assert.deepEqual(messages, [
		{
			action: "subscribe",
			channel_id: DUE_CHANNEL_ID,
			streamer_name: "更新対象"
		},
		{
			action: "subscribe",
			channel_id: UNKNOWN_CHANNEL_ID,
			streamer_name: "期限不明"
		},
		{
			action: "subscribe",
			channel_id: NEW_CHANNEL_ID,
			streamer_name: "新規"
		},
		{
			action: "unsubscribe",
			channel_id: REMOVED_CHANNEL_ID
		}
	]);
	assert.deepEqual(result, {
		subscribeCount: 3,
		unsubscribeCount: 1
	});
});

test("YouTube WebSubは未登録、期限不明、または期限切れだけを手動登録する", async () => {
	const messages = [];
	const updater = Object.create(YouTubeWebSubUpdater.prototype);
	updater.vtuberRepository = {
		loadYouTubeMapAsync: async () => ({
			[ACTIVE_CHANNEL_ID]: { Name: "有効" },
			[DUE_CHANNEL_ID]: { Name: "期限2日以内" },
			[UNKNOWN_CHANNEL_ID]: { Name: "期限不明" },
			[NEW_CHANNEL_ID]: { Name: "未登録" },
			[EXPIRED_CHANNEL_ID]: { Name: "期限切れ" },
			[INVALID_EXPIRY_CHANNEL_ID]: { Name: "期限不正" }
		})
	};
	updater.webhookStateRepository = {
		loadTargetsAsync: async () => [
			{
				target_key: ACTIVE_CHANNEL_ID,
				expires_at_iso: new Date(NOW_MS + 5 * DAY_MS).toISOString()
			},
			{
				target_key: DUE_CHANNEL_ID,
				expires_at_iso: new Date(NOW_MS + DAY_MS).toISOString()
			},
			{
				target_key: UNKNOWN_CHANNEL_ID,
				expires_at_iso: null
			},
			{
				target_key: EXPIRED_CHANNEL_ID,
				expires_at_iso: new Date(NOW_MS).toISOString()
			},
			{
				target_key: INVALID_EXPIRY_CHANNEL_ID,
				expires_at_iso: "invalid"
			},
			{
				target_key: REMOVED_CHANNEL_ID,
				expires_at_iso: new Date(NOW_MS - DAY_MS).toISOString()
			}
		]
	};
	updater.youtubeWebsubQueue = {
		send: async message => messages.push(JSON.parse(message))
	};

	const result = await updater.registerMissingWebsubAsync(NOW_MS);

	assert.deepEqual(messages, [
		{
			action: "subscribe",
			channel_id: UNKNOWN_CHANNEL_ID,
			streamer_name: "期限不明"
		},
		{
			action: "subscribe",
			channel_id: NEW_CHANNEL_ID,
			streamer_name: "未登録"
		},
		{
			action: "subscribe",
			channel_id: EXPIRED_CHANNEL_ID,
			streamer_name: "期限切れ"
		},
		{
			action: "subscribe",
			channel_id: INVALID_EXPIRY_CHANNEL_ID,
			streamer_name: "期限不正"
		}
	]);
	assert.deepEqual(result, {
		targetCount: 6,
		subscribeCount: 4
	});
});

test("YouTube WebSub検証GETのlease secondsから有効期限を保存する", async () => {
	const calls = [];
	const updater = Object.create(YouTubeWebSubUpdater.prototype);
	updater.webhookStateRepository = {
		upsertTargetAsync: async (...args) => calls.push(args)
	};

	await updater.saveSubscriptionVerificationAsync(
		createVerificationRequest(ACTIVE_CHANNEL_ID),
		NOW_MS
	);

	assert.deepEqual(calls, [ [
		"youtube",
		ACTIVE_CHANNEL_ID,
		ACTIVE_CHANNEL_ID,
		new Date(NOW_MS + 5 * DAY_MS).toISOString()
	] ]);
});

test("YouTube WebSub検証GETのlease secondsが不正な場合は有効期限を保存しない", async () => {
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = message => warnings.push(message);

	try {
		const updater = Object.create(YouTubeWebSubUpdater.prototype);
		updater.webhookStateRepository = {
			upsertTargetAsync: async () => assert.fail("不正な有効期限を保存してはいけません")
		};

		await updater.saveSubscriptionVerificationAsync(
			createVerificationRequest(ACTIVE_CHANNEL_ID, "invalid"),
			NOW_MS
		);
	}
	finally {
		console.warn = originalWarn;
	}

	assert.deepEqual(warnings, [
		`[WARN] [WebSub] Invalid lease seconds: channel_id=${ACTIVE_CHANNEL_ID}, lease_seconds=invalid`
	]);
});

test("YouTube WebSubの検証成功時に有効期限保存処理を呼び出す", async () => {
	const request = createVerificationRequest(ACTIVE_CHANNEL_ID);
	const calls = [];
	const updater = Object.create(YouTubeWebSubUpdater.prototype);
	updater.youtubeWebsub = {
		processGet: async () => new Response("challenge", { status: 200 })
	};
	updater.saveSubscriptionVerificationAsync = async value => calls.push(value);

	const response = await updater.handleYoutubeWebhook(request);

	assert.equal(response.status, 200);
	assert.deepEqual(calls, [ request ]);
});

test("YouTube WebSubの検証状態保存に失敗してもHubへ成功応答を返す", async () => {
	const errors = [];
	const originalError = console.error;
	console.error = message => errors.push(message);

	try {
		const request = createVerificationRequest(ACTIVE_CHANNEL_ID);
		const updater = Object.create(YouTubeWebSubUpdater.prototype);
		updater.youtubeWebsub = {
			processGet: async () => new Response("challenge", { status: 200 })
		};
		updater.saveSubscriptionVerificationAsync = async () => {
			throw new Error("D1 unavailable");
		};

		const response = await updater.handleYoutubeWebhook(request);

		assert.equal(response.status, 200);
		assert.equal(await response.text(), "challenge");
	}
	finally {
		console.error = originalError;
	}

	assert.deepEqual(errors, [
		"[WebSub] Failed to save subscription verification: D1 unavailable"
	]);
});

test("YouTube WebSubの解除検証時に保存済み購読状態を削除する", async () => {
	const calls = [];
	const updater = Object.create(YouTubeWebSubUpdater.prototype);
	updater.webhookStateRepository = {
		deleteTargetAsync: async (...args) => calls.push(args)
	};

	await updater.saveSubscriptionVerificationAsync(
		createVerificationRequest(ACTIVE_CHANNEL_ID, null, "unsubscribe"),
		NOW_MS
	);

	assert.deepEqual(calls, [ [ "youtube", ACTIVE_CHANNEL_ID ] ]);
});

test("Webhook購読状態のupsertで既存の有効期限を保持できる", async () => {
	let sql;
	let values;
	const repository = new WebhookStateRepository({
		prepare: statement => {
			sql = statement;
			return {
				bind: (...parameters) => {
					values = parameters;
					return { run: async () => ({}) };
				}
			};
		}
	});

	await repository.upsertTargetAsync("youtube", ACTIVE_CHANNEL_ID, ACTIVE_CHANNEL_ID);

	assert.match(sql, /expires_at_iso = COALESCE\(/);
	assert.equal(values[4], null);
});

test("Webhook購読状態の有効期限を現在時刻から既存期限までに分散できる", async () => {
	const calls = [];
	const repository = new WebhookStateRepository({
		prepare: statement => ({
			bind: (...parameters) => ({
				run: async () => calls.push({ statement, parameters })
			})
		})
	});
	repository.loadTargetsAsync = async () => [
		{ target_key: ACTIVE_CHANNEL_ID, expires_at_iso: new Date(NOW_MS + 5 * DAY_MS).toISOString() },
		{ target_key: DUE_CHANNEL_ID, expires_at_iso: new Date(NOW_MS + 2 * DAY_MS).toISOString() },
		{ target_key: UNKNOWN_CHANNEL_ID, expires_at_iso: null },
		{ target_key: EXPIRED_CHANNEL_ID, expires_at_iso: new Date(NOW_MS).toISOString() }
	];

	const result = await repository.spreadFutureExpirationsAsync("youtube", NOW_MS, () => 0.5);

	assert.deepEqual(result, { targetCount: 4, updatedCount: 2, skippedCount: 2 });
	assert.equal(calls[0].parameters[0], new Date(NOW_MS).toISOString());
	assert.equal(calls[0].parameters[3], ACTIVE_CHANNEL_ID);
	const distributedExpirationMs = Date.parse(calls[1].parameters[0]);
	assert.ok(distributedExpirationMs >= NOW_MS);
	assert.ok(distributedExpirationMs <= NOW_MS + 2 * DAY_MS);
	assert.equal(calls[1].parameters[3], DUE_CHANNEL_ID);
});

test("Webhook購読状態の分散後の有効期限は既存期限を超えない", async () => {
	const calls = [];
	const repository = new WebhookStateRepository({
		prepare: () => ({
			bind: (...parameters) => ({
				run: async () => calls.push(parameters)
			})
		})
	});
	const existingExpirationMs = NOW_MS + DAY_MS;
	repository.loadTargetsAsync = async () => [
		{ target_key: ACTIVE_CHANNEL_ID, expires_at_iso: new Date(NOW_MS + 2 * DAY_MS).toISOString() },
		{ target_key: DUE_CHANNEL_ID, expires_at_iso: new Date(existingExpirationMs).toISOString() }
	];

	await repository.spreadFutureExpirationsAsync("youtube", NOW_MS, () => 1);

	assert.equal(Date.parse(calls[1][0]), existingExpirationMs);
});

test("D1の初期スキーマと既存環境向け移行SQLに有効期限列を定義する", async () => {
	const [setupSql, migrationSql] = await Promise.all([
		readFile(new URL("../setup-d1.sql", import.meta.url), "utf8"),
		readFile(new URL("../migrate-youtube-websub-expiration.sql", import.meta.url), "utf8")
	]);

	assert.match(setupSql, /expires_at_iso TEXT/);
	assert.match(
		migrationSql,
		/ALTER TABLE webhook_subscription_targets\s+ADD COLUMN expires_at_iso TEXT;/
	);
});
