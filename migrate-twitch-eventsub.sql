CREATE TABLE IF NOT EXISTS webhook_subscription_targets (
	platform TEXT,
	target_key TEXT,
	external_user_id TEXT,
	updated_at_iso TEXT,
	PRIMARY KEY (platform, target_key)
);

CREATE TABLE IF NOT EXISTS webhook_messages (
	platform TEXT,
	message_id TEXT,
	payload TEXT,
	received_at_iso TEXT,
	processed_at_iso TEXT,
	PRIMARY KEY (platform, message_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_messages_received_at
	ON webhook_messages (received_at_iso);
