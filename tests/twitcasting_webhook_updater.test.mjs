import assert from "node:assert/strict";
import test from "node:test";

import { TwitCastingWebhookUpdater } from "../src/updater/twitcasting_webhook_updater.js";

const WebhookSignature = "test-signature";
const TargetMovieId = "840159598";

function createUpdater({ registered = true, repositoryChanged = false } = {})
{
	const calls = {
		deletedIds: [],
		outputUpdates: 0,
		upsertedStreams: []
	};
	const updater = Object.create(TwitCastingWebhookUpdater.prototype);
	updater.webhookSignature = WebhookSignature;
	updater.vtuberRepository = {
		loadTwitCastingMapAsync: async () => registered ? { test_user: {} } : {}
	};
	updater.twitcastingApi = {
		mapMovie: (movie, screenId, status) => ({
			twitcasting_id: String(movie.id),
			screen_id: screenId,
			status
		}),
		mapLiveSchedule: (schedule, screenId) => ({
			twitcasting_id: String(schedule.id),
			screen_id: screenId,
			status: "upcoming"
		})
	};
	updater.twitcastingStreamRepository = {
		deleteStreamByIdAsync: async twitcastingId => {
			calls.deletedIds.push(String(twitcastingId));
			return repositoryChanged;
		},
		upsertStreamAsync: async stream => {
			calls.upsertedStreams.push(stream);
			return repositoryChanged;
		}
	};
	updater.livesJsonUpdater = {
		saveDataJsonAsync: async () => {
			calls.outputUpdates += 1;
		}
	};
	return { updater, calls };
}

function createWebhookRequest(payload)
{
	return new Request("https://example.com/webhooks/twitcasting", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			signature: WebhookSignature,
			...payload
		})
	});
}

function createLiveEndRequest(isRecorded, isProtected = false)
{
	return createWebhookRequest({
		event: "liveend",
		movie: {
			id: TargetMovieId,
			is_recorded: isRecorded,
			is_protected: isProtected
		},
		broadcaster: { screen_id: "test_user" }
	});
}

test("開始通知で配信中として公開データを更新する", async () => {
	const { updater, calls } = createUpdater({ repositoryChanged: true });
	const request = createWebhookRequest({
		event: "livestart",
		movie: {
			id: TargetMovieId
		},
		broadcaster: { screen_id: "test_user" }
	});

	const response = await updater.handleWebhookAsync(request);

	assert.equal(response.status, 204);
	assert.deepEqual(calls.upsertedStreams, [{
		twitcasting_id: TargetMovieId,
		screen_id: "test_user",
		status: "live"
	}]);
	assert.equal(calls.outputUpdates, 1);
	assert.deepEqual(calls.deletedIds, []);
});

for (const event of ["liveschedulecreate", "livescheduleupdate"]) {
	test(`${event}通知で配信予定として公開データを更新する`, async () => {
		const { updater, calls } = createUpdater({ repositoryChanged: true });
		const request = createWebhookRequest({
			event,
			live_schedule: {
				id: "timetable-123",
				user_screen_id: "test_user"
			}
		});

		const response = await updater.handleWebhookAsync(request);

		assert.equal(response.status, 204);
		assert.deepEqual(calls.upsertedStreams, [{
			twitcasting_id: "timetable-123",
			screen_id: "test_user",
			status: "upcoming"
		}]);
		assert.equal(calls.outputUpdates, 1);
	});
}

test("配信予定削除通知で対象を削除して公開データを更新する", async () => {
	const { updater, calls } = createUpdater({ repositoryChanged: true });
	const request = createWebhookRequest({
		event: "livescheduledelete",
		live_schedule_id: "timetable-123"
	});

	const response = await updater.handleWebhookAsync(request);

	assert.equal(response.status, 204);
	assert.deepEqual(calls.deletedIds, ["timetable-123"]);
	assert.equal(calls.outputUpdates, 1);
});

test("署名が一致しない通知を拒否する", async () => {
	const { updater, calls } = createUpdater({ repositoryChanged: true });
	const request = createWebhookRequest({
		event: "livestart",
		signature: "invalid-signature",
		movie: { id: TargetMovieId },
		broadcaster: { screen_id: "test_user" }
	});

	const response = await updater.handleWebhookAsync(request);

	assert.equal(response.status, 401);
	assert.deepEqual(calls.upsertedStreams, []);
	assert.deepEqual(calls.deletedIds, []);
	assert.equal(calls.outputUpdates, 0);
});

test("録画なしの終了通知再送時も公開データを再生成する", async () => {
	const { updater, calls } = createUpdater();

	const response = await updater.handleWebhookAsync(createLiveEndRequest(false));

	assert.equal(response.status, 204);
	assert.deepEqual(calls.deletedIds, [TargetMovieId]);
	assert.deepEqual(calls.upsertedStreams, []);
	assert.equal(calls.outputUpdates, 1);
});

test("合言葉付き録画の終了通知再送時もアーカイブ化して公開データを再生成する", async () => {
	const { updater, calls } = createUpdater();

	const response = await updater.handleWebhookAsync(createLiveEndRequest(true, true));

	assert.equal(response.status, 204);
	assert.deepEqual(calls.deletedIds, []);
	assert.deepEqual(calls.upsertedStreams, [{
		twitcasting_id: TargetMovieId,
		screen_id: "test_user",
		status: "archived"
	}]);
	assert.equal(calls.outputUpdates, 1);
});

test("未登録ユーザーの終了通知では公開データを再生成しない", async () => {
	const { updater, calls } = createUpdater({ registered: false });

	const response = await updater.handleWebhookAsync(createLiveEndRequest(false));

	assert.equal(response.status, 204);
	assert.deepEqual(calls.deletedIds, []);
	assert.deepEqual(calls.upsertedStreams, []);
	assert.equal(calls.outputUpdates, 0);
});
