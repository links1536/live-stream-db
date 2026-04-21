import { DurableObject } from "cloudflare:workers";

export class YouTubeNoticesCache extends DurableObject
{
	constructor(ctx, env) {
		super(ctx, env);
	}

	async add(video_id)
	{
		await this.ctx.storage.put(video_id, True);
	}

	async getAll()
	{
		const keys_map = await this.ctx.storage.list();
		return set(keys_map.keys());
	}

	async deleteListAsync(video_ids)
	{
		if (video_ids) {
			for (const video_id in video_ids) {
				await this.ctx.storage.delete(video_id);
			}
		}
	}
}
