import assert from "node:assert/strict";
import test from "node:test";

import { YouTubeScheduleUpdater } from "../src/updater/youtube_schedule_updater.js";

test("YouTubeの更新対象0件を共通のソース完了Queueへ渡す", async () => {
	const sent = [];
	const updater = Object.create(YouTubeScheduleUpdater.prototype);
	updater.youtubeRepository = {
		getScheduleIdsAsync: async () => []
	};
	updater.youtubeNoticesCache = {
		getAllAsync: async () => []
	};
	updater.updateSchedulesQueue = {
		send: async body => sent.push(JSON.parse(body))
	};

	await updater.scheduleTrigger("output-1");

	assert.deepEqual(sent, [{
		type: "stream_source_complete",
		output_run_id: "output-1",
		source: "youtube",
		dirty: false
	}]);
});
