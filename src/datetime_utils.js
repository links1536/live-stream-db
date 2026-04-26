// datetime_utls.js

const MS_PER_DAY = 86400000;
const BEFORE_DAYS = 1 * MS_PER_DAY;
const AFTER_DAYS = 7 * MS_PER_DAY;

export class DateTimeUtils
{
	static getCurrentDate()
	{
		return new Date();
	}

	static getLimitDate(currentDate)
	{
		const currentTime = currentDate.getTime();
		const startLimit = new Date(currentTime - BEFORE_DAYS);
		const endLimit = new Date(currentTime + AFTER_DAYS);
		return [startLimit, endLimit];
	}


	static getCurrentTime()
	{
		return Date.now();
	}

	static getLimitTime(currentTime)
	{
		const startLimit = (currentTime - BEFORE_DAYS);
		const endLimit = (currentTime + AFTER_DAYS);
		return [startLimit, endLimit];
	}
}