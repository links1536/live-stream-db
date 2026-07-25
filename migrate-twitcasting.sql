CREATE TABLE IF NOT EXISTS twitcasting_streams (
	twitcasting_id TEXT PRIMARY KEY,
	screen_id TEXT,
	title TEXT,
	thumbnail TEXT,
	start_time_iso TEXT,
	published_at_iso TEXT,
	url TEXT,
	status TEXT
);

CREATE INDEX IF NOT EXISTS idx_twitcasting_streams_start_time ON twitcasting_streams (start_time_iso);
CREATE INDEX IF NOT EXISTS idx_twitcasting_streams_status ON twitcasting_streams (status);
CREATE INDEX IF NOT EXISTS idx_twitcasting_streams_screen_id ON twitcasting_streams (screen_id);
