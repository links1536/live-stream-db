from updater import Updater
from api.youtube_rss_fetcher import YouTubeRSSFetcher
import httputils

class Default(WorkerEntrypoint):
	# runs based on "triggers" in wrangler config
	async def scheduled(self, controller, env, ctx):
		if controller.cron == "*/15 * * * *":
			updater = Updater(self.env)
			await updater.update_schedules()
		if controller.cron == "45 * * * *":
			await updater.fetch_new_schedules()

	# テスト用に表示でも
	async def fetch(self, request):
		updater = Updater(self.env)
		await updater.update_schedules()
		return httputils.response("")