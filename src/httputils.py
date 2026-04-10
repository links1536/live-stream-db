from workers import Response, fetch # type: ignore

async def get(url, headers = {}):
	"""RSSから最新動画情報を取得"""
	headers["method"] = headers.get("method", "GET")
	return await fetch(url, headers=headers)

async def post(url, headers = {}, body = None):
	"""RSSから最新動画情報を取得"""
	headers["method"] = headers.get("method", "POST")
	return await fetch(url, {
		"method": "POST",
		"headers": headers,
		"body": body
	})

def response(body):
	"""レスポンスを返す"""
	return Response(body)