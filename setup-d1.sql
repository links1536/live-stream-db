-- テーブル作成
CREATE TABLE youtube_schedules (
	video_id TEXT PRIMARY KEY,
	channel_id TEXT,
	title TEXT,
	thumbnail TEXT,
	start_time_iso TEXT,
	status TEXT
);
CREATE TABLE rss_last_updated (
	channel_id TEXT PRIMARY KEY,
	last_updated TEXT
);

-- インデックス作成

DROP INDEX IF EXISTS idx_youtube_schedules_filter;
CREATE INDEX IF NOT EXISTS idx_youtube_schedules_filter ON youtube_schedules (status, start_time_iso);

DROP INDEX IF EXISTS idx_youtube_schedules_start_time;
CREATE INDEX IF NOT EXISTS idx_youtube_schedules_start_time ON youtube_schedules (start_time_iso);
