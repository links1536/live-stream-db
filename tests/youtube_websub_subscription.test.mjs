import assert from "node:assert/strict";
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
