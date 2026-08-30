import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { estimateFreeTierUsage, FREE_TIER_LIMITS } from "../src/free_tier_usage_estimator.js";
import { countCreators } from "../tools/master_data_counter.mjs";

test("サブディレクトリとUTF-8 BOMを含むマスターデータを数える", async () => {
	const directory = await mkdtemp(join(tmpdir(), "free-tier-estimator-"));

	try {
		const nestedDirectory = join(directory, "agency");
		await mkdir(nestedDirectory);
		await writeFile(join(directory, "root.json"), "\uFEFF[{\"Name\":\"A\"}]", "utf8");
		await writeFile(join(nestedDirectory, "nested.json"), "[{\"Name\":\"B\"},{\"Name\":\"C\"}]", "utf8");

		assert.equal(await countCreators(directory), 3);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("登録者ごとに配信1件、5人ごとに動画1件として試算する", () => {
	const estimate = estimateFreeTierUsage(153);

	assert.deepEqual(estimate.workload, {
		streams: 153,
		videos: 30.6,
		items: 183.6,
		monthlyItems: 5_508,
	});
	assert.equal(estimate.usage.workersRequests.amount, 183.6);
	assert.equal(estimate.usage.queueOperations.amount, 550.8);
	assert.equal(estimate.usage.d1RowsWritten.amount, 183.6);
	assert.equal(estimate.usage.kvWrites.amount, 183.6);
});

test("Cloudflare無料枠に対する割合を算出する", () => {
	const estimate = estimateFreeTierUsage(100);

	assert.equal(estimate.usage.workersRequests.limit, FREE_TIER_LIMITS.workersRequests);
	assert.ok(Math.abs(estimate.usage.queueOperations.percentage - 3.6) < Number.EPSILON * 10);
	assert.equal(estimate.usage.kvWrites.percentage, 12);
});

test("登録者数には0以上の整数だけを受け付ける", () => {
	assert.throws(() => estimateFreeTierUsage(-1), TypeError);
	assert.throws(() => estimateFreeTierUsage(1.5), TypeError);
});
