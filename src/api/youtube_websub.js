import { HttpUtils } from '../httputils.js'

/**
 * YouTube WebSub (PubSubHubbub) の通知を解析するクラス
 */
export class YouTubeWebSub
{
	constructor(verifyToken, secret)
	{
		this.verifyToken = verifyToken;
		this.secret = secret;
	}

	/**
	 * WebSubを登録する
	 */
	async registerWebSub(callbackUrl, channelId)
	{
		const hubUrl = "https://pubsubhubbub.appspot.com/subscribe";
		const topicUrl = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;

		const params = new URLSearchParams({
			"hub.mode": "subscribe",
			"hub.topic": topicUrl,
			"hub.callback": callbackUrl,
			"hub.verify": "async",
			"hub.lease_seconds": "432000" // 5日間
		});

		if (this.verifyToken) {
			params.append("hub.verify_token", this.verifyToken);
		}
		if (this.secret) {
			params.append("hub.secret", this.secret);
		}

		const headers = {
			"Content-Type": "application/x-www-form-urlencoded"
		};

		const response = await HttpUtils.post(hubUrl, headers, params.toString());
		return response.status === 202;
	}

	/**
	 * GET リクエスト (購読検証) を処理
	 */
	async processGet(request)
	{
		const { searchParams } = new URL(request.url);

		const mode = searchParams.get("hub.mode");
		const topic = searchParams.get("hub.topic");
		const challenge = searchParams.get("hub.challenge");

		if (mode === "subscribe") {
			if (challenge) {
				const verifyToken = searchParams.get("hub.verify_token");
				if (verifyToken !== this.verifyToken) {
					console.error(`[WebSub] Invalid verify token: topic=${topic}`);
					return HttpUtils.response("Forbidden", { "Status": 403 });
				}

				console.log(`[WebSub] Subscribe request: topic=${topic}`);
				return HttpUtils.response(challenge, { "Content-Type": "text/plain" });
			}
		}
		else if (mode === "unsubscribe") {
			console.log(`[WebSub] Unsubscribe request: topic=${topic}`);
			return HttpUtils.response("OK", { "Content-Type": "text/plain" });
		}

		console.error(`[WebSub] Unknown mode: mode=${mode}`);
		return HttpUtils.response("Not Found", { "Status": 404 });
	}

	/**
	 * POST リクエスト (更新通知) を処理
	 */
	async processPost(request)
	{
		const body = await request.text();
		if (!body)
			return null;

		const signature = request.headers.get("x-hub-signature");
		if (!signature) {
			console.error("[WebSub] No signature");
			return null;
		}

		// HMAC-SHA1 署名の検証
		const isValid = await this.verifySignature(body, signature);
		if (!isValid) {
			console.error("[WebSub] Invalid signature");
			return null;
		}

		console.log(`[WebSub] Update notification received: ${body.length} bytes`);
		return this.parseNotification(body);
	}

	/**
	 * HMAC-SHA1 署名の検証ロジック
	 */
	async verifySignature(body, signature)
	{
		// Secretが設定されていない場合は検証スキップ
		if (!this.secret)
			return true;

		const encoder = new TextEncoder();
		const keyData = encoder.encode(this.secret);
		const bodyData = encoder.encode(body);

		// CryptoKeyの生成
		const key = await crypto.subtle.importKey(
			"raw",
			keyData,
			{ name: "HMAC", hash: "SHA-1" },
			false,
			["sign"]
		);

		// 署名の生成
		const signatureBuffer = await crypto.subtle.sign("HMAC", key, bodyData);

		// 16進数文字列に変換
		const hashArray = Array.from(new Uint8Array(signatureBuffer));
		const expectedSignature = "sha1=" + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

		return signature === expectedSignature;
	}

	/**
	 * 通知のXMLボディを解析
	 */
	parseNotification(body)
	{
		const videoIds = [];
		try {
			// 正規表現による軽量パース (Workers環境にDOMParserがないため)
			const entryMatches = body.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
			for (const match of entryMatches) {
				const videoIdMatch = match[1].match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
				if (videoIdMatch) {
					videoIds.push(videoIdMatch[1]);
				}
			}
		}
		catch (e) {
			console.error(`[WebSub] XML Parse Error: ${e.message}`);
		}
		return videoIds;
	}
}