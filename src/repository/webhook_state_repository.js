import { Log } from "../log.js";

export class WebhookStateRepository
{
	constructor(db)
	{
		this.db = db;
	}

	async saveMessageAsync(platform, messageId, payload, receivedAtIso)
	{
		const result = await this.db.prepare(`
			INSERT OR IGNORE INTO webhook_messages (
				platform, message_id, payload, received_at_iso, processed_at_iso
			) VALUES (?, ?, ?, ?, NULL)
		`).bind(platform, messageId, payload, receivedAtIso).run();
		return (result.meta?.changes || 0) > 0;
	}

	async loadMessageAsync(platform, messageId)
	{
		return await this.db.prepare(`
			SELECT platform, message_id, payload, received_at_iso, processed_at_iso
			FROM webhook_messages
			WHERE platform = ? AND message_id = ?
		`).bind(platform, messageId).first();
	}

	async markMessageProcessedAsync(platform, messageId)
	{
		await this.db.prepare(`
			UPDATE webhook_messages
			SET processed_at_iso = ?
			WHERE platform = ? AND message_id = ?
		`).bind(new Date().toISOString(), platform, messageId).run();
	}

	async cleanupMessagesAsync(beforeIso)
	{
		const result = await this.db.prepare(
			"DELETE FROM webhook_messages WHERE received_at_iso < ?"
		).bind(beforeIso).run();
		const changes = result.meta?.changes || 0;
		Log.info("WebhookStateRepository", `D1: Removed ${changes} expired webhook messages.`);
		return changes;
	}

	async loadTargetsAsync(platform)
	{
		const { results } = await this.db.prepare(`
			SELECT platform, target_key, external_user_id, updated_at_iso
			FROM webhook_subscription_targets
			WHERE platform = ?
		`).bind(platform).all();
		return results || [];
	}

	async upsertTargetAsync(platform, targetKey, externalUserId)
	{
		await this.db.prepare(`
			INSERT INTO webhook_subscription_targets (
				platform, target_key, external_user_id, updated_at_iso
			) VALUES (?, ?, ?, ?)
			ON CONFLICT(platform, target_key) DO UPDATE SET
				external_user_id = excluded.external_user_id,
				updated_at_iso = excluded.updated_at_iso
		`).bind(platform, targetKey, externalUserId ?? null, new Date().toISOString()).run();
	}

	async deleteTargetAsync(platform, targetKey)
	{
		await this.db.prepare(`
			DELETE FROM webhook_subscription_targets
			WHERE platform = ? AND target_key = ?
		`).bind(platform, targetKey).run();
	}
}
