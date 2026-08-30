import assert from "node:assert/strict";
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
				assert.match(sql, /COUNT\(\*\).*FROM vtubers/);
				return { first };
			},
		},
	};
}

test("管理コンソールに現在のマスター件数による無料枠試算を表示する", async () => {
	const response = await AdminService.handleRequest(
		createRequest(),
		createEnvironment(async () => ({ creator_count: 153 })),
	);
	const html = await response.text();

	assert.equal(response.status, 200);
	assert.match(html, /153<\/strong> 人/);
	assert.match(html, /配信 <strong>153<\/strong> 件\/日/);
	assert.match(html, /動画 <strong>30\.6<\/strong> 件\/日/);
	assert.match(html, /Queue operations<\/span><strong>5\.51%/);
	assert.match(html, /KV writes<\/span><strong>18\.36%/);
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
