import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { estimateFreeTierUsage, FREE_TIER_LIMITS } from "../src/free_tier_usage_estimator.js";
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
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("通知量から処理段数と定期実行を加味して試算する", () => {
	const estimate = estimateFreeTierUsage(153, {
		youtubeChannelCount: 154,
		twitchUserCount: 19,
		twitcastingUserCount: 23,
	});

	assert.deepEqual(estimate.workload, {
		streams: 153,
		videos: 30.6,
		items: 183.6,
		monthlyItems: 5_508,
	});
	assert.equal(estimate.operations.notificationWorkerInvocations, 550.8);
	assert.equal(estimate.operations.notificationQueueMessages, 367.2);
	assert.equal(estimate.operations.scheduledWorkerInvocations, 290);
	assert.equal(estimate.operations.scheduledQueueMessages, 445);
	assert.equal(estimate.usage.workersRequests.amount, 1_285.8);
	assert.ok(Math.abs(estimate.usage.queueOperations.amount - 2_436.6) < 1e-9);
	assert.equal(estimate.usage.d1RowsWritten.amount, 379.6);
	assert.equal(estimate.usage.kvReads.amount, 288);
	assert.equal(estimate.usage.kvWrites.amount, 367.2);
});

test("Cloudflare無料枠に対する割合を算出する", () => {
	const estimate = estimateFreeTierUsage(100);

	assert.equal(estimate.usage.workersRequests.limit, FREE_TIER_LIMITS.workersRequests);
	assert.ok(Math.abs(estimate.usage.queueOperations.percentage - 15.84) < 1e-9);
	assert.equal(estimate.usage.kvWrites.percentage, 24);
});

test("登録者数には0以上の整数だけを受け付ける", () => {
	assert.throws(() => estimateFreeTierUsage(-1), TypeError);
	assert.throws(() => estimateFreeTierUsage(1.5), TypeError);
	assert.throws(() => estimateFreeTierUsage(1, { youtubeChannelCount: -1 }), TypeError);
});
