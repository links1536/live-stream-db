// httputils.js

export class HttpUtils
{
	/**
	* GET リクエストを送信する
	*/
	async static get(url, headers = {})
	{
		const request = new Request(url, {
			method: "GET",
			headers: headers,
		});
		return await fetch(request);
	}

	/**
	* POST リクエストを送信する
	*/
	async static post(url, headers = {}, body = null)
	{
		const request = new Request(url, {
			method: "POST",
			headers: headers,
			body: body,
		});
		return await fetch(request);
	}

	/**
	* レスポンスオブジェクトを簡単に作成する
	*/
	static response(body, headers = {})
	{
		return new Response(body, {
			headers: headers,
		});
	}
}