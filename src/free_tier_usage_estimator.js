export const FREE_TIER_LIMITS = Object.freeze({
	workersRequests: 100_000,
	queueOperations: 10_000,
	d1RowsWritten: 100_000,
	kvReads: 100_000,
	kvWrites: 1_000,
	durableObjectRequests: 100_000,
});

export const CODE_PATH_ASSUMPTIONS = Object.freeze({
	youtubeUpdatesPerDay: 24 * 60 / 5,
	dailyCronRuns: 2,
	youtubeBatchSize: 50,
	twitchBatchSize: 50,
	twitcastingBatchSize: 15,
	webSubConsumerBatchSize: 10,
	reconciliationDirtyRuns: 1,
});

function usage(amount, limit, maximumAmount = amount) {
	const result = {
		amount,
		limit,
		percentage: amount / limit * 100,
	};
	if (maximumAmount !== amount) {
		result.maximumAmount = maximumAmount;
		result.maximumPercentage = maximumAmount / limit * 100;
	}
	return result;
}

function expectedOccupiedRuns(itemCount, runCount) {
	if (itemCount <= 0)
		return 0;
	return runCount * (1 - Math.pow((runCount - 1) / runCount, itemCount));
}

function validateCount(value, label) {
	if (!Number.isInteger(value) || value < 0)
		throw new TypeError(`${label}は0以上の整数である必要があります`);
}

function estimatePlatformDistribution(creatorCount, combinations) {
	const hasCombinations = combinations !== undefined && combinations !== null;
	const values = {
		youtubeOnly: hasCombinations ? combinations.youtubeOnly ?? 0 : creatorCount,
		twitchOnly: combinations?.twitchOnly ?? 0,
		twitcastingOnly: combinations?.twitcastingOnly ?? 0,
		youtubeTwitch: combinations?.youtubeTwitch ?? 0,
		youtubeTwitcasting: combinations?.youtubeTwitcasting ?? 0,
		twitchTwitcasting: combinations?.twitchTwitcasting ?? 0,
		allThree: combinations?.allThree ?? 0,
	};
	for (const [ key, value ] of Object.entries(values))
		validateCount(value, `platformCombinations.${key}`);

	if (Object.values(values).reduce((sum, value) => sum + value, 0) !== creatorCount)
		throw new TypeError("platformCombinationsの合計はcreatorCountと一致する必要があります");

	return {
		youtube: values.youtubeOnly + values.youtubeTwitch / 2 + values.youtubeTwitcasting / 2 + values.allThree / 3,
		twitch: values.twitchOnly + values.youtubeTwitch / 2 + values.twitchTwitcasting / 2 + values.allThree / 3,
		twitcasting: values.twitcastingOnly + values.youtubeTwitcasting / 2 + values.twitchTwitcasting / 2 + values.allThree / 3,
	};
}

