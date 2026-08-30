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
		platformCombinations: {
			youtubeOnly: 0,
			twitchOnly: 0,
			twitcastingOnly: 0,
			youtubeTwitch: 0,
			youtubeTwitcasting: 0,
			twitchTwitcasting: 0,
			allThree: 0,
		},
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

			const hasYoutube = (entry.YouTubeID?.length ?? 0) > 0;
			const hasTwitch = (entry.TwitchID?.length ?? 0) > 0;
			const hasTwitcasting = (entry.TwitCastingID?.length ?? 0) > 0;
			let combination;
			if (hasYoutube && hasTwitch && hasTwitcasting)
				combination = "allThree";
			else if (hasYoutube && hasTwitch)
				combination = "youtubeTwitch";
			else if (hasYoutube && hasTwitcasting)
				combination = "youtubeTwitcasting";
			else if (hasTwitch && hasTwitcasting)
				combination = "twitchTwitcasting";
			else if (hasYoutube)
				combination = "youtubeOnly";
			else if (hasTwitch)
				combination = "twitchOnly";
			else if (hasTwitcasting)
				combination = "twitcastingOnly";
			else
				throw new TypeError(`${file} の ${entry.Name ?? "名称未設定"} に配信プラットフォームがありません`);

			statistics.platformCombinations[combination]++;
		}
	}

	return statistics;
}

export async function countCreators(dataDirectory) {
	return (await loadMasterStatistics(dataDirectory)).creatorCount;
}
