import { Log } from "./log.js";

/**
 * 管理画面（ダッシュボード）を表示・制御するサービス
 */
export class AdminService {
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

		const html = this.getHtml();
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
	static getHtml() {
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

		<!-- 実行アクションエリア -->
		<main class="actions-grid">
			<!-- WebSub再登録 -->
			<div class="action-card">
				<div class="action-info">
					<h3>WebSub Re-register</h3>
					<p>YouTubeのリアルタイム通知(PubSubHubbub)を全件強制登録します</p>
				</div>
				<button class="btn-trigger" onclick="runTask(this, '/admin/youtube-websub-resister')">
					<div class="spinner"></div>
					<span class="btn-text">Execute Now</span>
				</button>
			</div>

			<!-- RSS手動フェッチ -->
			<div class="action-card">
				<div class="action-info">
					<h3>Manual RSS Fetch</h3>
					<p>最新のRSSフィードを即座にフェッチし、新着動画をキューへ投入します</p>
				</div>
				<button class="btn-trigger" onclick="runTask(this, '/admin/youtube-fetch-rss')">
					<div class="spinner"></div>
					<span class="btn-text">Check Feeds</span>
				</button>
			</div>

			<!-- スケジュール同期 -->
			<div class="action-card">
				<div class="action-info">
					<h3>Full Sync Update</h3>
					<p>YouTube Data APIを使用して、全動画のステータスとJSONを最新化します</p>
				</div>
				<button class="btn-trigger" onclick="runTask(this, '/admin/youtube-update')">
					<div class="spinner"></div>
					<span class="btn-text">Sync Schedules</span>
				</button>
			</div>
		</main>

		<!-- ログ表示セクション -->
		<section class="terminal-container">
			<div class="terminal-header">
				<span>API Response</span>
				<button class="clear-log" onclick="clearLogs()">Clear</button>
			</div>
			<div class="terminal-body" id="logs">
				<!-- ここにAPIレスポンスが表示されます -->
			</div>
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
