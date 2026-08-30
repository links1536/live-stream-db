export const FREE_TIER_LIMITS = Object.freeze({
	workersRequests: 100_000,
	queueOperations: 10_000,
	d1RowsWritten: 100_000,
	kvReads: 100_000,
	kvWrites: 1_000,
});

const YOUTUBE_UPDATES_PER_DAY = 24 * 60 / 5;
const DAILY_CRON_RUNS = 2;
const TWITCH_BATCH_SIZE = 50;
const TWITCASTING_BATCH_SIZE = 15;

function usage(amount, limit) {
	return {
		amount,
		limit,
		percentage: amount / limit * 100,
	};
}

export function estimateFreeTierUsage(creatorCount, master = {}) {
	if (!Number.isInteger(creatorCount) || creatorCount < 0) {
		throw new TypeError("creatorCount は0以上の整数である必要があります");
	}

	const youtubeChannelCount = master.youtubeChannelCount ?? 0;
	const twitchUserCount = master.twitchUserCount ?? 0;
	const twitcastingUserCount = master.twitcastingUserCount ?? 0;
	for (const count of [ youtubeChannelCount, twitchUserCount, twitcastingUserCount ]) {
		if (!Number.isInteger(count) || count < 0)
			throw new TypeError("プラットフォーム登録数は0以上の整数である必要があります");
	}

	const streams = creatorCount;
	const videos = creatorCount / 5;
	const items = streams + videos;
	const scheduledWorkerInvocations = YOUTUBE_UPDATES_PER_DAY + DAILY_CRON_RUNS;
	const scheduledQueueMessages = YOUTUBE_UPDATES_PER_DAY
		+ youtubeChannelCount
		+ Math.ceil(twitchUserCount / TWITCH_BATCH_SIZE)
		+ Math.ceil(twitcastingUserCount / TWITCASTING_BATCH_SIZE);
	const notificationWorkerInvocations = items * 3;
	const notificationQueueMessages = items * 2;
	const subscriptionTargetWrites = youtubeChannelCount + twitchUserCount + twitcastingUserCount;

	return {
		creatorCount,
		master: {
			youtubeChannelCount,
			twitchUserCount,
			twitcastingUserCount,
		},
		workload: {
			streams,
			videos,
			items,
			monthlyItems: items * 30,
		},
		operations: {
			notificationWorkerInvocations,
			notificationQueueMessages,
			scheduledWorkerInvocations,
			scheduledQueueMessages,
		},
		usage: {
			workersRequests: usage(
				notificationWorkerInvocations + scheduledWorkerInvocations + scheduledQueueMessages,
				FREE_TIER_LIMITS.workersRequests,
			),
			queueOperations: usage(
				(notificationQueueMessages + scheduledQueueMessages) * 3,
				FREE_TIER_LIMITS.queueOperations,
			),
			d1RowsWritten: usage(items + subscriptionTargetWrites, FREE_TIER_LIMITS.d1RowsWritten),
			kvReads: usage(YOUTUBE_UPDATES_PER_DAY, FREE_TIER_LIMITS.kvReads),
			kvWrites: usage(items * 2, FREE_TIER_LIMITS.kvWrites),
		},
	};
}
