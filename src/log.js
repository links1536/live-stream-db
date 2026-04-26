
export class Log
{
	static info(identifer, message)
	{
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
}