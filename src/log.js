import { INFO_LOG_FLAGS } from "./constants/log_flags.js";

export class Log
{
	static info(identifer, message)
	{
		if (!INFO_LOG_FLAGS[identifer])
			return;
		console.log(`[INFO] [${identifer}] ${message}`);
	}
	static warning(identifer, message)
	{
		console.warn(`[WARN] [${identifer}] ${message}`);
	}
	static error(identifer, message)
	{
		console.error(`[ERROR] [${identifer}] ${message}`);
	}
	static rawInfo(flag, message)
	{
		if (!flag)
			return;
		console.log(message);
	}
	static rawWarning(message)
	{
		console.warn(message);
	}
	static rawError(message, error = undefined)
	{
		if (error === undefined)
			console.error(message);
		else
			console.error(message, error);
	}
}
