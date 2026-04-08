from workers import WorkerEntrypoint # type: ignore
from updater import Updater
import httputils

class Default(WorkerEntrypoint):
	# runs based on "triggers" in wrangler config
	async def scheduled(self, controller, env, ctx):
		if controller.cron == "45 * * * *":
			updater = Updater(self.env)
			await updater.fetch_new_schedules()
		if controller.cron == "*/15 * * * *":
			updater = Updater(self.env)
			await updater.update_schedules()

	# テスト用に表示でも
	async def fetch(self, request):
		updater = Updater(self.env)
		await updater.fetch_new_schedules()
		await updater.update_schedules()
		return httputils.response("")