// Bygger 6151-foer-efter.html + .png ud fra raw-i-dag.png, raw-efter.png og boxes.json
// (skrevet af frontend/tests/e2e/6151-roadmap-admin.shots.mjs).
//   node pr-screens/6151/build-compose.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const boxes = JSON.parse(readFileSync(resolve(dir, "boxes.json"), "utf8")).after;
const W = 1100, S = W / 1440, GAP = 40, M = 30, TOP = 64;
const SPLIT = 2244; // mellem Idéer (slutter ca. 2237) og Idé-pulje (starter ca. 2251)
const H = boxes.pageHeight;
const cols = [M, M + W + GAP, M + 2 * (W + GAP)];
const colsH = Math.round(SPLIT * S);
const bH = Math.round((H - SPLIT) * S);
const dagH = Math.round(900 * S);

const pin = (n, x, y) => `<div class="pin" style="left:${x - 13}px;top:${y - 13}px">${n}</div>`;
const rect = (x, y, w, h, dashed) => `<div class="rect${dashed ? " dashed" : ""}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`;
function mark(n, b, col, oy, dashed) {
  const x = cols[col] + b.x * S, y = TOP + (b.y - oy) * S;
  return rect(x - 3, y - 3, b.w * S + 6, b.h * S + 6, dashed) + pin(n, x - 3, y - 3);
}

const parts = [];
const title = (t, col) => `<div class="title" style="left:${cols[col]}px">${t}</div>`;
parts.push(title("I DAG (main): /admin/growth har ingen Roadmap-fane", 0));
parts.push(title("EFTER #6151: ?tab=roadmap, del 1", 1));
parts.push(title("EFTER #6151: del 2 (samme side, nedenunder)", 2));

parts.push(`<img class="shot" src="raw-i-dag.png" style="left:${cols[0]}px;top:${TOP}px;width:${W}px;height:${dagH}px">`);
parts.push(`<div class="note" style="left:${cols[0]}px;top:${TOP + dagH + 14}px;width:${W}px">Samme side på main. Ingen fane, ingen roadmap-data i admin. (Oversigten er tom, fordi mock-data kun dækker Roadmap-fanen.)</div>`);
parts.push(`<div class="crop" style="left:${cols[1]}px;top:${TOP}px;width:${W}px;height:${colsH}px"><img src="raw-efter.png" style="width:${W}px;height:${Math.round(H * S)}px;top:0"></div>`);
parts.push(`<div class="crop" style="left:${cols[2]}px;top:${TOP}px;width:${W}px;height:${bH}px"><img src="raw-efter.png" style="width:${W}px;height:${Math.round(H * S)}px;top:${-Math.round(SPLIT * S)}px"></div>`);

// I DAG: den manglende fane
parts.push(mark(1, boxes.tab, 0, 0, true));
// EFTER del 1
parts.push(mark(1, boxes.tab, 1, 0));
parts.push(mark(1, boxes.buttons, 1, 0));
parts.push(mark(2, boxes.stats, 1, 0));
parts.push(mark(3, boxes.plan, 1, 0));
parts.push(mark(4, boxes.progress, 1, 0));
parts.push(mark(5, boxes.ideas, 1, 0));
// EFTER del 2
parts.push(mark(5, boxes.pool, 2, SPLIT));
parts.push(mark(6, boxes.confirmed, 2, SPLIT));
parts.push(mark(6, boxes.checking, 2, SPLIT));

const legendTop = TOP + Math.max(colsH, bH, dagH + 60) + 30;
const legend = [
  "Ny fane Roadmap (I dag findes den ikke), med knapperne Nyt punkt, Ny fejl og Genindlæs.",
  "Nøgletal: 42 har stemt, 31 aktive seneste 14 dage, 1.121 stemmer, 19 har svaret på alt.",
  "Planen, som spillerne vil have den: rangeret efter vigtighed, med din rækkefølge, flyt, status, Next/Later, Ret og Del.",
  "I gang: beta-koblingen viser kontakt (flag) og beta-startdato pr. punkt.",
  "Idéer rangeret efter score, og Idé-pulje med skjulte idéer (Til planen, Tag af Vote, Vis på Vote).",
  "Kendte fejl i to tabeller (bekræftet, meldt ind og tjekkes), flest ramte først, med Ny opdatering og Trin.",
].map((t, i) => `<div class="leg"><b>${i + 1}</b> ${t}</div>`).join("");
const totalW = cols[2] + W + M;
const totalH = legendTop + 6 * 34 + 50;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>6151 før og efter</title><style>
body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;width:${totalW}px;height:${totalH}px;position:relative;color:#111}
.title{position:absolute;top:18px;font-size:26px;font-weight:700}
.shot,.crop{position:absolute;border:1px solid #ccc;box-sizing:border-box}
.crop{overflow:hidden}.crop img{position:absolute;left:0}
.rect{position:absolute;border:3px solid #d62828;box-sizing:border-box}.rect.dashed{border-style:dashed}
.pin{position:absolute;width:26px;height:26px;border-radius:50%;background:#d62828;color:#fff;font-weight:700;font-size:15px;line-height:26px;text-align:center;border:2px solid #fff;box-sizing:border-box;box-shadow:0 0 0 1px #d62828}
.note{position:absolute;font-size:16px;color:#555}
.leg{position:absolute;left:${M}px;font-size:21px}.leg b{display:inline-block;width:26px;height:26px;border-radius:50%;background:#d62828;color:#fff;text-align:center;line-height:26px;font-size:15px;margin-right:10px}
${[0, 1, 2, 3, 4, 5].map((i) => `.leg:nth-of-type(${i + 1}){top:${legendTop + i * 34}px}`).join("")}
</style></head><body>${parts.join("")}<div id="legend">${legend}</div></body></html>`;
// nth-of-type regner kun div'er under #legend, så brug eksplicitte tops i stedet
const html2 = html.replace(/\.leg:nth-of-type[^}]*}/g, "").replace('<div id="legend">', "<div id=\"legend\">")
  .replace(/<div class="leg">/g, (() => { let i = 0; return () => `<div class="leg" style="top:${legendTop + i++ * 34}px">`; })());
writeFileSync(resolve(dir, "6151-foer-efter.html"), html2);

const { chromium } = await import(pathToFileURL(resolve(dir, "../../frontend/node_modules/@playwright/test/index.mjs")).href);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: totalW, height: totalH }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve(dir, "6151-foer-efter.html")).href);
await page.waitForTimeout(500);
await page.screenshot({ path: resolve(dir, "6151-foer-efter.png"), fullPage: true });
await browser.close();
console.log("ok", totalW, totalH);
