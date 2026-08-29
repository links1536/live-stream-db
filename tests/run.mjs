import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const testFiles = (await readdir(testsDirectory))
	.filter(fileName => fileName.endsWith(".test.mjs"))
	.sort();

for (const testFile of testFiles) {
	await import(pathToFileURL(join(testsDirectory, testFile)).href);
}
