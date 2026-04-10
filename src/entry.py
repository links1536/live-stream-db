from workers import WorkerEntrypoint, Response # type: ignore
from updater import Updater
from urllib.parse import urlparse

class Default(WorkerEntrypoint):
	async def scheduled(self, controller, env, ctx):
		if controller.cron == "45 * * * *":
			updater = Updater(self.env)
			await updater.fetch_new_schedules()
		if controller.cron == "*/15 * * * *":
			updater = Updater(self.env)
			await updater.update_schedules()

	async def fetch(self, request):
		# WebSubエンドポイント
		parsed = urlparse(request.url)
		
		if parsed.path == '/favicon.ico':
			return Response("")
		
		if parsed.path == "/webhooks/youtube":
			updater = Updater(self.env)
			return await updater.handle_youtube_webhook(request)
		
		# 通常の処理
		updater = Updater(self.env)
		await updater.update_schedules()
		return Response("")
