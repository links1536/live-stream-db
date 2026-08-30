import { resolve } from "node:path";
import { estimateFreeTierUsage } from "../src/free_tier_usage_estimator.js";
import { loadMasterStatistics } from "./master_data_counter.mjs";

function formatNumber(value) {
	return new Intl.NumberFormat("ja-JP", {
		maximumFractionDigits: 1,
	}).format(value);
}

function formatUsage(label, value) {
	const amount = value.maximumAmount === undefined
		? formatNumber(value.amount)
		: `${formatNumber(value.amount)}–${formatNumber(value.maximumAmount)}`;
	const percentage = value.maximumPercentage === undefined
		? `${value.percentage.toFixed(2)}%`
		: `${value.percentage.toFixed(2)}–${value.maximumPercentage.toFixed(2)}%`;
	return `${label.padEnd(16)} ${amount.padStart(16)} / ${formatNumber(value.limit).padStart(8)} (${percentage})`;
}

const dataDirectory = resolve(process.argv[2] ?? "../live-stream-db-data/data");
const master = await loadMasterStatistics(dataDirectory);
if (process.argv[3] !== undefined) {
	const youtubeTrackedItemCount = Number(process.argv[3]);
	if (!Number.isInteger(youtubeTrackedItemCount) || youtubeTrackedItemCount < 0)
		throw new TypeError("YouTube追跡件数は0以上の整数で指定してください");
	master.youtubeTrackedItemCount = youtubeTrackedItemCount;
}
const estimate = estimateFreeTierUsage(master.creatorCount, master);

console.log(`マスターデータ: ${dataDirectory}`);
console.log(`登録者数: ${formatNumber(estimate.creatorCount)}人`);
console.log(`登録ID: YouTube ${formatNumber(master.youtubeChannelCount)}、Twitch ${formatNumber(master.twitchUserCount)}、TwitCasting ${formatNumber(master.twitcastingUserCount)}`);
console.log("");
console.log("想定通知数");
console.log(`  配信: ${formatNumber(estimate.workload.streams)}件/日（1人につき1件）`);
console.log(`    YouTube ${formatNumber(estimate.workload.platformStreams.youtube)}、Twitch ${formatNumber(estimate.workload.platformStreams.twitch)}、TwitCasting ${formatNumber(estimate.workload.platformStreams.twitcasting)}`);
console.log(`  動画: ${formatNumber(estimate.workload.videos)}件/日（5人につき1件）`);
console.log(`  合計: ${formatNumber(estimate.workload.items)}件/日、${formatNumber(estimate.workload.monthlyItems)}件/30日`);
console.log("");
console.log("Cloudflare無料枠のコード経路ベース試算（日次）");
console.log(formatUsage("Workers requests", estimate.usage.workersRequests));
console.log(formatUsage("Queue operations", estimate.usage.queueOperations));
console.log(formatUsage("D1 rows written", estimate.usage.d1RowsWritten));
console.log(formatUsage("KV reads", estimate.usage.kvReads));
console.log(formatUsage("KV writes", estimate.usage.kvWrites));
console.log(formatUsage("DO requests", estimate.usage.durableObjectRequests));
console.log("");
console.log("実行内訳");
console.log(`  Cron: ${formatNumber(estimate.operations.scheduledWorkerInvocations)}回/日（YouTube 288回 + 日次2回）`);
console.log(`  YouTube追跡: ${formatNumber(estimate.master.youtubeTrackedItemCount)}件（${estimate.master.youtubeTrackedItemCountSource === "measured" ? "指定値" : "通知想定から推定"}）、${formatNumber(estimate.operations.youtubeBatchCount)}バッチ/回、Queue ${formatNumber(estimate.operations.youtubePollingQueueMessages)}件/日`);
console.log(`  WebSub購読同期: Queue ${formatNumber(estimate.operations.youtubeWebSubQueueMessages)}件、consumer ${formatNumber(estimate.operations.youtubeWebSubConsumerInvocationsMinimum)}–${formatNumber(estimate.operations.youtubeWebSubConsumerInvocationsMaximum)}回/日（最大10件/バッチ）`);
console.log(`  Twitch/TwitCasting整合: Queue ${formatNumber(estimate.operations.reconciliationQueueMessages)}件/日`);
console.log(`  整合処理による変更: ${formatNumber(estimate.operations.reconciliationDirtyRuns)}回/日（安全側の仮定）`);
console.log(`  変更発生YouTube更新: 期待値 ${formatNumber(estimate.operations.youtubeDirtyRuns)}回/日`);
console.log(`  Queue合計: ${formatNumber(estimate.operations.totalQueueMessages)}メッセージ、${formatNumber(estimate.usage.queueOperations.amount)}操作/日`);
console.log("");
console.log("前提: 複数プラットフォーム登録者は登録先から均等に1つを選び、動画はYouTube通知として扱います。");
console.log("YouTube通知は一日に均等・独立に発生すると仮定し、変更がある5分枠の期待値を算出しています。");
console.log("Queueは1メッセージにつき書き込み・読み取り・削除の3操作、WebSub consumerは既定の最大10件バッチです。");
console.log("D1書き込みは通知の基本状態遷移とTwitch通知履歴の定常的な削除を含みます。");
console.log("再試行、手動実行、追加の状態遷移、D1のインデックス書き込み・読み取り、CPU時間、DOストレージは含みません。");
