
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
		return list(keys_map.keys())

	async def delete_list_async(self, video_ids):
		await self.ctx.storage.delete(video_ids)