export function estimateFreeTierUsage(creatorCount, master = {}) {
	validateCount(creatorCount, "creatorCount");

	const youtubeChannelCount = master.youtubeChannelCount ?? 0;
	const twitchUserCount = master.twitchUserCount ?? 0;
	const twitcastingUserCount = master.twitcastingUserCount ?? 0;
	validateCount(youtubeChannelCount, "youtubeChannelCount");
	validateCount(twitchUserCount, "twitchUserCount");
	validateCount(twitcastingUserCount, "twitcastingUserCount");

	const platformStreams = estimatePlatformDistribution(creatorCount, master.platformCombinations);
	const streams = creatorCount;
	const videos = creatorCount / 5;
	const items = streams + videos;
	const youtubeNotifications = platformStreams.youtube + videos;
	const inferredTrackedItemCount = Math.ceil(youtubeNotifications);
	const youtubeTrackedItemCount = master.youtubeTrackedItemCount ?? inferredTrackedItemCount;
	validateCount(youtubeTrackedItemCount, "youtubeTrackedItemCount");

	const youtubeHasTrackedItems = youtubeTrackedItemCount > 0 || youtubeNotifications > 0;
	const youtubeBatchCount = youtubeHasTrackedItems
		? Math.max(1, Math.ceil(youtubeTrackedItemCount / CODE_PATH_ASSUMPTIONS.youtubeBatchSize))
		: 1;
	const youtubePollingQueueMessages = CODE_PATH_ASSUMPTIONS.youtubeUpdatesPerDay * youtubeBatchCount;
	const youtubeDirtyRuns = expectedOccupiedRuns(
		youtubeNotifications,
		CODE_PATH_ASSUMPTIONS.youtubeUpdatesPerDay,
	);
	const youtubeWebSubQueueMessages = youtubeChannelCount;
	const youtubeWebSubConsumerInvocationsMinimum = Math.ceil(
		youtubeWebSubQueueMessages / CODE_PATH_ASSUMPTIONS.webSubConsumerBatchSize,
	);
	const youtubeWebSubConsumerInvocationsMaximum = youtubeWebSubQueueMessages;
	const twitchReconciliationBatches = twitchUserCount > 0
		? Math.ceil(twitchUserCount / CODE_PATH_ASSUMPTIONS.twitchBatchSize)
		: 1;
	const twitcastingReconciliationBatches = twitcastingUserCount > 0
		? Math.ceil(twitcastingUserCount / CODE_PATH_ASSUMPTIONS.twitcastingBatchSize)
		: 1;
	const reconciliationQueueMessages = twitchReconciliationBatches + twitcastingReconciliationBatches;
	const reconciliationDirtyRuns = twitchUserCount + twitcastingUserCount > 0
		? CODE_PATH_ASSUMPTIONS.reconciliationDirtyRuns
		: 0;
	const notificationQueueMessages = platformStreams.twitch;
	const outputQueueMessages = youtubeDirtyRuns + reconciliationDirtyRuns;
	const totalQueueMessages = youtubePollingQueueMessages
		+ youtubeWebSubQueueMessages
		+ reconciliationQueueMessages
		+ notificationQueueMessages
		+ outputQueueMessages;

	const scheduledWorkerInvocations = CODE_PATH_ASSUMPTIONS.youtubeUpdatesPerDay
		+ CODE_PATH_ASSUMPTIONS.dailyCronRuns;
	const notificationWorkerInvocations = items;
	const queueConsumerInvocations = youtubePollingQueueMessages
		+ youtubeWebSubConsumerInvocationsMinimum
		+ reconciliationQueueMessages
		+ notificationQueueMessages
		+ outputQueueMessages;
	const maximumQueueConsumerInvocations = queueConsumerInvocations
		- youtubeWebSubConsumerInvocationsMinimum
		+ youtubeWebSubConsumerInvocationsMaximum;

	const youtubeDurableObjectRequestsPerRun = youtubeHasTrackedItems ? 7 + youtubeBatchCount * 2 : 4;
	const youtubeDurableObjectRequests = CODE_PATH_ASSUMPTIONS.youtubeUpdatesPerDay
		* youtubeDurableObjectRequestsPerRun;
	const reconciliationDurableObjectRequests = 4
		+ (twitchUserCount > 0 ? 2 + twitchReconciliationBatches : 0)
		+ (twitcastingUserCount > 0 ? 2 + twitcastingReconciliationBatches : 0);
	const durableObjectRequests = youtubeNotifications
		+ youtubeDurableObjectRequests
		+ reconciliationDurableObjectRequests;

	const subscriptionTargetWrites = youtubeChannelCount + twitchUserCount + twitcastingUserCount;
	const d1RowsWritten = subscriptionTargetWrites
		+ youtubeNotifications
		+ platformStreams.twitch * 4
		+ platformStreams.twitcasting
		+ reconciliationDirtyRuns;
	const kvWrites = youtubeDirtyRuns * 2
		+ platformStreams.twitch
		+ platformStreams.twitcasting
		+ reconciliationDirtyRuns;

	return {
		creatorCount,
		master: {
			youtubeChannelCount,
			twitchUserCount,
			twitcastingUserCount,
			youtubeTrackedItemCount,
			youtubeTrackedItemCountSource: master.youtubeTrackedItemCount === undefined ? "inferred" : "measured",
		},
		workload: {
			streams,
			platformStreams,
			videos,
			items,
			youtubeNotifications,
			monthlyItems: items * 30,
		},
		operations: {
			notificationWorkerInvocations,
			notificationQueueMessages,
			scheduledWorkerInvocations,
			queueConsumerInvocations,
			youtubeBatchCount,
			youtubePollingQueueMessages,
			youtubeWebSubQueueMessages,
			youtubeWebSubConsumerInvocations: youtubeWebSubConsumerInvocationsMinimum,
			youtubeWebSubConsumerInvocationsMinimum,
			youtubeWebSubConsumerInvocationsMaximum,
			reconciliationQueueMessages,
			reconciliationDirtyRuns,
			outputQueueMessages,
			youtubeDirtyRuns,
			totalQueueMessages,
			durableObjectRequests,
		},
		usage: {
			workersRequests: usage(
				notificationWorkerInvocations + scheduledWorkerInvocations + queueConsumerInvocations,
				FREE_TIER_LIMITS.workersRequests,
				notificationWorkerInvocations + scheduledWorkerInvocations + maximumQueueConsumerInvocations,
			),
			queueOperations: usage(
				totalQueueMessages * 3,
				FREE_TIER_LIMITS.queueOperations,
			),
			d1RowsWritten: usage(d1RowsWritten, FREE_TIER_LIMITS.d1RowsWritten),
			kvReads: usage(CODE_PATH_ASSUMPTIONS.youtubeUpdatesPerDay, FREE_TIER_LIMITS.kvReads),
			kvWrites: usage(kvWrites, FREE_TIER_LIMITS.kvWrites),
			durableObjectRequests: usage(durableObjectRequests, FREE_TIER_LIMITS.durableObjectRequests),
		},
	};
}
