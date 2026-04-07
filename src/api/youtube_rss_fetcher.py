

import httputils
import xml.etree.ElementTree as ET

class YouTubeRSSFetcher:
	"""YouTube RSSから動画情報を取得するクラス"""

	async def get_video_info(self, channel_id):
		"""RSSから最新動画情報を取得"""
		video_info = []
		try:
			url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
			response = await httputils.get(url)
			if response.status != 200:
				print(f"RSS Error: {channel_id} - {response.status}")
				return None
			
			content = await response.text()
			root = ET.fromstring(content)
			ns = {'atom': 'http://www.w3.org/2005/Atom', 'yt': 'http://www.youtube.com/xml/schemas/2015'}
			
			for entry in root.findall('atom:entry', ns):
				vid = entry.find('yt:videoId', ns).text
				updated = entry.find('atom:updated', ns).text
				video_info.append({"video_id": vid, "updated": updated})

		except Exception as e:
			print(f"RSS Error: {e}")
		return video_info

