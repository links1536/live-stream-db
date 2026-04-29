import { HttpUtils } from "../httputils.js";
import { Log } from "../log.js";

// --- 設定 ---
const YOUTUBE_API_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_API_PART = "snippet,liveStreamingDetails"

export class YouTubeDataAPI
{
	/**
	 * YouTube Data APIを利用するクラス
	 */
	constructor(apiKey)
	{
		Object.defineProperty(this, 'apiKey', {
			value: apiKey,
			writable: false,
			enumerable: false,
			configurable: false
		});
		this.youtubeDataApiUrlBase = `${YOUTUBE_API_ENDPOINT}?key=${this.apiKey}&part=${YOUTUBE_API_PART}&maxResults=${YouTubeDataAPI.CHUNK_SIZE}`;
	}

	static get CHUNK_SIZE()
	{
		return 50;
	}

	/**
	 * チャンネルID検証
	 */
	static validateChannelId(channelId) {
		// YouTube チャンネルID: 24文字の英数字とハイフン・アンダースコア
		if (!/^UC[a-zA-Z0-9\-_]{22}$/.test(channelId)) {
			throw new Error(`Invalid channel ID format: ${channelId}`);
		}
		return true;
	}

	/**
	 * ステータス更新メインロジック
	 */
	async getVideoInfosAsync(targetIds)
	{
		if (!this.apiKey) {
			Log.error("YouTubeDataAPI", "YouTube APIキーが設定されていません");
			return [null, null];
		}

		if (targetIds.length === 0) {
			Log.error("YouTubeDataAPI", "動画IDが指定されていません");
			return [null, null];
		}

		const ids = targetIds.join(",");
		const requestUrl = `${this.youtubeDataApiUrlBase}&id=${ids}`;

		const response = await HttpUtils.get(requestUrl);
		if (!response.ok) {
			// エラーがあって処理できなかったIDはなにもしない
			// いろいろエラーに種類はあるけど、Workersの性質上細かくハンドリングするCPU時間はない
			Log.error("YouTubeDataAPI", `API Error: ${response.status}`);
			return [null, null];
		}

		const schedules = []
		const foundIds = new Set();

		const data = await response.json();
		const items = data.items || [];
		for (const item of items) {
			const videoId = item.id;
			foundIds.add(videoId);
			
			// 配信情報がない場合は対象外
			const snippet = item.snippet;
			const live = item.liveStreamingDetails;
			if (!live)
				continue;

			// サムネイル選択をインライン化
			const thumbnails = snippet.thumbnails;
			const thumbnail = thumbnails ? (thumbnails.standard || thumbnails.high || thumbnails.medium || thumbnails.default) : null;
			// 配信開始時間
			const startTimeStr = live.scheduledStartTime || live.actualStartTime;

			// オブジェクト作成を1回にまとめて最小化
			schedules.push({
				video_id: videoId,
				channel_id: snippet.channelId,
				title: snippet.title || null,
				thumbnail: thumbnail ? thumbnail.url : "",
				start_time_iso: startTimeStr || null,
				status: live.actualEndTime ? "archived" :
						live.actualStartTime ? "live" : "upcoming"
			});
		}

		return [schedules, foundIds];
	}
}
