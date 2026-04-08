
from workers import DurableObject

class YouTubeNoticesCache(DurableObject):
	def __init__(self, ctx, env):
		super().__init__(ctx, env)

	async def push(self, video_id):
		await self.ctx.storage.put(video_id, True)

	async def pop_all(self):
		storage = self.ctx.storage
		# 全てのキーを取得
		keys_map = await storage.list()
		video_ids = list(keys_map.keys())
		
		# 全てのデータを削除
		await storage.delete_all()
		
		return video_ids