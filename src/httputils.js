// httputils.js

export class HttpUtils
{
	/**
	* GET リクエストを送信する
	*/
	static async get(url, headers = {})
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
	static async post(url, headers = {}, body = null)
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

	/**
	 * 軽量なハッシュ値を計算する (64bit)
	 */
	static quickHash(str)
	{
		let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
		for (let i = 0, ch; i < str.length; i++) {
			ch = str.charCodeAt(i);
			h1 = Math.imul(h1 ^ ch, 2654435761);
			h2 = Math.imul(h2 ^ ch, 1597334677);
		}
		h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
		h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
		return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
	}
}