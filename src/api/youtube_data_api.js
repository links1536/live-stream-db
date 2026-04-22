import { HttpUtils } from "../httputils.js";

export class YouTubeDataAPI
{
	/**
	 * YouTube Data APIを利用するクラス
	 */
	constructor(apiKey)
	{
		this.apiKey = apiKey;
		this.youtubeUrl = "https://www.googleapis.com/youtube/v3/videos";
	}

	/**
	 * サムネイルURLを取得
	 */
	getThumbnail(thumbnails)
	{
		if (!thumbnails) {
			return "";
		}

		const priority = ["maxres", "standard", "high", "medium", "default"];
		for (const key of priority) {
			const thumb = thumbnails[key];
			if (thumb) {
				return thumb.url || "";
			}
		}

		return "";
	}

	/**
	 * ステータス更新メインロジック
	 */
	async getVideoInfosAsync(targetIds, vtubers)
	{
		if (!this.apiKey) {
			console.error("[ERROR] YouTube APIキーが設定されていません");
			return [{}, {}, new Set()];
		}

		const vtuberMap = {};
		for (const vtuber of vtubers) {
			const channelIds = vtuber.YouTubeID || [];
			for (const channelId of channelIds) {
				if (channelId) {
					vtuberMap[channelId] = vtuber;
				}
			}
		}

		const chunkSize = 50;
		const videos = {};
		const removedIds = new Set();
		const startTimes = {};

		for (let i = 0; i < targetIds.length; i += chunkSize) {
			const chunk = targetIds.slice(i, i + chunkSize);
			try {
				const ids = chunk.join(",");
				const requestUrl = `${this.youtubeUrl}?key=${this.apiKey}&part=snippet,liveStreamingDetails&id=${ids}&maxResults=${chunkSize}`;

				const response = await HttpUtils.get(requestUrl);
				if (!response.ok) {
					console.error(`API Error: ${response.status}`);
					break;
				}

				const data = await response.json();
				const foundIds = new Set();

				for (const item of data.items || []) {
					const videoId = item.id;
					foundIds.add(videoId);
					const live = item.liveStreamingDetails;

					// 配信情報がない場合は対象外
					if (!live) {
						removedIds.add(videoId);
						continue;
					}

					const snippet = item.snippet;
					const channelId = snippet.channelId;
					const vtuber = vtuberMap[channelId];

					if (!vtuber) {
						removedIds.add(videoId);
						continue;
					}

					const startTimeStr = live.scheduledStartTime || live.actualStartTime;

					videos[videoId] = {
						streamer_name: vtuber.Name,
						color: vtuber.Color,
						agency: vtuber.Agency,
						tags: vtuber.Tags,
						video_id: videoId,
						title: snippet.title,
						thumbnail: this.getThumbnail(snippet.thumbnails),
						start_time_iso: startTimeStr
					};

					if (startTimeStr) {
						// JSのDateオブジェクトはISO 8601形式をそのままパース可能
						startTimes[videoId] = Date.parse(startTimeStr);
					}

					// 実開始・終了時間をもとにステータスを判定
					if (live.actualEndTime) {
						videos[videoId].status = "archived";
					}
					else if (live.actualStartTime) {
						videos[videoId].status = "live";
					}
					else {
						videos[videoId].status = "upcoming";
					}
				}

				// APIから返ってこなかったIDを削除対象に追加
				for (const videoId of chunk) {
					if (!foundIds.has(videoId)) {
						removedIds.add(videoId);
					}
				}

			}
			catch (e) {
				console.error(`API Error: ${e.message}`);
				continue;
			}
		}

		return [videos, startTimes, removedIds];
	}
}