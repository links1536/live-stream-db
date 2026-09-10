import { Log } from "./log.js";
import { estimateFreeTierUsage } from "./free_tier_usage_estimator.js";
import { VTuberRepository } from "./repository/vtuber_repository.js";

/**
 * 管理画面（ダッシュボード）を表示・制御するサービス
 */
export class AdminService {
	/**
	 * KVに保存されているlives.jsonをダウンロード用レスポンスとして返す
	 *
	 * @param {Object} env - 環境変数
	 * @returns {Promise<Response>} lives.jsonのダウンロードレスポンス
	 */
	static async downloadLivesJsonAsync(env) {
		try {
			const livesJson = await env.KV_OUTPUT.get("lives.json");
			if (livesJson === null) {
				return new Response("lives.json has not been generated", {
					status: 404,
					headers: { "Content-Type": "text/plain; charset=utf-8" }
				});
			}

			return new Response(livesJson, {
				headers: {
					"Content-Type": "application/json; charset=utf-8",
					"Content-Disposition": 'attachment; filename="lives.json"',
					"Cache-Control": "no-store",
					"X-Content-Type-Options": "nosniff"
				}
			});
		}
		catch (e) {
			Log.error("AdminService", `lives.jsonの取得に失敗しました: ${e}`);
			return new Response("Failed to load lives.json", {
				status: 500,
				headers: { "Content-Type": "text/plain; charset=utf-8" }
			});
		}
	}

	/**
	 * 管理画面のHTMLを返す（認証を含む）
	 */
	static async handleRequest(request, env) {
		// ベーシック認証の確認
		const authHeader = request.headers.get("Authorization");
		if (!authHeader || !this.checkAuth(authHeader, env)) {
			return new Response("Unauthorized", {
				status: 401,
				headers: {
					"WWW-Authenticate": 'Basic realm="Admin Dashboard", charset="UTF-8"',
					"Content-Type": "text/plain; charset=utf-8"
				}
			});
		}

		let estimate = null;
		try {
			const repository = new VTuberRepository(env.DB);
			const master = await repository.loadUsageStatisticsAsync();
			estimate = estimateFreeTierUsage(master.creatorCount, master);
		}
		catch (e) {
			Log.error("AdminService", `無料枠の消費量試算に失敗しました: ${e}`);
		}

		const html = this.getHtml(estimate);
		return new Response(html, {
			headers: { "Content-Type": "text/html; charset=utf-8" }
		});
	}

	/**
	 * ベーシック認証の照合
	 * 
	 * @param {string} authHeader - Authorizationヘッダーの値
	 * @param {Object} env - 環境変数
	 * @returns {boolean} 認証成功ならtrue
	 */
	static checkAuth(authHeader, env) {
		try {
			// "Basic [Base64文字列]" の形式を分割
			const [scheme, encoded] = authHeader.split(" ");
			if (scheme !== "Basic") return false;

			// Base64をデコードして "user:pass" 形式を取得
			const decoded = atob(encoded);
			const [user, pass] = decoded.split(":");

			// 環境変数 ADMIN_USERNAME / ADMIN_PASSWORD と照合
			const expectedUser = env.ADMIN_USERNAME;
			const expectedPass = env.ADMIN_PASSWORD;

			if (!expectedUser || !expectedPass) {
				// 設定されていない場合は認証失敗とする
				Log.error("AdminService", "管理者認証情報（ADMIN_USERNAME/PASSWORD）が環境変数に設定されていません");
				return false;
			}

			// 文字列比較による認証
			return user === expectedUser && pass === expectedPass;
		}
		catch (e) {
			return false;
		}
	}

