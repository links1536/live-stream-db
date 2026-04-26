import { DurableObject } from "cloudflare:workers";

export class YouTubeNoticesCache extends DurableObject
{
	constructor(ctx, env) {
		super(ctx, env);
	}

	async addAsync(videoId)
	{
		await this.ctx.storage.put(videoId, true);
	}

	async bulkAddAsync(videoIds)
	{
		if (videoIds) {
			const entries = {};
			for (const id of videoIds) {
				entries[id] = true;
			}
			await this.ctx.storage.put(entries);
		}
	}

	async getAllAsync()
	{
		const keysMap = await this.ctx.storage.list();
		return Array.from(keysMap.keys());
	}

	async bulkDeleteAsync(videoIds)
	{
		if (videoIds) {
			await this.ctx.storage.delete(Array.from(videoIds));
		}
	}
}
