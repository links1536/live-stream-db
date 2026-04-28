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
	 */
	static checkAuth(authHeader, env) {
		try {
			const [scheme, encoded] = authHeader.split(" ");
			if (scheme !== "Basic") return false;

			const decoded = atob(encoded);
			const [user, pass] = decoded.split(":");

			// 環境変数 ADMIN_USERNAME / ADMIN_PASSWORD と照合
			const expectedUser = env.ADMIN_USERNAME;
			const expectedPass = env.ADMIN_PASSWORD;

			if (!expectedUser || !expectedPass) {
				// 設定されていない場合は認証失敗とする
				Log.error("AdminService", "Admin credentials are not set in environment variables.");
				return false;
			}

			return user === expectedUser && pass === expectedPass;
		}
		catch (e) {
			return false;
		}
	}

	/**
	 * 管理画面のHTMLテンプレート
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
			--bg-color: #121212;
			--card-bg: #1e1e1e;
			--text-color: #e0e0e0;
			--primary: #bb86fc;
			--secondary: #03dac6;
			--error: #cf6679;
			--success: #4caf50;
			--border: #333;
		}
		body {
			font-family: 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Meiryo', sans-serif;
			background-color: var(--bg-color);
			color: var(--text-color);
			margin: 0;
			display: flex;
			justify-content: center;
			align-items: center;
			min-height: 100vh;
		}
		.container {
			width: 100%;
			max-width: 600px;
			padding: 20px;
		}
		.card {
			background-color: var(--card-bg);
			border-radius: 12px;
			padding: 24px;
			box-shadow: 0 8px 32px rgba(0,0,0,0.5);
			border: 1px solid var(--border);
		}
		h1 {
			margin: 0 0 20px 0;
			font-size: 22px;
			color: var(--primary);
			text-align: center;
			border-bottom: 1px solid var(--border);
			padding-bottom: 16px;
		}
		.status-info {
			display: flex;
			justify-content: space-between;
			font-size: 13px;
			color: #888;
			margin-bottom: 20px;
			padding: 8px;
			background: #111;
			border-radius: 4px;
		}
		.btn-group {
			display: grid;
			gap: 12px;
			margin-bottom: 24px;
		}
		.btn {
			display: block;
			width: 100%;
			padding: 16px;
			border: none;
			border-radius: 8px;
			background-color: #2c2c2c;
			color: white;
			font-size: 15px;
			font-weight: bold;
			cursor: pointer;
			text-align: left;
			transition: all 0.2s;
			position: relative;
			overflow: hidden;
		}
		.btn:hover { background-color: #383838; }
		.btn:active { transform: translateY(1px); }
		.btn:disabled { opacity: 0.5; cursor: not-allowed; }

		.btn::before {
			content: '';
			position: absolute;
			left: 0;
			top: 0;
			bottom: 0;
			width: 4px;
		}
		.btn-websub::before { background-color: var(--primary); }
		.btn-rss::before { background-color: var(--secondary); }
		.btn-update::before { background-color: var(--success); }

		.btn-desc {
			display: block;
			font-size: 12px;
			font-weight: normal;
			color: #aaa;
			margin-top: 4px;
		}

		.console-wrapper {
			position: relative;
		}
		.console-header {
			font-size: 12px;
			color: #888;
			margin-bottom: 4px;
			display: flex;
			justify-content: space-between;
		}
		.console {
			background-color: #000;
			color: #00ff00;
			font-family: 'Consolas', 'Monaco', monospace;
			padding: 12px;
			border-radius: 6px;
			height: 200px;
			overflow-y: auto;
			font-size: 13px;
			line-height: 1.5;
			border: 1px solid var(--border);
		}
		.log-entry {
			margin-bottom: 4px;
			border-bottom: 1px solid #111;
			word-break: break-all;
		}
		.time { color: #888; margin-right: 8px; font-size: 11px; }
		.clear-btn {
			background: none;
			border: none;
			color: #666;
			cursor: pointer;
			font-size: 11px;
		}
		.clear-btn:hover { color: #999; }
	</style>
</head>
<body>
	<div class="container">
		<div class="card">
			<h1>live-stream-db Admin</h1>
			
			<div class="status-info">
				<span>Server Time: <span id="server-time">--:--:--</span></span>
				<span>Status: <span style="color:var(--success)">Online</span></span>
			</div>

			<div class="btn-group">
				<button class="btn btn-websub" id="btn-websub" onclick="trigger('/admin/youtube-websub-resister')">
					WebSub 一括再登録
					<span class="btn-desc">YouTubeのプッシュ通知を再登録します</span>
				</button>
				<button class="btn btn-rss" id="btn-rss" onclick="trigger('/admin/youtube-fetch-rss')">
					RSS 取得実行
					<span class="btn-desc">全チャンネルのRSSをチェックし、新着を通知キャッシュに追加します</span>
				</button>
				<button class="btn btn-update" id="btn-update" onclick="trigger('/admin/youtube-update')">
					スケジュール情報更新
					<span class="btn-desc">動画情報を取得し、lives.jsonを最新化します</span>
				</button>
			</div>

			<div class="console-wrapper">
				<div class="console-header">
					<span>Execution Log</span>
					<button class="clear-btn" onclick="clearLog()">Clear</button>
				</div>
				<div class="console" id="console">
					<div class="log-entry">管理コンソールに接続しました</div>
				</div>
			</div>
		</div>
	</div>

	<script>
		const consoleDiv = document.getElementById('console');
		
		function updateTime() {
			const now = new Date();
			document.getElementById('server-time').innerText = now.toLocaleTimeString();
		}
		setInterval(updateTime, 1000);
		updateTime();

		function log(msg, type = 'info') {
			const entry = document.createElement('div');
			entry.className = 'log-entry';
			const now = new Date().toLocaleTimeString();
			let color = 'inherit';
			if (type === 'error') color = 'var(--error)';
			if (type === 'success') color = 'var(--success)';
			
			entry.innerHTML = \`<span class="time">[\${now}]</span><span style="color:\${color}">\${msg}</span>\`;
			consoleDiv.prepend(entry);
		}

		function clearLog() {
			consoleDiv.innerHTML = '<div class="log-entry">ログをクリアしました</div>';
		}

		async function trigger(path) {
			const buttons = document.querySelectorAll('.btn');
			buttons.forEach(b => b.disabled = true);
			
			const actionName = path.split('/').pop();
			log(\`実行開始: \${actionName}...\`);
			
			try {
				const res = await fetch(path, {
					method: 'GET',
					headers: { 'X-Requested-With': 'XMLHttpRequest' }
				});
				const text = await res.text();
				
				if (res.ok) {
					log(\`完了: \${text}\`, 'success');
				} else {
					log(\`エラー (\${res.status}): \${text}\`, 'error');
				}
			}
			catch (err) {
				log(\`通信失敗: \${err.message}\`, 'error');
			}
			finally {
				buttons.forEach(b => b.disabled = false);
			}
		}
	</script>
</body>
</html>
		`;
	}
}
