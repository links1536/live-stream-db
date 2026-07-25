-- テーブル作成
CREATE TABLE youtube_schedules (
	video_id TEXT PRIMARY KEY,
	channel_id TEXT,
	title TEXT,
	thumbnail TEXT,
	start_time_iso TEXT,
	published_at_iso TEXT,
	status TEXT
);
CREATE TABLE rss_last_updated (
	channel_id TEXT PRIMARY KEY,
	last_updated TEXT
);
CREATE TABLE twitch_streams (
	twitch_id TEXT PRIMARY KEY,
	source_stream_id TEXT,
	user_login TEXT,
	title TEXT,
	thumbnail TEXT,
	start_time_iso TEXT,
	published_at_iso TEXT,
	url TEXT,
	status TEXT
);
CREATE TABLE twitcasting_streams (
	twitcasting_id TEXT PRIMARY KEY,
	screen_id TEXT,
	title TEXT,
	thumbnail TEXT,
	start_time_iso TEXT,
	published_at_iso TEXT,
	url TEXT,
	status TEXT
);

-- インデックス作成

DROP INDEX IF EXISTS idx_youtube_schedules_filter;
CREATE INDEX IF NOT EXISTS idx_youtube_schedules_filter ON youtube_schedules (status, start_time_iso);

DROP INDEX IF EXISTS idx_youtube_schedules_start_time;
CREATE INDEX IF NOT EXISTS idx_youtube_schedules_start_time ON youtube_schedules (start_time_iso);

DROP INDEX IF EXISTS idx_youtube_schedules_published_at;
CREATE INDEX IF NOT EXISTS idx_youtube_schedules_published_at ON youtube_schedules (published_at_iso);

DROP INDEX IF EXISTS idx_twitch_streams_start_time;
CREATE INDEX IF NOT EXISTS idx_twitch_streams_start_time ON twitch_streams (start_time_iso);

DROP INDEX IF EXISTS idx_twitch_streams_published_at;
CREATE INDEX IF NOT EXISTS idx_twitch_streams_published_at ON twitch_streams (published_at_iso);

DROP INDEX IF EXISTS idx_twitch_streams_status;
CREATE INDEX IF NOT EXISTS idx_twitch_streams_status ON twitch_streams (status);

DROP INDEX IF EXISTS idx_twitch_streams_source_stream_id;
CREATE INDEX IF NOT EXISTS idx_twitch_streams_source_stream_id ON twitch_streams (source_stream_id);

DROP INDEX IF EXISTS idx_twitcasting_streams_start_time;
CREATE INDEX IF NOT EXISTS idx_twitcasting_streams_start_time ON twitcasting_streams (start_time_iso);

DROP INDEX IF EXISTS idx_twitcasting_streams_status;
CREATE INDEX IF NOT EXISTS idx_twitcasting_streams_status ON twitcasting_streams (status);

DROP INDEX IF EXISTS idx_twitcasting_streams_screen_id;
CREATE INDEX IF NOT EXISTS idx_twitcasting_streams_screen_id ON twitcasting_streams (screen_id);
