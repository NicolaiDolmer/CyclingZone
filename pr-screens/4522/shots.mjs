import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const dir = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(pathToFileURL(resolve(dir, "../../frontend/node_modules/@playwright/test/index.mjs")).href);
const b = await chromium.launch();
// Opdigtede ryttere (samme navne som det gamle billede); kun til skaermbilledet.
const EXTRA = [["Jonas","Madsen","sprinter"],["Emil","Holm","sprinter"],["Oskar","Krag","sprinter"],["Anton","Bruun","climber"],["Mikkel","Dahl","climber"],["Frederik","Moe","climber"],["Lasse","Winge","rouleur"],["Peter","Vang","rouleur"],["Viktor","Lund","sprinter"]];
for (const [w, h, tag] of [[1440, 1000, "1440"], [390, 844, "390"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.addInitScript(() => { localStorage.setItem("cz_lang", "en"); localStorage.setItem("cz_consent_v1", JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false, email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z" })); });
  await p.goto("http://localhost:5291/login", { waitUntil: "networkidle" });
  await p.locator('input[type="email"]').fill("e2e@example.com");
  await p.locator('input[type="password"]').fill("playwright-password");
  await p.locator('input[type="password"]').press("Enter");
  await p.waitForURL(/dashboard/, { timeout: 15000 });
  await p.evaluate((extra) => {
    const orig = window.fetch;
    window.fetch = async (...a) => {
      const res = await orig(...a);
      const url = String(a[0]?.url ?? a[0]);
      if (/\/rest\/v1\/riders\?/.test(url) && /team_id=eq/.test(url) && /primary_type/.test(url)) {
        const data = await res.clone().json();
        if (Array.isArray(data) && data.length === 1) {
          const base = data[0];
          const more = extra.map(([f, l, t], i) => ({ ...base, id: `00000000-0000-4000-8000-0000000045${String(i).padStart(2, "0")}`, firstname: f, lastname: l, primary_type: t, secondary_type: null }));
          return new Response(JSON.stringify([base, ...more]), { status: 200, headers: res.headers });
        }
      }
      return res;
    };
  }, EXTRA);
  await p.evaluate(() => { history.pushState({}, "", "/training"); dispatchEvent(new PopStateEvent("popstate")); });
  await p.waitForTimeout(2500);
  { const btn = (await p.getByTestId("training-assistant-button").first().isVisible()) ? p.getByTestId("training-assistant-button").first() : p.locator("button:visible").filter({ hasText: /assistant/i }).first(); console.log(tag, "btn visible:", await btn.isVisible()); await btn.click({ force: true, timeout: 5000 }); }
  await p.waitForTimeout(800);
  console.log(tag, "program section:", await p.getByTestId("assistant-program-section").count());
  const target = p.locator("xpath=//p[normalize-space()='Assistant suggestions']/ancestor::div[.//button[contains(., 'Dismiss')]][1]").first();
  await target.scrollIntoViewIfNeeded();
  await target.screenshot({ path: resolve(dir, `after-closed-${tag}.png`) });
  const fold = p.getByTestId("assistant-rider-fold");
  if (await fold.count()) { await fold.locator("summary").click(); await p.waitForTimeout(300); await target.screenshot({ path: resolve(dir, `after-open-${tag}.png`) }); }
  await p.close();
}
await b.close();
