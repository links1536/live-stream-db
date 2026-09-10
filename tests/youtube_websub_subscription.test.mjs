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
	const originalError = console.error;
	const errors = [];
	globalThis.fetch = async () => new Response("Hub unavailable\nRetry later", {
		status: 503,
		statusText: "Service Unavailable"
	});
	console.error = message => errors.push(message);

	try {
		const webSub = new YouTubeWebSub("verify-token", "test-secret");
		const success = await webSub.registerWebSub("https://example.com/webhooks/youtube", CHANNEL_ID);

		assert.equal(success, false);
	}
	finally {
		globalThis.fetch = originalFetch;
		console.error = originalError;
	}

	assert.deepEqual(errors, [
		`[WebSub] Subscription failure response: action=subscribe, channel_id=${CHANNEL_ID}, `
			+ "status=503, status_text=Service Unavailable, body=\"Hub unavailable\\nRetry later\""
	]);
});

test("YouTube WebSub購読の本文を読めないエラー応答にもステータスを出力する", async () => {
	const originalFetch = globalThis.fetch;
	const originalError = console.error;
	const errors = [];
	globalThis.fetch = async () => ({
		status: 502,
		statusText: "Bad Gateway",
		text: async () => {
			throw new Error("Body stream failed");
		}
	});
	console.error = message => errors.push(message);

	try {
		const webSub = new YouTubeWebSub("verify-token", "test-secret");
		const success = await webSub.registerWebSub("https://example.com/webhooks/youtube", CHANNEL_ID);

		assert.equal(success, false);
	}
	finally {
		globalThis.fetch = originalFetch;
		console.error = originalError;
	}

	assert.deepEqual(errors, [
		`[WebSub] Subscription failure response: action=subscribe, channel_id=${CHANNEL_ID}, `
			+ "status=502, status_text=Bad Gateway, body=\"[response body unavailable: Body stream failed]\""
	]);
});

test("YouTube WebSub登録キューの同時実行数を1に制限する", async () => {
	const buildSource = await readFile(new URL("../src/build.py", import.meta.url), "utf8");
	const consumerBlock = buildSource.match(
		/\[\[queues\.consumers\]\]\s*\nqueue = "\{yt_register_websub_queue\}"([\s\S]*?)(?=\n\[\[queues\.)/
	)?.[1] ?? "";

	assert.match(consumerBlock, /max_concurrency = 1/);
});

test("YouTube WebSub登録失敗時はキューメッセージを再試行しない", async () => {
	const entrySource = await readFile(new URL("../src/entry.js", import.meta.url), "utf8");
	const consumerBlock = entrySource.match(
		/case env\.QUEUE_NAME_YOUTUBE_WEBSUB_REGISTER:([\s\S]*?)\n\s*break;/
	)?.[1] ?? "";

	assert.match(consumerBlock, /catch \(err\) \{[\s\S]*?msg\.ack\(\);[\s\S]*?\}/);
	assert.doesNotMatch(consumerBlock, /msg\.retry\(/);
});
