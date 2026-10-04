import { chromium } from "../../frontend/node_modules/@playwright/test/index.mjs";
import { resolve, dirname } from "node:path"; import { fileURLToPath, pathToFileURL } from "node:url";
const d = dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 2000, height: 800 }, deviceScaleFactor: 1.5 });
await p.goto(pathToFileURL(resolve(d, "6154-foer-efter.html")).href); await p.waitForTimeout(500);
await p.screenshot({ path: resolve(d, "6154-foer-efter.png"), fullPage: true }); await b.close();
