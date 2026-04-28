-- テーブル作成
CREATE TABLE youtube_schedules (
	video_id TEXT PRIMARY KEY,
	channel_id TEXT,
	title TEXT,
	thumbnail TEXT,
	start_time_iso TEXT,
	status TEXT
)
CREATE TABLE rss_last_updated (
	channel_id TEXT PRIMARY KEY,
	last_updated TEXT
)

-- インデックス作成
DROP INDEX IF EXISTS idx_youtube_schedules_filter;
CREATE INDEX IF NOT EXISTS idx_youtube_schedules_filter ON youtube_schedules (status, start_time_iso);

-- 表示用のビュー
CREATE VIEW display_schedules AS
SELECT 
	vr.video_id,
	v.name AS streamer_name,
	v.agency,
	(
		SELECT GROUP_CONCAT(tag, ', ') 
		FROM vtuber_tags 
		WHERE vtuber_id = v.id
	) AS tags,
	v.color,
	vr.title,
	vr.thumbnail,
	vr.start_time_iso,
	vr.status,
	'youtube' AS platform
FROM youtube_schedules vr
JOIN youtube_channels yc ON vr.channel_id = yc.channel_id
JOIN vtubers v ON yc.vtuber_id = v.id
