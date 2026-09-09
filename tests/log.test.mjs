import assert from "node:assert/strict";
import test from "node:test";

import { YouTubeWebSub } from "../src/api/youtube_websub.js";
import { Log } from "../src/log.js";
import { YouTubeWebSubUpdater } from "../src/updater/youtube_websub_updater.js";

async function createSignatureAsync(body, secret)
{
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-1" },
		false,
		[ "sign" ]
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	return `sha1=${Array.from(new Uint8Array(signature), value => value.toString(16).padStart(2, "0")).join("")}`;
}

test("新規YouTube WebSub通知だけを出力する", async () => {
	const output = [];
	const originalLog = console.log;
	const originalWarn = console.warn;
	const originalError = console.error;
	console.log = message => output.push([ "log", message ]);
	console.warn = message => output.push([ "warn", message ]);
	console.error = message => output.push([ "error", message ]);

	try {
		Log.info("YouTubeScheduleUpdater", "info");
		Log.warning("Test", "warning");
		Log.error("Test", "error");

		const secret = "test-secret";
		const body = "<feed><entry><yt:videoId>video-id</yt:videoId></entry></feed>";
		const updater = Object.create(YouTubeWebSubUpdater.prototype);
		updater.youtubeWebsub = new YouTubeWebSub("verify-token", secret);
		updater.youtubeNoticesCache = {
			addAsync: async () => {}
		};
		const signature = await createSignatureAsync(body, secret);
		const response = await updater.handleYoutubeWebhook(new Request("https://example.com/webhooks/youtube", {
			method: "POST",
			headers: { "x-hub-signature": signature },
			body
		}));
		assert.equal(response.status, 200);
	}
	finally {
		console.log = originalLog;
		console.warn = originalWarn;
		console.error = originalError;
	}

	assert.deepEqual(output, [
		[ "warn", "[WARN] [Test] warning" ],
		[ "error", "[ERROR] [Test] error" ],
		[ "log", `[WebSub] Update notification received: 61 bytes` ],
		[ "log", "✅ Received 1 new video(s) from WebSub" ]
	]);
});

test("不正なYouTube WebSub通知を成功扱いしない", async () => {
	const output = [];
	const originalError = console.error;
	console.error = message => output.push(message);

	try {
		const updater = Object.create(YouTubeWebSubUpdater.prototype);
		updater.youtubeWebsub = new YouTubeWebSub("verify-token", "test-secret");
		updater.youtubeNoticesCache = {
			addAsync: async () => assert.fail("不正な通知をキャッシュしてはいけません")
		};
		const response = await updater.handleYoutubeWebhook(new Request("https://example.com/webhooks/youtube", {
			method: "POST",
			body: "<feed></feed>"
		}));

		assert.equal(response.status, 400);
	}
	finally {
		console.error = originalError;
	}

	assert.deepEqual(output, [ "[WebSub] No signature" ]);
});
