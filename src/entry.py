from api.youtube_websub import YouTubeWebSub
from workers import WorkerEntrypoint, Response # type: ignore
from updater import Updater
from urllib.parse import urlparse

# DurableObjectのエクスポート
from repository.youtube_notices_cache import YouTubeNoticesCache 

class Default(WorkerEntrypoint):
	async def scheduled(self, controller, env, ctx):
		if controller.cron == "0 19 * * *":
			updater = Updater(self.env)
			await updater.register_websub(self.env.YOUTUBE_WEBSUB_CALLBACK_URL)
		elif controller.cron == "45 * * * *":
			updater = Updater(self.env)
			await updater.fetch_new_schedules()
		else:
			updater = Updater(self.env)
			await updater.update_schedules()

		return Response("")

	async def fetch(self, request):
		# WebSubエンドポイント
		parsed = urlparse(request.url)
		
		if parsed.path == '/favicon.ico':
			return Response("")
		
		if parsed.path == "/webhooks/youtube":
			updater = Updater(self.env)
			return await updater.handle_youtube_webhook(request)

		if parsed.path == "/youtube-websub-resister":
			updater = Updater(self.env)
			await updater.register_websub()
		if parsed.path == "/youtube-fetch-rss":
			updater = Updater(self.env)
			await updater.fetch_new_schedules()
		if parsed.path == "/youtube-update":
			updater = Updater(self.env)
			await updater.update_schedules()

		return Response("")

	async def queue(self, batch, env, ctx):
		youtube_websub: YouTubeWebSub = YouTubeWebSub(self.env.YOUTUBE_WEBSUB_VERIFY_TOKEN, self.env.YOUTUBE_WEBSUB_SECRETS)
		for msg in batch.messages:
			await youtube_websub.register_websub(self.env.YOUTUBE_WEBSUB_CALLBACK_URL, msg.body)