import { DurableObject } from "cloudflare:workers";

export class YouTubeNoticesCache extends DurableObject
{
	constructor(ctx, env) {
		super(ctx, env);
	}

	async add(videoId)
	{
		await this.ctx.storage.put(videoId, true);
	}

	async bulkAdd(videoIds)
	{
		if (videoIds) {
			for (const videoId of videoIds) {
				await this.ctx.storage.put(videoId, true);
			}
		}
	}

	async getAll()
	{
		const keysMap = await this.ctx.storage.list();
		return Array.from(keysMap.keys());
	}

	async deleteListAsync(videoIds)
	{
		if (videoIds) {
			for (const videoId of videoIds) {
				await this.ctx.storage.delete(videoId);
			}
		}
	}
}
