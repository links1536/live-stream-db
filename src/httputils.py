from workers import Request, Response, fetch # type: ignore

async def get(url, headers = {}):
	"""RSSから最新動画情報を取得"""
	request = Request(url, method="GET", headers=headers)
	return await fetch(request)

async def post(url, headers = {}, body = None):
	"""RSSから最新動画情報を取得"""
	request = Request(url, method="POST", headers=headers, body=body)
	return await fetch(request)

def response(body):
	"""レスポンスを返す"""
	return Response(body)