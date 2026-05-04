import { DisplayScheduleQueryService } from "../query_service/display_schedule_query.js";
import { DateTimeUtils } from "../datetime_utils.js";
import { Log } from "../log.js";

const OUTPUT_KEY = "lives.json";

export class LivesJsonUpdater
{
	constructor(env)
	{
		this.displayScheduleQuery = new DisplayScheduleQueryService(env.DB);
		this.livesJsonStore = env.KV_OUTPUT;
	}

	async saveDataJsonAsync()
	{
		const currentDate = DateTimeUtils.getCurrentDate();
		const currentDateIso = currentDate.toISOString();
		const [startLimit, endLimit] = DateTimeUtils.getLimitDate(currentDate);
		const startLimitIso = startLimit.toISOString();
		const endLimitIso = endLimit.toISOString();

		const [publicDataStr, count] = await this.displayScheduleQuery.loadActiveSchedulesJsonAsync(currentDateIso, startLimitIso, endLimitIso);
		await this.livesJsonStore.put(OUTPUT_KEY, publicDataStr);
		Log.info("LivesJsonUpdater", `Generated ${OUTPUT_KEY} (${count} streams)`);
	}
}
