import { DurableObject } from "cloudflare:workers";

export class StreamUpdateCoordinator extends DurableObject
{
	constructor(ctx, env) {
		super(ctx, env);
	}

	getStreamRunKey(runId)
	{
		return `stream_run:${runId}`;
	}

	getOutputRunKey(runId)
	{
		return `output_run:${runId}`;
	}

	async initializeRunAsync(runId, pendingCount, source, outputRunId = null)
	{
		await this.ctx.storage.put(this.getStreamRunKey(runId), {
			pending_count: pendingCount,
			completed_item_ids: [],
			dirty: false,
			source,
			output_run_id: outputRunId
		});
	}

	async completeRunItemAsync(runId, itemId, itemDirty = false)
	{
		const runKey = this.getStreamRunKey(runId);
		const runState = await this.ctx.storage.get(runKey);
		if (runState == null)
			return null;
		const completedItemIds = runState.completed_item_ids ?? [];
		if (completedItemIds.includes(itemId) || runState.pending_count <= 0) {
			return {
				is_last: runState.pending_count <= 0,
				pending_count: Math.max(0, runState.pending_count),
				dirty: runState.dirty,
				source: runState.source,
				output_run_id: runState.output_run_id
			};
		}

		const nextPendingCount = runState.pending_count - 1;
		const nextDirty = runState.dirty || itemDirty;
		const nextCompletedItemIds = [...completedItemIds, itemId];
		if (nextPendingCount <= 0) {
			await this.ctx.storage.put(runKey, {
				pending_count: 0,
				completed_item_ids: nextCompletedItemIds,
				dirty: nextDirty,
				source: runState.source,
				output_run_id: runState.output_run_id
			});
			return {
				is_last: true,
				pending_count: 0,
				dirty: nextDirty,
				source: runState.source,
				output_run_id: runState.output_run_id
			};
		}

		await this.ctx.storage.put(runKey, {
			pending_count: nextPendingCount,
			completed_item_ids: nextCompletedItemIds,
			dirty: nextDirty,
			source: runState.source,
			output_run_id: runState.output_run_id
		});
		return {
			is_last: false,
			pending_count: nextPendingCount,
			dirty: nextDirty,
			source: runState.source,
			output_run_id: runState.output_run_id
		};
	}

	async finalizeRunAsync(runId)
	{
		await this.ctx.storage.delete(this.getStreamRunKey(runId));
	}

	async initializeOutputRunAsync(runId, sources)
	{
		const uniqueSources = Array.from(new Set(sources || []));
		await this.ctx.storage.put(this.getOutputRunKey(runId), {
			pending_sources: uniqueSources,
			completed_sources: [],
			dirty: false
		});
	}

	async completeOutputSourceAsync(runId, source, sourceDirty = false)
	{
		const runKey = this.getOutputRunKey(runId);
		const runState = await this.ctx.storage.get(runKey);
		if (runState == null)
			return null;

		if (runState.completed_sources.includes(source)) {
			return {
				is_last: runState.pending_sources.length === 0,
				should_update: runState.pending_sources.length === 0 && runState.dirty,
				dirty: runState.dirty
			};
		}

		const pendingSources = runState.pending_sources.filter(v => v !== source);
		const completedSources = [...runState.completed_sources, source];
		const nextDirty = runState.dirty || sourceDirty;

		if (pendingSources.length === 0) {
			await this.ctx.storage.put(runKey, {
				pending_sources: [],
				completed_sources: completedSources,
				dirty: nextDirty
			});
			return {
				is_last: true,
				should_update: nextDirty,
				dirty: nextDirty,
				completed_sources: completedSources
			};
		}

		await this.ctx.storage.put(runKey, {
			pending_sources: pendingSources,
			completed_sources: completedSources,
			dirty: nextDirty
		});
		return {
			is_last: false,
			should_update: false,
			dirty: nextDirty,
			completed_sources: completedSources
		};
	}

	async finalizeOutputRunAsync(runId)
	{
		await this.ctx.storage.delete(this.getOutputRunKey(runId));
	}
}
