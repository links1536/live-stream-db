import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function findJsonFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...await findJsonFiles(path));
		} else if (entry.isFile() && entry.name.endsWith(".json")) {
			files.push(path);
		}
	}

	return files;
}

export async function loadMasterStatistics(dataDirectory) {
	const files = await findJsonFiles(dataDirectory);
	const statistics = {
		creatorCount: 0,
		youtubeChannelCount: 0,
		twitchUserCount: 0,
		twitcastingUserCount: 0,
	};

	for (const file of files) {
		const json = (await readFile(file, "utf8")).replace(/^\uFEFF/, "");
		const entries = JSON.parse(json);
		if (!Array.isArray(entries)) {
			throw new TypeError(`${file} のルート要素は配列である必要があります`);
		}

		statistics.creatorCount += entries.length;
		for (const entry of entries) {
			statistics.youtubeChannelCount += entry.YouTubeID?.length ?? 0;
			statistics.twitchUserCount += entry.TwitchID?.length ?? 0;
			statistics.twitcastingUserCount += entry.TwitCastingID?.length ?? 0;
		}
	}

	return statistics;
}

export async function countCreators(dataDirectory) {
	return (await loadMasterStatistics(dataDirectory)).creatorCount;
}
