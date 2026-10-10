import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const dir = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(pathToFileURL(resolve(dir, "../../frontend/node_modules/@playwright/test/index.mjs")).href);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1640, height: 400 }, deviceScaleFactor: 1 });
await p.goto(pathToFileURL(resolve(dir, process.argv[2] + ".html")).href); await p.waitForTimeout(800);
await p.screenshot({ path: resolve(dir, process.argv[2] + ".png"), fullPage: true }); await b.close();
