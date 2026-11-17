// MIDLERTIDIG (#8348): maaler DM Sans-tekstbredder i containerens Chromium
// med forskellige font-render-indstillinger. Fjernes foer PR'en er klar.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "package.json"));
const { chromium, webkit, devices } = require("@playwright/test");
const font = readFileSync(path.join(process.cwd(), "public/fonts/dm-sans-latin-wght-normal.woff2"));
const WORDS = ["Udtagelser", "Rutematch", "Form og peak", "Belastning"];
const HTML = `<!doctype html><style>@font-face{font-family:'DM Sans';font-weight:100 1000;src:url('/f.woff2') format('woff2')}
span{font:500 12px 'DM Sans';white-space:nowrap}</style><body>${WORDS.map((w) => `<div><span>${w}</span></div>`).join("")}</body>`;

const variants = [
  ["chromium default", chromium, {}],
  ["chromium --font-render-hinting=none", chromium, { args: ["--font-render-hinting=none"] }],
  ["chromium --font-render-hinting=slight", chromium, { args: ["--font-render-hinting=slight"] }],
  ["chromium --font-render-hinting=medium", chromium, { args: ["--font-render-hinting=medium"] }],
  ["chromium --disable-font-subpixel-positioning", chromium, { args: ["--disable-font-subpixel-positioning"] }],
  ["chromium channel=chromium (new headless)", chromium, { channel: "chromium" }],
  ["chromium channel=chromium + hinting=none", chromium, { channel: "chromium", args: ["--font-render-hinting=none"] }],
  ["webkit default", webkit, {}],
];
const contexts = [["desktop dpr1", { viewport: { width: 390, height: 844 } }], ["Pixel 5", { ...devices["Pixel 5"] }]];

for (const [name, type, opts] of variants) {
  let browser;
  try {
    browser = await type.launch(opts);
  } catch (error) {
    console.log("PROBE8348", name, "LAUNCH FAILED", String(error.message).split("\n")[0]);
    continue;
  }
  for (const [ctxName, ctxOpts] of contexts) {
    if (type === webkit && ctxName === "Pixel 5") continue;
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await page.route("http://probe.local/**", (route) => {
      const url = route.request().url();
      if (url.endsWith(".woff2")) return route.fulfill({ status: 200, contentType: "font/woff2", body: font });
      return route.fulfill({ status: 200, contentType: "text/html", body: HTML });
    });
    await page.goto("http://probe.local/");
    const widths = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.querySelectorAll("span")].map((s) => [s.textContent, s.getBoundingClientRect().width, document.fonts.check("500 12px 'DM Sans'")]);
    });
    console.log("PROBE8348", JSON.stringify({ variant: name, context: ctxName, version: browser.version(), widths }));
    await context.close();
  }
  await browser.close();
}
