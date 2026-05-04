import { DurableObject } from "cloudflare:workers";

export class StreamUpdateCoordinator extends DurableObject
{
	constructor(ctx, env) {
		super(ctx, env);
	}

	async initializeRunAsync(runId, pendingCount)
	{
		await this.ctx.storage.put(runId, pendingCount);
	}

	async completeRunItemAsync(runId)
	{
		const pendingCount = await this.ctx.storage.get(runId);
		if (pendingCount == null)
			return null;

		const nextPendingCount = pendingCount - 1;
		if (nextPendingCount <= 0) {
			await this.ctx.storage.delete(runId);
			return 0;
		}

		await this.ctx.storage.put(runId, nextPendingCount);
		return nextPendingCount;
	}
}
