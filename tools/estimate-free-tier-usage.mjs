import { resolve } from "node:path";
import { estimateFreeTierUsage } from "../src/free_tier_usage_estimator.js";
import { loadMasterStatistics } from "./master_data_counter.mjs";

function formatNumber(value) {
	return new Intl.NumberFormat("ja-JP", {
		maximumFractionDigits: 1,
	}).format(value);
}

function formatUsage(label, value) {
	return `${label.padEnd(16)} ${formatNumber(value.amount).padStart(8)} / ${formatNumber(value.limit).padStart(8)} (${value.percentage.toFixed(2)}%)`;
}

const dataDirectory = resolve(process.argv[2] ?? "../live-stream-db-data/data");
const master = await loadMasterStatistics(dataDirectory);
const estimate = estimateFreeTierUsage(master.creatorCount, master);

console.log(`マスターデータ: ${dataDirectory}`);
console.log(`登録者数: ${formatNumber(estimate.creatorCount)}人`);
console.log(`登録ID: YouTube ${formatNumber(master.youtubeChannelCount)}、Twitch ${formatNumber(master.twitchUserCount)}、TwitCasting ${formatNumber(master.twitcastingUserCount)}`);
console.log("");
console.log("想定通知数");
console.log(`  配信: ${formatNumber(estimate.workload.streams)}件/日（1人につき1件）`);
console.log(`  動画: ${formatNumber(estimate.workload.videos)}件/日（5人につき1件）`);
console.log(`  合計: ${formatNumber(estimate.workload.items)}件/日、${formatNumber(estimate.workload.monthlyItems)}件/30日`);
console.log("");
console.log("Cloudflare無料枠の単純試算（日次）");
console.log(formatUsage("Workers requests", estimate.usage.workersRequests));
console.log(formatUsage("Queue operations", estimate.usage.queueOperations));
console.log(formatUsage("D1 rows written", estimate.usage.d1RowsWritten));
console.log(formatUsage("KV reads", estimate.usage.kvReads));
console.log(formatUsage("KV writes", estimate.usage.kvWrites));
console.log("");
console.log(`通知処理: Worker ${formatNumber(estimate.operations.notificationWorkerInvocations)}回、Queue ${formatNumber(estimate.operations.notificationQueueMessages)}メッセージ/日`);
console.log(`定期処理: Cron Worker ${formatNumber(estimate.operations.scheduledWorkerInvocations)}回、Queue ${formatNumber(estimate.operations.scheduledQueueMessages)}メッセージ/日`);
console.log("前提: 通知1件を受信・処理・出力のWorker 3回、処理・出力のQueue 2メッセージとして安全側に試算。");
console.log("D1は通知1行と日次購読対象更新、KVは通知2書き込みとYouTube定期更新288読み取りとして試算。");
console.log("再試行、D1のインデックス書き込み・読み取り、データ容量、YouTube更新が1回で複数バッチになる場合は含みません。");
