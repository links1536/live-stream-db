import hashlib
import hmac
from urllib.parse import parse_qs, urlparse
import httputils
import xml.etree.ElementTree as ET

class YouTubeWebSub:
	"""YouTube WebSub (PubSubHubbub) の通知を解析するクラス"""

	def __init__(self, web_sub_verify_token, web_sub_secrets):
		self.web_sub_verify_token = web_sub_verify_token
		self.web_sub_secrets = web_sub_secrets

	async def handle_youtube_webhook(self, request):
		parsed = urlparse(request.url)
		query = parse_qs(parsed.query)

		# WebSub検証
		mode = query.get("hub.mode")
		topic = query.get("hub.topic")
		challenge = query.get("hub.challenge")
		
		if request.method == "GET":
			if mode == "subscribe" and challenge:

				verify_token = query.get("hub.verify_token")
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
		
		elif request.method == "POST":
			return await self.process_post(request)

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

