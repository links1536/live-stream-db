import { DurableObject } from "cloudflare:workers";

export class YouTubeNoticesCache extends DurableObject
{
	constructor(ctx, env) {
		super(ctx, env);
	}

	async add(self, video_id)
	{
		await self.ctx.storage.put(video_id, True);
	}

	async getAll(self)
	{
		const keys_map = await self.ctx.storage.list();
		return set(keys_map.keys());
	}

	async deleteListAsync(self, video_ids)
	{
		if (video_ids) {
			for (const video_id in video_ids) {
				await self.ctx.storage.delete(video_id);
			}
		}
	}
}
