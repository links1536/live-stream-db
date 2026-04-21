import { DurableObject } from "cloudflare:workers";

export class YouTubeNoticesCache extends DurableObject
{
	constructor(ctx, env) {
		super(ctx, env);
	}

	async sayHello() {
		return "Hello, World!";
	}
	
	async add(self, video_id)
	{
		await self.ctx.storage.put(video_id, True)
	}

	async get_all(self)
	{
		keys_map = await self.ctx.storage.list();
		return set(keys_map.keys());
	}

	async delete_list_async(self, video_ids)
	{
		if (video_ids) {
			for (const video_id in video_ids){
				await self.ctx.storage.delete(video_id)
			}
		}
	}
}
