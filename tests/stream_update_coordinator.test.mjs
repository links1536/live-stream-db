import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadCoordinatorClass()
{
	const sourceUrl = new URL("../src/repository/stream_update_coordinator.js", import.meta.url);
	const source = (await readFile(sourceUrl, "utf8"))
		.replace(
			'import { DurableObject } from "cloudflare:workers";',
			"class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"
		);
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
	return (await import(moduleUrl)).StreamUpdateCoordinator;
}

function createStorage()
{
	const values = new Map();
	return {
		values,
		get: async key => values.get(key),
		put: async (key, value) => values.set(key, structuredClone(value)),
		delete: async key => values.delete(key)
	};
}

test("最終バッチの状態を後続処理成功まで保持する", async () => {
	const StreamUpdateCoordinator = await loadCoordinatorClass();
	const storage = createStorage();
	const coordinator = new StreamUpdateCoordinator({ storage }, {});
	await coordinator.initializeRunAsync("run-1", 1, "youtube", "output-1");

	const first = await coordinator.completeRunItemAsync("run-1", "message-1", true);
	const retry = await coordinator.completeRunItemAsync("run-1", "message-1", false);

	assert.deepEqual(first, retry);
	assert.equal(retry.is_last, true);
	assert.equal(retry.dirty, true);
	assert.ok(storage.values.has("stream_run:run-1"));

	await coordinator.finalizeRunAsync("run-1");
	assert.equal(storage.values.has("stream_run:run-1"), false);
});

test("同じQueueメッセージの再配信でpending countを重複減算しない", async () => {
	const StreamUpdateCoordinator = await loadCoordinatorClass();
	const storage = createStorage();
	const coordinator = new StreamUpdateCoordinator({ storage }, {});
	await coordinator.initializeRunAsync("run-1", 2, "twitch", "output-1");

	const first = await coordinator.completeRunItemAsync("run-1", "message-1", true);
	const duplicate = await coordinator.completeRunItemAsync("run-1", "message-1", false);
	const last = await coordinator.completeRunItemAsync("run-1", "message-2", false);

	assert.equal(first.pending_count, 1);
	assert.equal(duplicate.pending_count, 1);
	assert.equal(duplicate.is_last, false);
	assert.equal(last.pending_count, 0);
	assert.equal(last.is_last, true);
	assert.equal(last.dirty, true);
});

test("出力Queue投入失敗後も完了状態から再試行できる", async () => {
	const StreamUpdateCoordinator = await loadCoordinatorClass();
	const storage = createStorage();
	const coordinator = new StreamUpdateCoordinator({ storage }, {});
	await coordinator.initializeOutputRunAsync("output-1", ["twitch"]);

	const first = await coordinator.completeOutputSourceAsync("output-1", "twitch", true);
	const retry = await coordinator.completeOutputSourceAsync("output-1", "twitch", false);

	assert.equal(first.should_update, true);
	assert.equal(retry.should_update, true);
	assert.equal(retry.is_last, true);
	assert.ok(storage.values.has("output_run:output-1"));

	await coordinator.finalizeOutputRunAsync("output-1");
	assert.equal(storage.values.has("output_run:output-1"), false);
});
