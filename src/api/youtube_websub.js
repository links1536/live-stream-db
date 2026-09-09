import { HttpUtils } from '../httputils.js'
import { YouTubeDataAPI } from './youtube_data_api.js';
import { Log } from "../log.js";
import { LOG_FLAGS } from "../constants/log_flags.js";

/**
 * YouTube WebSub (PubSubHubbub) の通知を解析するクラス
 */
export class YouTubeWebSub
{
	constructor(verifyToken, secret)
	{
		Object.defineProperty(this, 'verifyToken', {
			value: verifyToken,
			writable: false,
			enumerable: false,
			configurable: false
		});
		
		Object.defineProperty(this, 'secret', {
			value: secret,
			writable: false,
			enumerable: false,
			configurable: false
		});
	}

	/**
	 * WebSubを登録する
	 */
	async registerWebSub(callbackUrl, channelId)
	{
		return await this.changeWebSub("subscribe", callbackUrl, channelId);
	}

	async unregisterWebSub(callbackUrl, channelId)
	{
		return await this.changeWebSub("unsubscribe", callbackUrl, channelId);
	}

	async changeWebSub(mode, callbackUrl, channelId)
	{
		if (!callbackUrl || (mode !== "subscribe" && mode !== "unsubscribe")) {
			Log.rawError(`[WebSub] 無効な購読操作です: mode=${mode}`);
			return false;
		}

		// チャンネルID検証
		if (!YouTubeDataAPI.validateChannelId(channelId)) {
			Log.rawError(`[WebSub] 無効なチャンネルIDです: ${channelId}`);
			return;
		}

		// 検証用の情報チェック
		let error = false;
		if (!this.verifyToken) {
			Log.rawError("[WebSub] VerifyToken が設定されていません");
			error = true;
		}
		if (!this.secret) {
			Log.rawError("[WebSub] Secret が設定されていません");
			error = true;
		}
		if (error)
			return;

		const hubUrl = "https://pubsubhubbub.appspot.com/subscribe";
		const topicUrl = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;

		const params = new URLSearchParams({
			"hub.mode": mode,
			"hub.topic": topicUrl,
			"hub.callback": callbackUrl,
			"hub.verify": "async"
		});
		if (mode === "subscribe")
			params.append("hub.lease_seconds", "432000"); // 5日間

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

		if (mode === "subscribe" || mode === "unsubscribe") {
			const verifyToken = searchParams.get("hub.verify_token");
			if (verifyToken !== this.verifyToken) {
				Log.rawError(`[WebSub] Invalid verify token: topic=${topic}`);
				return HttpUtils.response(403, "Forbidden");
			}
			if (!challenge || !this.isValidTopic(topic)) {
				Log.rawError(`[WebSub] Invalid verification request: mode=${mode}, topic=${topic}`);
				return HttpUtils.response(400, "Bad Request");
			}

			Log.rawInfo(LOG_FLAGS.YOUTUBE_WEBSUB, `[WebSub] ${mode} request: topic=${topic}`);
			return HttpUtils.response(200, challenge, { "Content-Type": "text/plain" });
		}

		Log.rawError(`[WebSub] Unknown mode: mode=${mode}`);
		return HttpUtils.response(404, "Not Found");
	}

	isValidTopic(topic)
	{
		if (!topic)
			return false;
		try {
			const topicUrl = new URL(topic);
			const channelId = topicUrl.searchParams.get("channel_id");
			return topicUrl.hostname === "www.youtube.com"
				&& topicUrl.pathname === "/xml/feeds/videos.xml"
				&& YouTubeDataAPI.validateChannelId(channelId);
		}
		catch {
			return false;
		}
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
			Log.rawError("[WebSub] No signature");
			return null;
		}

		// HMAC-SHA1 署名の検証
		const isValid = await this.verifySignature(body, signature);
		if (!isValid) {
			Log.rawError("[WebSub] Invalid signature");
			return null;
		}

		Log.rawInfo(LOG_FLAGS.YOUTUBE_WEBSUB_NEW_NOTIFICATION, `[WebSub] Update notification received: ${body.length} bytes`);
		return this.parseNotification(body);
	}

	/**
	 * HMAC-SHA1 署名の検証ロジック
	 */
	async verifySignature(body, signature)
	{
		// Secretが設定されていない場合は検証スキップ
		if (!this.secret) {
			Log.rawError("[WebSub] Secretが設定されていません");
			return false;
		}

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
			Log.rawError(`[WebSub] XML Parse Error: ${e.message}`);
		}
		return videoIds;
	}
}
