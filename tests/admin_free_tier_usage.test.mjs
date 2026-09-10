import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AdminService } from "../src/admin_service.js";

function createRequest() {
	return new Request("https://example.com/admin", {
		headers: {
			Authorization: `Basic ${btoa("admin:password")}`,
		},
	});
}

function createEnvironment(first) {
	return {
		ADMIN_USERNAME: "admin",
		ADMIN_PASSWORD: "password",
		DB: {
			prepare(sql) {
				assert.match(sql, /FROM vtubers/);
				return { first };
			},
		},
	};
}

test("管理コンソールに現在のマスター件数による無料枠試算を表示する", async () => {
	const response = await AdminService.handleRequest(
		createRequest(),
		createEnvironment(async () => ({
			creator_count: 153,
			youtube_channel_count: 154,
			twitch_user_count: 19,
			twitcasting_user_count: 23,
			youtube_tracked_item_count: 164,
			youtube_only: 114,
			twitch_only: 0,
			twitcasting_only: 0,
			youtube_twitch: 16,
			youtube_twitcasting: 20,
			twitch_twitcasting: 0,
			all_three: 3,
		})),
	);
	const html = await response.text();

	assert.equal(response.status, 200);
	assert.match(html, /153<\/strong> 人/);
	assert.match(html, /配信 <strong>153<\/strong> 件\/日/);
	assert.match(html, /動画 <strong>30\.6<\/strong> 件\/日/);
	assert.match(html, /配信内訳: YouTube 133件、Twitch 9件、TwitCasting 11件/);
	assert.match(html, /Workers requests<\/span><strong>1\.78–1\.92%/);
	assert.match(html, /Queue operations<\/span><strong>43\.32%/);
	assert.match(html, /KV writes<\/span><strong>27\.09%/);
	assert.match(html, /DO requests<\/span><strong>4\.49%/);
	assert.match(html, /DO rows read<\/span><strong>0\.04%/);
	assert.match(html, /DO rows written<\/span><strong>2\.93%/);
	assert.match(html, /Cron 290回、YouTube追跡 164件・4バッチ\/回/);
	assert.match(html, /YouTube WebSub Register Missing/);
	assert.match(html, /\/admin\/youtube-websub-register-missing/);
});

test("マスター件数を取得できなくても管理コンソールを表示する", async () => {
	const response = await AdminService.handleRequest(
		createRequest(),
		createEnvironment(async () => { throw new Error("D1 unavailable"); }),
	);
	const html = await response.text();

	assert.equal(response.status, 200);
	assert.match(html, /試算を表示できません/);
});

test("未登録のYouTube WebSub登録用エンドポイントを提供する", async () => {
	const entrySource = await readFile(new URL("../src/entry.js", import.meta.url), "utf8");
	const handler = entrySource.match(
		/"\/youtube-websub-register-missing": async \(\) => \{([\s\S]*?)\n\s*\},/
	)?.[1] ?? "";

	assert.match(handler, /registerMissingWebsubAsync\(\)/);
	assert.match(handler, /return Response\.json\(result\)/);
});