	/**
	 * 管理画面のHTMLテンプレート
	 * 
	 * @returns {string} HTML文字列
	 */
	static getHtml(estimate = null) {
		const formatNumber = value => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value);
		const formatPercentage = value => value.maximumPercentage === undefined
			? `${value.percentage.toFixed(2)}%`
			: `${value.percentage.toFixed(2)}–${value.maximumPercentage.toFixed(2)}%`;
		const usageRows = estimate === null
			? '<p class="estimate-unavailable">マスターデータを取得できなかったため、試算を表示できません。</p>'
			: `
			<div class="estimate-summary">
				<span><strong>${formatNumber(estimate.creatorCount)}</strong> 人</span>
				<span>配信 <strong>${formatNumber(estimate.workload.streams)}</strong> 件/日</span>
				<span>動画 <strong>${formatNumber(estimate.workload.videos)}</strong> 件/日</span>
				<span>合計 <strong>${formatNumber(estimate.workload.items)}</strong> 件/日</span>
				<span><strong>${formatNumber(estimate.workload.monthlyItems)}</strong> 件/30日</span>
			</div>
			<p class="estimate-note">配信内訳: YouTube ${formatNumber(estimate.workload.platformStreams.youtube)}件、Twitch ${formatNumber(estimate.workload.platformStreams.twitch)}件、TwitCasting ${formatNumber(estimate.workload.platformStreams.twitcasting)}件/日</p>
			<div class="estimate-grid">
				<div><span>Workers requests</span><strong>${formatPercentage(estimate.usage.workersRequests)}</strong></div>
				<div><span>Queue operations</span><strong>${formatPercentage(estimate.usage.queueOperations)}</strong></div>
				<div><span>D1 rows written</span><strong>${formatPercentage(estimate.usage.d1RowsWritten)}</strong></div>
				<div><span>KV reads</span><strong>${formatPercentage(estimate.usage.kvReads)}</strong></div>
				<div><span>KV writes</span><strong>${formatPercentage(estimate.usage.kvWrites)}</strong></div>
				<div><span>DO requests</span><strong>${formatPercentage(estimate.usage.durableObjectRequests)}</strong></div>
				<div><span>DO rows read</span><strong>${formatPercentage(estimate.usage.durableObjectRowsRead)}</strong></div>
				<div><span>DO rows written</span><strong>${formatPercentage(estimate.usage.durableObjectRowsWritten)}</strong></div>
			</div>`;

