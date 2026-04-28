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
		/* デザインシステム: 配色とフォントの定義 */
		:root {
			--bg: #0a0a0c;
			--surface: #16161e;
			--surface-hover: #1f1f28;
			--primary: #7aa2f7;
			--secondary: #bb9af7;
			--success: #9ece6a;
			--error: #f7768e;
			--warning: #e0af68;
			--text: #c0caf5;
			--text-muted: #565f89;
			--border: rgba(255, 255, 255, 0.05);
			--font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
		}

		* { box-sizing: border-box; }
		body {
			background-color: var(--bg);
			/* 背景にモダンなグラデーションのアクセントを追加 */
			background-image: radial-gradient(circle at top right, rgba(122, 162, 247, 0.05), transparent),
			                  radial-gradient(circle at bottom left, rgba(187, 154, 247, 0.05), transparent);
			color: var(--text);
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
			margin: 0;
			display: flex;
			justify-content: center;
			padding: 40px 20px;
			min-height: 100vh;
		}

		.app-container {
			width: 100%;
			max-width: 800px;
			display: flex;
			flex-direction: column;
			gap: 24px;
		}

		header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding-bottom: 8px;
		}

		/* タイトル部分: グラデーションテキスト */
		.title-area h1 {
			margin: 0;
			font-size: 24px;
			font-weight: 800;
			letter-spacing: -0.5px;
			background: linear-gradient(to right, var(--primary), var(--secondary));
			-webkit-background-clip: text;
			-webkit-text-fill-color: transparent;
		}

		.title-area p {
			margin: 4px 0 0 0;
			font-size: 13px;
			color: var(--text-muted);
		}

		/* ステータスバー: サーバー情報等の表示 */
		.stats-bar {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
			gap: 16px;
		}

		.stat-card {
			background: var(--surface);
			border: 1px solid var(--border);
			padding: 16px;
			border-radius: 12px;
			display: flex;
			flex-direction: column;
			gap: 4px;
		}

		.stat-label { font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 1px; }
		.stat-value { font-size: 18px; font-weight: 700; color: var(--primary); }

		/* アクションカード: 各機能のトリガーボタンを内包 */
		.actions-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
			gap: 16px;
		}

		.action-card {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: 16px;
			padding: 24px;
			transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
			display: flex;
			flex-direction: column;
			gap: 16px;
			position: relative;
		}

		.action-card:hover {
			border-color: rgba(122, 162, 247, 0.3);
			transform: translateY(-2px);
			background: var(--surface-hover);
		}

		.action-header {
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
		}

		.icon-box {
			width: 40px;
			height: 40px;
			border-radius: 10px;
			display: flex;
			align-items: center;
			justify-content: center;
			background: rgba(122, 162, 247, 0.1);
			color: var(--primary);
		}

		.action-info h3 { margin: 0; font-size: 16px; font-weight: 600; }
		.action-info p { margin: 4px 0 0 0; font-size: 13px; color: var(--text-muted); line-height: 1.4; }

		.btn-trigger {
			background: var(--primary);
			color: #000;
			border: none;
			padding: 12px;
			border-radius: 10px;
			font-size: 14px;
			font-weight: 700;
			cursor: pointer;
			transition: all 0.1s;
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 8px;
		}

		.btn-trigger:hover { filter: brightness(1.1); }
		.btn-trigger:active { transform: scale(0.98); }
		.btn-trigger:disabled { background: var(--text-muted); cursor: not-allowed; }

		/* 実行中を示すスピンアニメーション */
		.spinner {
			width: 16px;
			height: 16px;
			border: 2px solid rgba(0,0,0,0.1);
			border-top-color: #000;
			border-radius: 50%;
			animation: spin 0.6s linear infinite;
			display: none;
		}

		@keyframes spin { to { transform: rotate(360deg); } }

		/* 実行中状態のスタイル制御 */
		.executing .spinner { display: block; }
		.executing .btn-text { display: none; }

		/* ターミナル風ログセクション */
		.terminal-container {
			background: #000;
			border: 1px solid var(--border);
			border-radius: 16px;
			overflow: hidden;
			display: flex;
			flex-direction: column;
		}

		.terminal-header {
			background: #111;
			padding: 10px 16px;
			display: flex;
			justify-content: space-between;
			align-items: center;
			border-bottom: 1px solid var(--border);
		}

		.terminal-dots { display: flex; gap: 6px; }
		.dot { width: 8px; height: 8px; border-radius: 50%; }
		.dot-r { background: #ff5f56; }
		.dot-y { background: #ffbd2e; }
		.dot-g { background: #27c93f; }

		.terminal-body {
			height: 250px;
			padding: 16px;
			overflow-y: auto;
			font-family: var(--font-mono);
			font-size: 13px;
			line-height: 1.6;
			display: flex;
			flex-direction: column-reverse; /* 新しいログを上にするために反転 */
		}

		.log-item { display: flex; gap: 12px; margin-bottom: 6px; }
		.log-ts { color: var(--text-muted); min-width: 80px; }
		.log-msg-info { color: var(--text); }
		.log-msg-success { color: var(--success); }
		.log-msg-error { color: var(--error); }
		.log-msg-warn { color: var(--warning); }

		.clear-log {
			background: none;
			border: none;
			color: var(--text-muted);
			font-size: 11px;
			cursor: pointer;
			text-transform: uppercase;
			letter-spacing: 0.5px;
		}

		.clear-log:hover { color: var(--text); }

		@media (max-width: 600px) {
			body { padding: 20px 12px; }
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
				<span class="stat-value" style="color:var(--secondary)">Basic Auth</span>
			</div>
		</div>

		<!-- 実行アクションエリア -->
		<main class="actions-grid">
			<!-- WebSub再登録 -->
			<div class="action-card">
				<div class="action-header">
					<div class="icon-box">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"></path><path d="M4 4a16 16 0 0 1 16 16"></path><circle cx="5" cy="19" r="1"></circle></svg>
					</div>
				</div>
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
				<div class="action-header">
					<div class="icon-box">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
					</div>
				</div>
				<div class="action-info">
					<h3>Manual RSS Fetch</h3>
					<p>最新のRSSフィードを即座にフェッチし、新着動画をキューへ投入します</p>
				</div>
				<button class="btn-trigger" onclick="runTask(this, '/admin/youtube-fetch-rss')" style="background:var(--secondary)">
					<div class="spinner"></div>
					<span class="btn-text">Check Feeds</span>
				</button>
			</div>

			<!-- スケジュール同期 -->
			<div class="action-card">
				<div class="action-header">
					<div class="icon-box">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>
					</div>
				</div>
				<div class="action-info">
					<h3>Full Sync Update</h3>
					<p>YouTube Data APIを使用して、全動画のステータスとJSONを最新化します</p>
				</div>
				<button class="btn-trigger" onclick="runTask(this, '/admin/youtube-update')" style="background:var(--success)">
					<div class="spinner"></div>
					<span class="btn-text">Sync Schedules</span>
				</button>
			</div>
		</main>

		<!-- ログ表示セクション -->
		<section class="terminal-container">
			<div class="terminal-header">
				<div class="terminal-dots">
					<div class="dot dot-r"></div>
					<div class="dot dot-y"></div>
					<div class="dot dot-g"></div>
				</div>
				<span style="font-size:11px; font-weight:700; color:var(--text-muted); font-family:var(--font-mono)">ADMIN@VTUBER-UPDATER: ~</span>
			</div>
			<div class="terminal-body" id="logs">
				<!-- ここにJavaScriptでログが追加されます -->
				<div class="log-item"><span class="log-ts">[SYSTEM]</span><span class="log-msg-info">Waiting for commands...</span></div>
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
		function appendLog(msg, type = 'info') {
			const item = document.createElement('div');
			item.className = 'log-item';
			const ts = new Date().toLocaleTimeString('ja-JP', { hour12: false });
			item.innerHTML = \`<span class="log-ts">[\${ts}]</span><span class="log-msg-\${type}">\${msg}</span>\`;
			logContainer.prepend(item);
		}

		/**
		 * ログ履歴をクリアします
		 */
		function clearLogs() {
			logContainer.innerHTML = '';
			appendLog('Logs cleared.', 'warn');
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
			
			appendLog(\`Starting task: \${taskName}...\`, 'info');

			try {
				// APIリクエストの送信
				const response = await fetch(endpoint, {
					headers: { 'X-Requested-With': 'XMLHttpRequest' }
				});
				const result = await response.text();

				if (response.ok) {
					appendLog(\`SUCCESS: \${result}\`, 'success');
				} else {
					appendLog(\`FAILED (\${response.status}): \${result}\`, 'error');
				}
			}
			catch (err) {
				appendLog(\`NETWORK ERROR: \${err.message}\`, 'error');
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
