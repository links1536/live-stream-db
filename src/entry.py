from api.youtube_websub import YouTubeWebSub
from workers import WorkerEntrypoint, Response # type: ignore
from urllib.parse import urlparse
from updater.youtube_schedule_updater import YouTubeScheduleUpdater
from updater.youtube_rss_feed_updater import YouTubeRssFeedUpdater
from updater.youtube_websub_updater import YouTubeWebSubUpdater

# DurableObjectのエクスポート
from repository.youtube_notices_cache import YouTubeNoticesCache 

class Default(WorkerEntrypoint):

	async def fetch(self, request):
		# WebSubエンドポイント
		parsed = urlparse(request.url)
		
		if parsed.path == '/favicon.ico':
			return Response("")
		
		if parsed.path == "/webhooks/youtube":
			updater = YouTubeWebSubUpdater(self.env)
			return await updater.handle_youtube_webhook(request)

		if parsed.path == "/youtube-websub-resister":
			updater = YouTubeWebSubUpdater(self.env)
			await updater.register_websub()
		if parsed.path == "/youtube-fetch-rss":
			updater = YouTubeRssFeedUpdater(self.env)
			await updater.fetch_new_schedules()
		if parsed.path == "/youtube-update":
			updater = YouTubeScheduleUpdater(self.env)
			await updater.update_schedules()

		return Response("")

	async def scheduled(self, controller, env, ctx):
		if controller.cron == "0 19 * * *":
			updater = YouTubeWebSubUpdater(self.env)
			await updater.register_websub(self.env.YOUTUBE_WEBSUB_CALLBACK_URL)
		elif controller.cron == "45 * * * *":
			updater = YouTubeRssFeedUpdater(self.env)
			await updater.fetch_new_schedules()
		else:
			updater = YouTubeScheduleUpdater(self.env)
			await updater.update_schedules()

		return Response("")

	async def queue(self, batch, env, ctx):
		youtube_websub: YouTubeWebSub = YouTubeWebSub(self.env.YOUTUBE_WEBSUB_VERIFY_TOKEN, self.env.YOUTUBE_WEBSUB_SECRETS)
		for msg in batch.messages:
			print(f"{msg.body}) register youtube websub")
			await youtube_websub.register_websub(self.env.YOUTUBE_WEBSUB_CALLBACK_URL, msg.body)