		return `
<!DOCTYPE html>
<html lang="ja">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>live-stream-db 管理コンソール</title>
	<style>
		:root {
			--text: #1a1a1a;
			--text-muted: #666;
			--bg: #f8f9fa;
			--surface: #ffffff;
			--border: #e0e0e0;
			--primary: #0066cc;
			--success: #28a745;
			--font-mono: 'Monaco', 'Courier New', monospace;
		}

		* { box-sizing: border-box; }
		body {
			background-color: var(--bg);
			color: var(--text);
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			margin: 0;
			padding: 32px 16px;
			min-height: 100vh;
		}

		.app-container {
			max-width: 900px;
			margin: 0 auto;
		}

		header {
			margin-bottom: 32px;
			border-bottom: 1px solid var(--border);
			padding-bottom: 16px;
			display: flex;
			justify-content: space-between;
			align-items: flex-start;
		}

		.title-area h1 {
			margin: 0 0 4px 0;
			font-size: 28px;
			font-weight: 600;
			color: var(--text);
		}

		.title-area p {
			margin: 0;
			font-size: 14px;
			color: var(--text-muted);
		}

		.stats-bar {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
			gap: 12px;
			margin-bottom: 32px;
		}

		.stat-card {
			background: var(--surface);
			border: 1px solid var(--border);
			padding: 12px 16px;
			border-radius: 4px;
		}

		.stat-label { 
			font-size: 11px;
			text-transform: uppercase;
			color: var(--text-muted);
			margin-bottom: 4px;
		}
		.stat-value { 
			font-size: 16px;
			font-weight: 600;
			color: var(--text);
		}

		.actions-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
			gap: 16px;
			margin-bottom: 32px;
		}

		.estimate-container {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: 4px;
			padding: 16px;
			margin-bottom: 32px;
		}

		.estimate-container h2 {
			font-size: 16px;
			margin: 0 0 6px;
		}

		.estimate-description, .estimate-note, .estimate-unavailable {
			color: var(--text-muted);
			font-size: 12px;
			margin: 0;
		}

		.estimate-summary {
			display: flex;
			flex-wrap: wrap;
			gap: 8px 20px;
			margin: 16px 0;
			font-size: 13px;
		}

		.estimate-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
			gap: 8px;
			margin-bottom: 12px;
		}

		.estimate-grid div {
			background: var(--bg);
			padding: 10px;
			display: flex;
			flex-direction: column;
			gap: 4px;
		}

		.estimate-grid span { color: var(--text-muted); font-size: 11px; }
		.estimate-grid strong { font-size: 16px; }
		.estimate-unavailable { margin-top: 16px; }

		.action-card {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: 4px;
			padding: 16px;
			transition: border-color 0.2s;
		}

		.action-card:hover {
			border-color: var(--primary);
		}

		.action-info h3 { 
			margin: 0 0 8px 0;
			font-size: 15px;
			font-weight: 600;
		}
		.action-info p { 
			margin: 0 0 12px 0;
			font-size: 13px;
			color: var(--text-muted);
		}

		.btn-trigger {
			background: var(--primary);
			color: white;
			border: none;
			padding: 8px 16px;
			border-radius: 4px;
			font-size: 13px;
			font-weight: 500;
			cursor: pointer;
			transition: background 0.2s;
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 6px;
			width: 100%;
		}

		.btn-trigger:hover { background: #0052a3; }
		.btn-trigger:active { transform: scale(0.98); }
		.btn-trigger:disabled { background: var(--border); cursor: not-allowed; }
		a.btn-trigger { text-decoration: none; }

		.spinner {
			width: 14px;
			height: 14px;
			border: 2px solid rgba(255,255,255,0.3);
			border-top-color: white;
			border-radius: 50%;
			animation: spin 0.6s linear infinite;
			display: none;
		}

		@keyframes spin { to { transform: rotate(360deg); } }

		.executing .spinner { display: block; }
		.executing .btn-text { display: none; }

		.terminal-container {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: 4px;
			overflow: hidden;
		}

		.terminal-header {
			background: #fafbfc;
			padding: 12px 16px;
			border-bottom: 1px solid var(--border);
			font-size: 11px;
			font-weight: 600;
			text-transform: uppercase;
			color: var(--text-muted);
			display: flex;
			justify-content: space-between;
		}

		.terminal-body {
			height: 200px;
			padding: 16px;
			overflow-y: auto;
			font-family: var(--font-mono);
			font-size: 12px;
			line-height: 1.5;
			color: var(--text);
			white-space: pre-wrap;
			word-wrap: break-word;
		}

		.log-item { display: none; }

		.clear-log {
			background: none;
			border: none;
			color: var(--text-muted);
			font-size: 12px;
			cursor: pointer;
			transition: color 0.2s;
		}

		.clear-log:hover { color: var(--text); }

		@media (max-width: 600px) {
			.actions-grid { grid-template-columns: 1fr; }
		}
	</style>
</head>
<body>
	<div class="app-container">
		<header>
			<div class="title-area">
				<h1>live-stream-db Admin</h1>
				<p>System Management & Manual Control</p>
			</div>
			<button class="clear-log" onclick="clearLogs()">Reset Logs</button>
		</header>

		<!-- 統計・状態表示エリア -->
		<div class="stats-bar">
			<div class="stat-card">
				<span class="stat-label">System Time</span>
				<div style="display: flex; flex-direction: column; gap: 2px;">
					<span class="stat-value" style="font-size: 16px;"><span id="clock-local">--:--:--</span> <small style="font-size: 10px; color: var(--text-muted); font-weight: 400;">LOCAL</small></span>
					<span class="stat-value" style="font-size: 16px;"><span id="clock-utc">--:--:--</span> <small style="font-size: 10px; color: var(--text-muted); font-weight: 400;">UTC</small></span>
				</div>
			</div>
			<div class="stat-card">
				<span class="stat-label">Worker Status</span>
				<span class="stat-value" style="color:var(--success)">Healthy</span>
			</div>
			<div class="stat-card">
				<span class="stat-label">Security</span>
				<span class="stat-value" style="color:var(--primary)">Basic Auth</span>
			</div>
		</div>

		<section class="estimate-container">
			<h2>Cloudflare Free Tier Estimate</h2>
			<p class="estimate-description">現在のマスターとYouTube追跡件数を基準に、実コードのCron・Queue・Worker・ストレージ操作を積み上げた目安です。</p>
			${usageRows}
			${estimate === null ? "" : `<p class="estimate-note">Cron ${formatNumber(estimate.operations.scheduledWorkerInvocations)}回、YouTube追跡 ${formatNumber(estimate.master.youtubeTrackedItemCount)}件・${formatNumber(estimate.operations.youtubeBatchCount)}バッチ/回、変更発生更新 ${formatNumber(estimate.operations.youtubeDirtyRuns)}回、Queue ${formatNumber(estimate.operations.totalQueueMessages)}メッセージ/日の想定です。</p>`}
			<p class="estimate-note">複数プラットフォーム登録者は登録先から均等に1つを選ぶと仮定しています。再試行、手動実行、追加の状態遷移、D1のインデックス書き込み・読み取り、CPU時間、DOの実行時間・保存容量は含みません。</p>
		</section>

		<!-- 実行アクションエリア -->
		<main class="actions-grid">
			<!-- WebSub再登録 -->
			<div class="action-card">
				<div class="action-info">
					<h3>YouTube WebSub Register</h3>
					<p>登録済みYouTube配信者のリアルタイム通知を再登録します</p>
				</div>
				<button class="btn-trigger" onclick="runTask(this, '/admin/youtube-websub-register')">
					<div class="spinner"></div>
					<span class="btn-text">Execute</span>
				</button>
			</div>

			<!-- WebSub未登録のみ登録 -->
			<div class="action-card">
				<div class="action-info">
					<h3>YouTube WebSub Register Missing</h3>
					<p>未登録、期限情報未取得、または期限切れのYouTube配信者だけを登録します</p>
				</div>
				<button class="btn-trigger" onclick="runTask(this, '/admin/youtube-websub-register-missing')">
					<div class="spinner"></div>
					<span class="btn-text">Execute</span>
				</button>
			</div>

			<!-- RSS手動フェッチ -->
			<div class="action-card">
				<div class="action-info">
					<h3>Manual RSS Fetch</h3>
					<p>最新のRSSフィードを取得し、新着動画候補を通知キャッシュへ投入します</p>
				</div>
				<button class="btn-trigger" onclick="runTask(this, '/admin/youtube-fetch-rss')">
					<div class="spinner"></div>
					<span class="btn-text">Execute</span>
				</button>
			</div>

			<!-- スケジュール同期 -->
			<div class="action-card">
				<div class="action-info">
					<h3>YouTube Schedule Update</h3>
					<p>YouTubeのスケジュール更新をトリガーし、完了後に必要なら lives.json を再生成します</p>
				</div>
				<button class="btn-trigger" onclick="runTask(this, '/admin/youtube-update')">
					<div class="spinner"></div>
					<span class="btn-text">Execute</span>
				</button>
			</div>

			<!-- Twitch同期 -->
			<div class="action-card">
				<div class="action-info">
					<h3>Twitch Stream Update</h3>
					<p>Twitchの配信更新をトリガーし、完了後に必要なら lives.json を再生成します</p>
				</div>
				<button class="btn-trigger" onclick="runTask(this, '/admin/twitch-update')">
					<div class="spinner"></div>
					<span class="btn-text">Execute</span>
				</button>
			</div>

			<!-- TwitCasting同期 -->
			<div class="action-card">
				<div class="action-info">
					<h3>TwitCasting Stream Update</h3>
					<p>ツイキャスの配信予定・配信中・過去配信を更新し、必要なら lives.json を再生成します</p>
				</div>
				<button class="btn-trigger" onclick="runTask(this, '/admin/twitcasting-update')">
					<div class="spinner"></div>
					<span class="btn-text">Execute</span>
				</button>
			</div>

			<!-- TwitCasting WebHook手動登録 -->
			<div class="action-card">
				<div class="action-info">
					<h3>TwitCasting WebHook Register</h3>
					<p>登録済みツイキャス配信者の全イベント通知を手動登録します</p>
				</div>
				<button class="btn-trigger" onclick="runTask(this, '/admin/twitcasting-webhook-register')">
					<div class="spinner"></div>
					<span class="btn-text">Execute</span>
				</button>
			</div>

			<!-- 全プラットフォーム通知購読同期 -->
			<div class="action-card">
				<div class="action-info">
					<h3>Webhook Subscription Sync</h3>
					<p>YouTube、Twitch、ツイキャスの通知購読をマスターと同期します</p>
				</div>
				<button class="btn-trigger" onclick="runTask(this, '/admin/webhook-subscriptions-sync')">
					<div class="spinner"></div>
					<span class="btn-text">Execute</span>
				</button>
			</div>

			<!-- 全体同期 -->
			<div class="action-card">
				<div class="action-info">
					<h3>Full Stream Update</h3>
					<p>YouTube、Twitch、ツイキャスの更新をトリガーし、すべて完了後に lives.json を再生成します</p>
				</div>
				<button class="btn-trigger" onclick="runTask(this, '/admin/full-update')">
					<div class="spinner"></div>
					<span class="btn-text">Execute</span>
				</button>
			</div>

			<!-- lives.jsonダウンロード -->
			<div class="action-card">
				<div class="action-info">
					<h3>Download lives.json</h3>
					<p>KV_OUTPUTに保存されている最新の lives.json をダウンロードします</p>
				</div>
				<a class="btn-trigger" href="/admin/lives.json" download="lives.json">
					<span class="btn-text">Download</span>
				</a>
			</div>
		</main>

		<!-- ログ表示セクション -->
		<section class="terminal-container">
			<div class="terminal-header">
				<span>API Response</span>
				<button class="clear-log" onclick="clearLogs()">Clear</button>
			</div>
			<div class="terminal-body" id="logs"><!-- ここにAPIレスポンスが表示されます --></div>
		</section>
	</div>

	<script>
		/**
		 * 時計の更新処理
		 */
		function updateClock() {
			const now = new Date();
			const options = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
			document.getElementById('clock-local').textContent = now.toLocaleTimeString('ja-JP', options);
			document.getElementById('clock-utc').textContent = now.toLocaleTimeString('ja-JP', { ...options, timeZone: 'UTC' });
		}
		setInterval(updateClock, 1000);
		updateClock();

		const logContainer = document.getElementById('logs');

		/**
		 * ターミナルにログメッセージを表示する
		 * @param {string} msg - 表示するメッセージ
		 * @param {string} type - info, success, error, warn
		 */
		/**
		 * ログ履歴をクリアします
		 */
		function clearLogs() {
			logContainer.innerHTML = '';
		}

		/**
		 * 指定されたエンドポイントを叩いて実行する
		 * 
		 * @param {HTMLElement} btn - クリックされたボタン要素
		 * @param {string} endpoint - 実行するAPIエンドポイント
		 */
		async function runTask(btn, endpoint) {
			const taskName = btn.closest('.action-card').querySelector('h3').textContent;
			
			// 二重送信防止のためボタンを無効化
			btn.disabled = true;
			btn.classList.add('executing');
			
			logContainer.innerHTML = \`Executing: \${taskName}\\n\`;

			try {
				// APIリクエストの送信
				const response = await fetch(endpoint, {
					method: 'POST',
					headers: { 'X-Requested-With': 'XMLHttpRequest' }
				});
				const result = await response.text();

				if (response.ok) {
					logContainer.innerHTML = \`✓ Success (HTTP \${response.status})\\n\\n\${result}\`;
				} else {
					logContainer.innerHTML = \`✗ Failed (HTTP \${response.status})\\n\\n\${result}\`;
				}
			}
			catch (err) {
				logContainer.innerHTML = \`✗ Error: \${err.message}\`;
			}
			finally {
				// 状態のリセット
				btn.disabled = false;
				btn.classList.remove('executing');
			}
		}
	</script>
</body>
</html>
		`;
	}
}
