import { HttpUtils } from "../httputils.js";

// --- 設定 ---
const YOUTUBE_API_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_API_PART = "snippet,liveStreamingDetails";
const CHUNK_SIZE = 50;

export class YouTubeDataAPI
{
	/**
	 * YouTube Data APIを利用するクラス
	 */
	constructor(apiKey)
	{
		this.apiKey = apiKey;
		this.youtubeDataApiUrlBase = `${YOUTUBE_API_ENDPOINT}?part=${YOUTUBE_API_PART}&maxResults=${CHUNK_SIZE}`;
	}

	/**
	 * ステータス更新メインロジック
	 */
	async getVideoInfosAsync(targetIds)
	{
		if (!this.apiKey) {
			console.error("[ERROR] YouTube APIキーが設定されていません");
			return [{}, new Set()];
		}

		const ids = targetIds.join(",");
		const requestUrl = `${this.youtubeDataApiUrlBase}?key=${this.apiKey}`;

		const response = await HttpUtils.get(requestUrl);
		if (!response.ok) {
			//エラーがあって処理できなかったIDはなにもしない
			console.error(`API Error: ${response.status}`);
			return [{}, new Set()];
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
