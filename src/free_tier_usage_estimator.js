export const FREE_TIER_LIMITS = Object.freeze({
	workersRequests: 100_000,
	queueOperations: 10_000,
	d1RowsWritten: 100_000,
	kvWrites: 1_000,
});

function usage(amount, limit) {
	return {
		amount,
		limit,
		percentage: amount / limit * 100,
	};
}

export function estimateFreeTierUsage(creatorCount) {
	if (!Number.isInteger(creatorCount) || creatorCount < 0) {
		throw new TypeError("creatorCount は0以上の整数である必要があります");
	}

	const streams = creatorCount;
	const videos = creatorCount / 5;
	const items = streams + videos;

	return {
		creatorCount,
		workload: {
			streams,
			videos,
			items,
			monthlyItems: items * 30,
		},
		usage: {
			workersRequests: usage(items, FREE_TIER_LIMITS.workersRequests),
			queueOperations: usage(items * 3, FREE_TIER_LIMITS.queueOperations),
			d1RowsWritten: usage(items, FREE_TIER_LIMITS.d1RowsWritten),
			kvWrites: usage(items, FREE_TIER_LIMITS.kvWrites),
		},
	};
}
