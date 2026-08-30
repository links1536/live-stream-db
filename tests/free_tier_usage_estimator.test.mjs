import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	CODE_PATH_ASSUMPTIONS,
	estimateFreeTierUsage,
	FREE_TIER_LIMITS,
} from "../src/free_tier_usage_estimator.js";
import { loadMasterStatistics } from "../tools/master_data_counter.mjs";

test("サブディレクトリとUTF-8 BOMを含むマスターデータを数える", async () => {
	const directory = await mkdtemp(join(tmpdir(), "free-tier-estimator-"));

	try {
		const nestedDirectory = join(directory, "agency");
		await mkdir(nestedDirectory);
		await writeFile(join(directory, "root.json"), "\uFEFF[{\"Name\":\"A\",\"YouTubeID\":[\"channel-a\"]}]", "utf8");
		await writeFile(join(nestedDirectory, "nested.json"), "[{\"Name\":\"B\",\"TwitchID\":[\"user-b\"]},{\"Name\":\"C\",\"TwitCastingID\":[\"user-c\"]}]", "utf8");

		assert.deepEqual(await loadMasterStatistics(directory), {
			creatorCount: 3,
			youtubeChannelCount: 1,
			twitchUserCount: 1,
			twitcastingUserCount: 1,
			platformCombinations: {
				youtubeOnly: 1,
				twitchOnly: 1,
				twitcastingOnly: 1,
				youtubeTwitch: 0,
				youtubeTwitcasting: 0,
				twitchTwitcasting: 0,
				allThree: 0,
			},
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("実コードの処理経路と現在のマスター構成を加味して試算する", () => {
	const estimate = estimateFreeTierUsage(153, {
		youtubeChannelCount: 154,
		twitchUserCount: 19,
		twitcastingUserCount: 23,
		youtubeTrackedItemCount: 164,
		platformCombinations: {
			youtubeOnly: 114,
			twitchOnly: 0,
			twitcastingOnly: 0,
			youtubeTwitch: 16,
			youtubeTwitcasting: 20,
			twitchTwitcasting: 0,
			allThree: 3,
		},
	});

	assert.deepEqual(estimate.workload, {
		streams: 153,
		platformStreams: {
			youtube: 133,
			twitch: 9,
			twitcasting: 11,
		},
		videos: 30.6,
		items: 183.6,
		youtubeNotifications: 163.6,
		monthlyItems: 5_508,
	});
	const expectedDirtyRuns = 288 * (1 - Math.pow(287 / 288, 163.6));
	assert.equal(estimate.operations.notificationWorkerInvocations, 183.6);
	assert.equal(estimate.operations.notificationQueueMessages, 9);
	assert.equal(estimate.operations.scheduledWorkerInvocations, 290);
	assert.equal(estimate.operations.youtubeBatchCount, 4);
	assert.equal(estimate.operations.youtubePollingQueueMessages, 1_152);
	assert.equal(estimate.operations.youtubeWebSubQueueMessages, 154);
	assert.equal(estimate.operations.youtubeWebSubConsumerInvocations, 16);
	assert.equal(estimate.operations.youtubeWebSubConsumerInvocationsMinimum, 16);
	assert.equal(estimate.operations.youtubeWebSubConsumerInvocationsMaximum, 154);
	assert.equal(estimate.operations.reconciliationQueueMessages, 3);
	assert.equal(estimate.operations.reconciliationDirtyRuns, 1);
	assert.ok(Math.abs(estimate.operations.youtubeDirtyRuns - expectedDirtyRuns) < 1e-9);
	assert.ok(Math.abs(estimate.operations.totalQueueMessages - (1_319 + expectedDirtyRuns)) < 1e-9);
	assert.ok(Math.abs(estimate.usage.workersRequests.amount - (1_654.6 + expectedDirtyRuns)) < 1e-9);
	assert.ok(Math.abs(estimate.usage.workersRequests.maximumAmount - (1_792.6 + expectedDirtyRuns)) < 1e-9);
	assert.ok(Math.abs(estimate.usage.queueOperations.amount - (1_319 + expectedDirtyRuns) * 3) < 1e-9);
	assert.equal(estimate.usage.d1RowsWritten.amount, 407.6);
	assert.equal(estimate.usage.kvReads.amount, 288);
	assert.ok(Math.abs(estimate.usage.kvWrites.amount - (expectedDirtyRuns * 2 + 21)) < 1e-9);
	assert.equal(estimate.usage.durableObjectRequests.amount, 4_494.6);
});

test("Cloudflare無料枠に対する割合を算出する", () => {
	const estimate = estimateFreeTierUsage(100);

	assert.equal(estimate.usage.workersRequests.limit, FREE_TIER_LIMITS.workersRequests);
	assert.equal(estimate.usage.queueOperations.limit, FREE_TIER_LIMITS.queueOperations);
	assert.equal(estimate.usage.durableObjectRequests.limit, FREE_TIER_LIMITS.durableObjectRequests);
	assert.ok(estimate.usage.queueOperations.percentage > 0);
});

test("登録者数には0以上の整数だけを受け付ける", () => {
	assert.throws(() => estimateFreeTierUsage(-1), TypeError);
	assert.throws(() => estimateFreeTierUsage(1.5), TypeError);
	assert.throws(() => estimateFreeTierUsage(1, { youtubeChannelCount: -1 }), TypeError);
	assert.throws(() => estimateFreeTierUsage(1, { youtubeTrackedItemCount: 1.5 }), TypeError);
	assert.throws(() => estimateFreeTierUsage(1, { platformCombinations: { youtubeOnly: 2 } }), TypeError);
});

test("試算定数が生成設定と更新実装に一致する", async () => {
	const buildSource = await readFile(new URL("../src/build.py", import.meta.url), "utf8");
	const youtubeSource = await readFile(new URL("../src/api/youtube_data_api.js", import.meta.url), "utf8");
	const twitchSource = await readFile(new URL("../src/api/twitch_api.js", import.meta.url), "utf8");
	const twitcastingSource = await readFile(new URL("../src/api/twitcasting_api.js", import.meta.url), "utf8");

	const cronBlock = buildSource.match(/\[triggers\]\s*crons = \[([\s\S]*?)\]/)?.[1] ?? "";
	const activeCrons = [...cronBlock.matchAll(/^\s*"([^"]+)"/gm)].map(match => match[1]);
	assert.deepEqual(activeCrons, [ "30 23 * * *", "45 23 * * *", "*/5 * * * *" ]);
	assert.match(buildSource, /max_batch_size = 1/);
	assert.match(youtubeSource, /static get CHUNK_SIZE\(\)\s*\{\s*return 50;/);
	assert.match(twitchSource, /TWITCH_MAX_USERS_PER_REQUEST = 50/);
	assert.match(twitcastingSource, /TWITCASTING_MAX_USERS_PER_BATCH = 15/);
	assert.equal(CODE_PATH_ASSUMPTIONS.youtubeUpdatesPerDay, 288);
	assert.equal(CODE_PATH_ASSUMPTIONS.dailyCronRuns, 2);
	assert.equal(CODE_PATH_ASSUMPTIONS.youtubeBatchSize, 50);
	assert.equal(CODE_PATH_ASSUMPTIONS.twitchBatchSize, 50);
	assert.equal(CODE_PATH_ASSUMPTIONS.twitcastingBatchSize, 15);
});
