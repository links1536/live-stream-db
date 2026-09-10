import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { YouTubeWebSub } from "../src/api/youtube_websub.js";

const CHANNEL_ID = "UC1234567890123456789012";

for (const status of [ 202, 204 ]) {
	test(`YouTube WebSub購読要求のHTTP ${status}を成功扱いする`, async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => new Response(null, { status });

		try {
			const webSub = new YouTubeWebSub("verify-token", "test-secret");
			const success = await webSub.registerWebSub("https://example.com/webhooks/youtube", CHANNEL_ID);

			assert.equal(success, true);
		}
		finally {
			globalThis.fetch = originalFetch;
		}
	});
}

test("YouTube WebSub購読要求のエラー応答を失敗扱いする", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(null, { status: 400 });

	try {
		const webSub = new YouTubeWebSub("verify-token", "test-secret");
		const success = await webSub.registerWebSub("https://example.com/webhooks/youtube", CHANNEL_ID);

		assert.equal(success, false);
	}
	finally {
		globalThis.fetch = originalFetch;
	}
});

test("YouTube WebSub登録キューの同時実行数を1に制限する", async () => {
	const buildSource = await readFile(new URL("../src/build.py", import.meta.url), "utf8");
	const consumerBlock = buildSource.match(
		/\[\[queues\.consumers\]\]\s*\nqueue = "\{yt_register_websub_queue\}"([\s\S]*?)(?=\n\[\[queues\.)/
	)?.[1] ?? "";

	assert.match(consumerBlock, /max_concurrency = 1/);
});
