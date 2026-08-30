import { resolve } from "node:path";
import { estimateFreeTierUsage } from "../src/free_tier_usage_estimator.js";
import { countCreators } from "./master_data_counter.mjs";

function formatNumber(value) {
	return new Intl.NumberFormat("ja-JP", {
		maximumFractionDigits: 1,
	}).format(value);
}

function formatUsage(label, value) {
	return `${label.padEnd(16)} ${formatNumber(value.amount).padStart(8)} / ${formatNumber(value.limit).padStart(8)} (${value.percentage.toFixed(2)}%)`;
}

const dataDirectory = resolve(process.argv[2] ?? "../live-stream-db-data/data");
const creatorCount = await countCreators(dataDirectory);
const estimate = estimateFreeTierUsage(creatorCount);

console.log(`マスターデータ: ${dataDirectory}`);
console.log(`登録者数: ${formatNumber(estimate.creatorCount)}人`);
console.log("");
console.log("想定コンテンツ数");
console.log(`  配信: ${formatNumber(estimate.workload.streams)}件/日（1人につき1件）`);
console.log(`  動画: ${formatNumber(estimate.workload.videos)}件/日（5人につき1件）`);
console.log(`  合計: ${formatNumber(estimate.workload.items)}件/日、${formatNumber(estimate.workload.monthlyItems)}件/30日`);
console.log("");
console.log("Cloudflare無料枠の単純試算（日次）");
console.log(formatUsage("Workers requests", estimate.usage.workersRequests));
console.log(formatUsage("Queue operations", estimate.usage.queueOperations));
console.log(formatUsage("D1 rows written", estimate.usage.d1RowsWritten));
console.log(formatUsage("KV writes", estimate.usage.kvWrites));
console.log("");
console.log("前提: 各配信・動画につき Worker 1回、Queueメッセージ1件（3操作）、D1書き込み1行、KV書き込み1回。");
console.log("ポーリング、再試行、購読同期、D1読み取り、データ容量は含みません。");
