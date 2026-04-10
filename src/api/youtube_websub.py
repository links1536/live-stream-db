import hashlib
import hmac
from urllib.parse import parse_qs, urlencode, urlparse
import httputils
import xml.etree.ElementTree as ET

class YouTubeWebSub:
	"""YouTube WebSub (PubSubHubbub) の通知を解析するクラス"""

	def __init__(self, web_sub_verify_token, web_sub_secrets):
		self.web_sub_verify_token = web_sub_verify_token
		self.web_sub_secrets = web_sub_secrets

	async def register_websub(self, callback_url, channel_id):
		"""WebSubを登録する"""

		hub_url = "https://pubsubhubbub.appspot.com/subscribe"
		topic_url = f"https://www.youtube.com/xml/feeds/videos.xml?channel_id={channel_id}"

		dict = {
			"hub.mode": "subscribe",
			"hub.topic": topic_url,
			"hub.callback": callback_url,
			"hub.verify": "async",
			"hub.lease_seconds": "432000"	# 5日間 (最大値)
		}

		if self.web_sub_verify_token is not None:
			dict["hub.verify_token"] = self.web_sub_verify_token # pyright: ignore[reportUndefinedVariable]
		if self.web_sub_secrets is not None:
			dict["hub.secret"] = self.web_sub_secrets # pyright: ignore[reportUndefinedVariable]

		headers ={
			"content-type": "application/x-www-form-urlencoded"
		}
		body = urlencode(dict)
		response = await httputils.post(hub_url, headers=headers, body=body)
		return response.status == 202

	async def process_get(self, request):
		parsed = urlparse(request.url)
		query = parse_qs(parsed.query)

		# WebSub検証
		mode = query.get("hub.mode", [None])[0]
		topic = query.get("hub.topic", [None])[0]
		challenge = query.get("hub.challenge", [None])[0]
		
		if mode == "subscribe":
			if challenge:
				verify_token = query.get("hub.verify_token", [None])[0]
				if not verify_token or verify_token != self.web_sub_verify_token:
					# 無効な検証トークン
					print(f"[WebSub] Invalid verify token: topic={topic}")
					return httputils.response("Forbidden", {
						"Content-Type": "text/plain",
						"Status": 403
					})
				
			# サブスクリプション検証
			print(f"[WebSub] Subscribe request: topic={topic}")
			return httputils.response(challenge, {
				"Content-Type": "text/plain",
			})
		
		elif mode == "unsubscribe":
			# アンサブスクリプション
			print(f"[WebSub] Unsubscribe request: topic={topic}")
			return httputils.response("OK", {
				"Content-Type": "text/plain",
			})

		print(f"[WebSub] Unknown mode: mode={mode}")
		return httputils.response("Not Found", {
			"Content-Type": "text/plain",
			"Status": 404
		})
	
	async def process_post(self, request):
	
		# 実際の更新通知
		body = await request.text()
		if body is None or body == "":
			return httputils.response("400 Bad Request", {
				"Status": 400,
				"Content-Type": "text/plain",
			})

		# WebSub検証
		signature = request.headers.get("HTTP_X_HUB_SIGNATURE")
		if not signature:
			print("[WebSub] No signature")
			return httputils.response("Forbidden", {
				"Content-Type": "text/plain",
				"Status": 403
			})

		secret_bytes = self.web_sub_secrets.encode('utf-8')
		sha1_hash = hmac.new(secret_bytes, body, hashlib.sha1).hexdigest()
		expected_signature = f"sha1={sha1_hash}"
		if not hmac.compare_digest(signature, expected_signature):
			print("[WebSub] Invalid signature")
			return httputils.response("Forbidden", {
				"Content-Type": "text/plain",
				"Status": 403
			})

		# ここで処理を実行
		print(f"[WebSub] Update notification received: {len(body)} bytes")
		await self.parse_notification(body)
		
		return httputils.response("", {
			"Status": 200,
			"Content-Type": "text/plain",
		})
	
	async def parse_notification(self, body: str):
		"""
		通知のXMLボディを解析して動画IDのリストを返す
		"""
		video_ids = []
		try:
			root = ET.fromstring(body)
			# 名前空間の定義
			ns = {
				'atom': 'http://www.w3.org/2005/Atom',
				'yt': 'http://www.youtube.com/xml/schemas/2015'
			}

			for entry in root.findall('atom:entry', ns):
				video_id_node = entry.find('yt:videoId', ns)
				if video_id_node is not None and video_id_node.text:
					video_ids.append(video_id_node.text)

		except Exception as e:
			print(f"[WebSub] XML Parse Error: {e}")

		return video_ids

