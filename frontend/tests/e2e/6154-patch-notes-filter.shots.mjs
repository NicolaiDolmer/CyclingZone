// #6154 - foer/efter-skaermbilleder af patch notes-filteret (PR #6163).
// Ad-hoc capture-script (ikke en del af CI-suiten). Kraever to statiske builds:
//   node tests/e2e/6154-patch-notes-filter.shots.mjs <distFoer> <distEfter> <outDir>
// Serverer hver dist med scripts/e2e-static-server.mjs paa egen port og lukker dem igen.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(__dirname, "../..");
const { installNetworkMocks } = await import(pathToFileURL(resolve(__dirname, "fixtures.js")).href);

const [FOER, EFTER, OUT] = process.argv.slice(2).map((p) => resolve(p));
mkdirSync(OUT, { recursive: true });

function serve(frontendDir, port) {
  const p = spawn(process.execPath, [resolve(frontendDir, "scripts/e2e-static-server.mjs"), "--host", "127.0.0.1", "--port", String(port)], {
    cwd: frontendDir, stdio: "ignore",
  });
  return p;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// FOER/EFTER peger paa frontend-mapper (med dist/)
const servers = [serve(FOER, 5311), serve(EFTER, 5312)];
await wait(2500);

const FLAGS = { training_programs: true, rider_best_role_display: true, season_matrix_mobile: false, training_groups: false };

async function prep(page) {
  await installNetworkMocks(page);
  await page.route("**/api/feature-flags*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ flags: FLAGS }) }));
  await page.addInitScript(() => {
    localStorage.setItem("cz_lang", "en");
    localStorage.setItem("cz_patchnotes_last_seen", "2099-01-01");
    localStorage.setItem("cz_consent_v1", JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false, email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z" }));
    const css = "*,*::before,*::after{animation-duration:.001s!important;transition-duration:0s!important;caret-color:transparent!important}";
    document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }, { once: true });
  });
}

const browser = await chromium.launch();
const meta = {};
try {
  for (const [name, port, vp] of [
    ["foer-1440", 5311, { width: 1440, height: 900 }],
    ["efter-1440", 5312, { width: 1440, height: 900 }],
    ["efter-390", 5312, { width: 390, height: 844 }],
    ["foer-390", 5311, { width: 390, height: 844 }],
  ]) {
    const ctx = await browser.newContext({ baseURL: `http://127.0.0.1:${port}`, viewport: vp, deviceScaleFactor: 2, locale: "en-GB" });
    const page = await ctx.newPage(); page.on("console", (m) => { if (m.type() === "error") console.log(name, "CONSOLE", m.text().slice(0, 200)); }); page.on("response", (r) => { if (r.status() >= 400) console.log(name, r.status(), r.url()); }); page.on("pageerror", (e) => console.log(name, "PAGEERROR", String(e).slice(0, 300)));
    await prep(page);
    await page.goto("/patch-notes");
    await page.waitForTimeout(2500);
    // Soeg paa "beta group": faar de beta-noter frem hvor kontakten er slaaet til (training_programs, rider_best_role_display).
    await page.getByPlaceholder(/Search/).fill("in the beta group");
    await page.waitForTimeout(1200);
    // fold alle dage ud (knapper med dato-overskrift)
    const heads = page.locator("button[aria-expanded='false']").filter({ hasText: /\d{1,2} (September|October)/ });
    for (let i = await heads.count(); i > 0; i--) await heads.nth(i - 1).click();
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: resolve(OUT, `raw-${name}.png`), fullPage: true });
    meta[name] = await page.evaluate((off) => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x - off.x, y: r.y + window.scrollY, w: r.width, h: r.height }; };
      const chips = [...document.querySelectorAll("span")].filter((e) => /^(beta|switched on|now live for all)$/i.test(e.textContent.trim()) && e.children.length === 0);
      const seg = document.querySelector('[role="radiogroup"], [role="group"][aria-label*="ollout" i], [aria-label*="ollout" i]');
      return { chips: chips.map((e) => ({ t: e.textContent.trim(), ...box(e), row: (e.parentElement.textContent || "").slice(0, 80) })), seg: seg ? box(seg) : null };
    }, { x: 0 });
    await ctx.close();
  }
} finally {
  await browser.close();
  servers.forEach((s) => s.kill());
}
writeFileSync(resolve(OUT, "raw-meta.json"), JSON.stringify(meta, null, 2));
console.log("done", OUT);
