from workers import Response, fetch # type: ignore

async def get(url, headers = {}):
	"""RSSから最新動画情報を取得"""
	headers["method"] = headers.get("method", "GET")
	return fetch(url, headers=headers)

async def post(url, headers = {}):
	"""RSSから最新動画情報を取得"""
	headers["method"] = headers.get("method", "POST")
	return fetch(url, headers=headers)

async def response(body):
	"""レスポンスを返す"""
	return Response(body)