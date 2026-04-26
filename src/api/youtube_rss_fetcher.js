import { HttpUtils } from "../httputils.js";
import { YouTubeDataAPI } from './youtube_data_api.js';

export class YouTubeRSSFetcher
{
	/**
	 * YouTube RSSから動画情報を取得するクラス
	 */
	async getVideoInfo(channelId)
	{
		// チャンネルID検証
		if (!YouTubeDataAPI.validateChannelId(channelId)) {
			console.error(`[YouTube RSS Fetcher] 無効なチャンネルIDです: ${channelId}`);
			return;
		}

		const videoInfo = [];
		try {
			const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
			const response = await HttpUtils.get(url);

			if (!response.ok) {
				console.log(`❌ RSS Error ${channel_id} - {response.status}`);
				return null;
			}

			const content = await response.text();

			// <entry>セクションごとに分割して抽出
			const entryMatches = content.matchAll(/<entry>([\s\S]*?)<\/entry>/g);

			for (const match of entryMatches) {
				const entryContent = match[1];

				// 各タグの内容を正規表現で抽出
				const videoIdMatch = entryContent.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
				const updatedMatch = entryContent.match(/<updated>([^<]+)<\/updated>/);

				if (videoIdMatch && updatedMatch) {
					videoInfo.push({
						video_id: videoIdMatch[1],
						updated: updatedMatch[1]
					});
				}
			}
		}
		catch (e) {
			console.error(`❌ RSS Error: ${e}`);
		}
		return videoInfo;
	}
}