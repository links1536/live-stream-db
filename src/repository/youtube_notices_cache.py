from workers import DurableObject # type: ignore

class YouTubeNoticesCache(DurableObject):
	def __init__(self, ctx, env):
		super().__init__(ctx, env)

	async def add(self, video_id):
		await self.ctx.storage.put(video_id, True)

	async def get_all(self) -> set:
		keys_map = await self.ctx.storage.list()
		return set(keys_map.keys())

	async def delete_list_async(self, video_ids: list | set):
		if not video_ids:
			return
		for video_id in video_ids:
			await self.ctx.storage.delete(video_id)
