import assert from "node:assert/strict";
import test from "node:test";

import { Log } from "../src/log.js";

test("新規YouTube WebSub通知だけを出力する", () => {
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
		Log.rawInfo(true, "new video");
	}
	finally {
		console.log = originalLog;
		console.warn = originalWarn;
		console.error = originalError;
	}

	assert.deepEqual(output, [
		[ "warn", "[WARN] [Test] warning" ],
		[ "error", "[ERROR] [Test] error" ],
		[ "log", "new video" ]
	]);
});
