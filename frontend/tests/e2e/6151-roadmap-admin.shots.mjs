// #6151 — samlet før/efter-billede af Roadmap-fanen under /admin/growth.
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Mønster: 4943-survey.shots.mjs.
//
// Alt er mocket via route-interception (ingen kald mod prod):
//   - fixtures.js' installNetworkMocks + login (samme som de andre shots)
//   - users-opslaget svarer role=admin, rpc roadmap_admin_stats og de fire
//     tabeller/views svarer med realistiske roadmap-data (titler fra
//     docs/drafts/2026-10-04-roadmap-indhold.md afsnit 6c)
//
//   AFTER (branchen)  = dev-server paa feat/6151-roadmap-hub-admin-tab
//   BEFORE (main)     = dev-server startet i hoved-checkoutet
//   node tests/e2e/6151-roadmap-admin.shots.mjs <efter-url> <foer-url> <ud-mappe>
//
// Skriver raa PNG'er + boxes.json; selve sammensaetningen (pins, legende) er i
// pr-screens/6151/6151-foer-efter.html, bygget af build-compose() nederst.

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const AFTER = process.argv[2] || "http://127.0.0.1:5391";
const BEFORE = process.argv[3] || "http://127.0.0.1:5392";
const OUT = resolve(process.argv[4] || resolve(__dirname, "../../../pr-screens/6151"));
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- mock-data
const STATS = { voters: 42, voters_14d: 31, votes_total: 1121, voted_all: 19, managed_teams: 118 };

let n = 0;
const item = (o) => ({
  item_id: `item-${++n}`, approved: true, horizon: "next", issue_ref: null, sd_importance: 0.8,
  avg_idea: null, avg_importance: null, steering_score: null, votes: 0, sort_order: n * 10, ...o,
});

const ROWS = [
  // Planen (planned). avg_importance styrer rækkefølgen.
  item({ status: "planned", engine: "training", title_en: "Secondary type on the rider profile", title_da: "Sekundær type på rytterens profil", avg_importance: 5.21, votes: 38, sort_order: 10 }),
  item({ status: "planned", engine: "races", title_en: "Choose part of a stage race to peak for", title_da: "Vælg del af etapeløb at toppe i", avg_importance: 5.08, votes: 36, sort_order: 20 }),
  item({ status: "planned", engine: "club", title_en: "Message from the team page", title_da: "Besked fra holdsiden", avg_importance: 4.87, votes: 35, sort_order: 30 }),
  item({ status: "planned", engine: "training", title_en: "Peak training for finished riders", title_da: "Formtræning for færdige ryttere", avg_importance: 4.74, votes: 37, sort_order: 40, sd_importance: 1.7 }),
  item({ status: "planned", engine: "youth", title_en: "Your own young stars", title_da: "Egne unge stjerner", avg_importance: 4.61, votes: 33, sort_order: 50 }),
  item({ status: "planned", engine: "races", title_en: "Openers", title_da: "Åbnere", avg_importance: 4.42, votes: 34, sort_order: 60 }),
  item({ status: "planned", engine: "market", title_en: "Transfer list for U23", title_da: "Transferliste til U23", avg_importance: 4.35, votes: 31, sort_order: 70 }),
  item({ status: "planned", engine: "training", title_en: "Copy a day plan", title_da: "Kopiér dagsplan", avg_importance: 4.18, votes: 32, sort_order: 80 }),
  item({ status: "planned", engine: "races", title_en: "Shared captain", title_da: "Delt kaptajn", avg_importance: 4.02, votes: 29, sort_order: 90, issue_ref: 5981 }),
  item({ status: "planned", engine: "market", title_en: "Potential out of the value model", title_da: "Potentiale ud af værdimodellen", avg_importance: 3.88, votes: 27, sort_order: 100 }),
  item({ status: "planned", engine: "club", title_en: "Faster play", title_da: "Hurtigere spil", avg_importance: 3.71, votes: 30, sort_order: 110, sd_importance: 1.9 }),
  item({ status: "planned", engine: "races", title_en: "Own icon for hilly stages", title_da: "Eget ikon for kuperede etaper", avg_importance: 3.2, votes: 24, sort_order: 120, horizon: "later", issue_ref: 6125 }),
  item({ status: "planned", engine: "market", title_en: "Auto-accept price", title_da: "Auto-accept-pris", avg_importance: 2.94, votes: 22, sort_order: 130, horizon: "later", issue_ref: 2176 }),
  // I gang
  item({ status: "in_progress", engine: "training", title_en: "Pick the rider first on the Program tab", title_da: "Vælg rytter først på Program-fanen", sort_order: 10, issue_ref: 6035 }),
  item({ status: "in_progress", engine: "training", title_en: "Development 2.0", title_da: "Udvikling 2.0", sort_order: 20, issue_ref: 6110 }),
  item({ status: "in_progress", engine: "training", title_en: "Train now: run today's training when it suits you", title_da: "Træn nu: kør dagens træning, når det passer dig", sort_order: 30, flag_key: "training_train_now", beta_since: "2026-09-29T08:00:00Z" }),
  item({ status: "in_progress", engine: "training", title_en: "Training groups: one plan for several riders", title_da: "Træningsgrupper: én plan til flere ryttere", sort_order: 40, flag_key: "training_groups", beta_since: "2026-09-30T08:00:00Z" }),
  item({ status: "in_progress", engine: "training", title_en: "Ready-made training programs per race day", title_da: "Færdige træningsprogrammer pr. løbsdag", sort_order: 50, flag_key: "training_programs", beta_since: "2026-10-02T08:00:00Z", beta_soon: true }),
  item({ status: "in_progress", engine: "races", title_en: "Choose if a role applies to the end or this stage only", title_da: "Vælg om en rolle gælder resten af løbet eller kun denne etape", sort_order: 60, flag_key: "race_role_scope_choice", beta_since: "2026-10-03T08:00:00Z" }),
  // Idéer (active + approved)
  item({ status: "active", engine: "races", title_en: "See a rider's age and abilities in a pop-up", title_da: "Se en rytters alder og evner i en popup", avg_idea: 5.41, avg_importance: 4.92, steering_score: 26.6, votes: 40 }),
  item({ status: "active", engine: "training", title_en: "Each ability and power number explained", title_da: "Hver evne og effekt-tal forklaret i klar tekst", avg_idea: 5.12, avg_importance: 4.78, steering_score: 24.5, votes: 39 }),
  item({ status: "active", engine: "races", title_en: "Iconic races written by hand", title_da: "Ikoniske løb skrevet i hånden", avg_idea: 4.96, avg_importance: 4.55, steering_score: 22.6, votes: 36 }),
  item({ status: "active", engine: "market", title_en: "Filter the rider database by division", title_da: "Filtrér rytterdatabasen efter division", avg_idea: 4.88, avg_importance: 4.31, steering_score: 21.0, votes: 38 }),
  item({ status: "active", engine: "club", title_en: "A longer break between seasons", title_da: "En længere pause mellem sæsonerne", avg_idea: 4.51, avg_importance: 4.4, steering_score: 19.8, votes: 37, sd_importance: 1.8 }),
  item({ status: "active", engine: "training", title_en: "Injuries reset at the season switch", title_da: "Skader nulstilles ved sæsonskiftet", avg_idea: 4.62, avg_importance: 4.12, steering_score: 19.0, votes: 35 }),
  item({ status: "active", engine: "youth", title_en: "Homegrown riders: follow every rider from your academy", title_da: "Egne ryttere: følg hver rytter fra din akademi", avg_idea: 4.33, avg_importance: 4.01, steering_score: 17.4, votes: 34 }),
  item({ status: "active", engine: "club", title_en: "Wages paid per race day, like upkeep", title_da: "Løn betalt pr. løbsdag, ligesom vedligehold", avg_idea: 3.9, avg_importance: 3.87, steering_score: 15.1, votes: 33 }),
  // Idé-pulje (active + ikke godkendt)
  item({ status: "active", approved: false, engine: "club", title_en: "Statistics", title_da: "Statistik", votes: 40 }),
  item({ status: "active", approved: false, engine: "club", title_en: "Museum", title_da: "Museum", votes: 39 }),
  item({ status: "active", approved: false, engine: "club", title_en: "Friends", title_da: "Venner", votes: 37 }),
  item({ status: "active", approved: false, engine: "market", title_en: "Negotiation", title_da: "Forhandling", votes: 36 }),
  item({ status: "active", approved: false, engine: "market", title_en: "Rumours", title_da: "Rygter", votes: 35 }),
  item({ status: "active", approved: false, engine: "races", title_en: "National championships", title_da: "Nationale mesterskaber", votes: 34 }),
];

const ITEMS_EXTRA = ROWS.map((r) => ({
  id: r.item_id, flag_key: r.flag_key ?? null, beta_since: r.beta_since ?? null,
  beta_soon: r.beta_soon ?? false, live_soon: r.live_soon ?? false,
}));

const issue = (o) => ({ published: true, issue_ref: null, ...o, issue_id: `issue-${++n}` });
const ISSUES = [
  issue({ status: "confirmed", area: "club", title_en: "Board messages repeat", title_da: "Bestyrelsesbeskeder gentager sig", reports: 12, days_open: 9, issue_ref: 6122 }),
  issue({ status: "fixing", area: "training", title_en: "You can't remove a rider's own plan", title_da: "Du kan ikke fjerne en rytters egen plan eller sætte ham tilbage på holdets program", reports: 5, days_open: 4, issue_ref: 6123 }),
  issue({ status: "confirmed", area: "training", title_en: "Abilities jumped at the season switch", title_da: "Evner sprang ved skiftet", reports: 4, days_open: 11, issue_ref: 6059 }),
  issue({ status: "checking", area: "other", title_en: "Some pages stop loading on mobile", title_da: "Nogle sider holder op med at indlæse på mobilen efter en opdatering", reports: 6, days_open: 17, issue_ref: 5162 }),
  issue({ status: "checking", area: "club", title_en: "Old board target after renegotiating", title_da: "Bestyrelsen kan vise dit gamle mål, efter du har genforhandlet det", reports: 3, days_open: 8, issue_ref: 5946 }),
  issue({ status: "checking", area: "market", title_en: "Rider search finds odd names", title_da: "Ryttersøgningen finder navne, der ikke passer til det, du skrev", reports: 2, days_open: 12, issue_ref: 5941 }),
  issue({ status: "checking", area: "other", title_en: "Deleted reminder comes back", title_da: "En påmindelse om holdudtagelse, som du har slettet, kommer igen", reports: 2, days_open: 6, issue_ref: 5979 }),
  issue({ status: "checking", area: "youth", title_en: "Assistant may fill a U23 squad", title_da: "Assistenten fylder måske et U23-hold op, som du selv har udtaget", reports: 1, days_open: 3, issue_ref: 6124 }),
];
const UPDATES = [
  { issue_id: ISSUES[0].issue_id, body_da: "Årsagen er fundet.", created_at: "2026-10-03T10:00:00Z" },
  { issue_id: ISSUES[1].issue_id, body_da: "Jeg bygger vejen tilbage.", created_at: "2026-10-02T10:00:00Z" },
];
const FLAGS = [
  { key: "training_train_now", stage: "beta" }, { key: "training_groups", stage: "beta" },
  { key: "training_programs", stage: "beta" }, { key: "race_role_scope_choice", stage: "beta" },
];

// ------------------------------------------------------------------ routes
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const ok = (route, body) => route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });

async function installRoadmapRoutes(page) {
  await page.route(/\/rest\/v1\/(users|roadmap_item_scores|roadmap_items|known_issue_scores|known_issue_updates|rpc\/roadmap_admin_stats)/, (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = req.url();
    const wantsObject = (req.headers().accept || "").includes("vnd.pgrst.object");
    if (/\/rest\/v1\/users/.test(url)) {
      const row = { id: "00000000-0000-4000-8000-000000000001", role: "admin", username: "Admin" };
      return ok(route, wantsObject ? row : [row]);
    }
    if (/roadmap_admin_stats/.test(url)) return ok(route, [STATS]);
    if (/roadmap_item_scores/.test(url)) return ok(route, ROWS.map(({ flag_key, beta_since, beta_soon, live_soon, ...r }) => r));
    if (/roadmap_items/.test(url)) return ok(route, ITEMS_EXTRA);
    if (/known_issue_scores/.test(url)) return ok(route, ISSUES);
    return ok(route, UPDATES);
  });
  await page.route(/\/api\/admin\/feature-flags(\?|$)/, (route) => ok(route, { flags: FLAGS }));
  await page.route(/\/api\/admin\/roadmap\/stats(\?|$)/, (route) => ok(route, { stats: STATS }));
}

async function openAdmin(browser, base, withRoadmap) {
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await installNetworkMocks(page);
  if (withRoadmap) await installRoadmapRoutes(page);
  else {
    // Kun admin-rollen, så siden ikke redirecter til /dashboard.
    await page.route(/\/rest\/v1\/users/, (route) => {
      const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
      const row = { id: "00000000-0000-4000-8000-000000000001", role: "admin", username: "Admin" };
      return ok(route, wantsObject ? row : [row]);
    });
  }
  await stabilizePage(page);
  await login(page);
  return { context, page };
}

const browser = await chromium.launch();
const boxes = {};

// ---- I DAG (main)
{
  const { context, page } = await openAdmin(browser, BEFORE, false);
  await page.goto("/admin/growth");
  await page.getByRole("heading", { name: "Vækst-dashboard" }).waitFor();
  await page.waitForTimeout(1500);
  boxes.beforeTabs = await page.getByRole("tab", { name: "Overblik" }).first().evaluate((el) => {
    const r = el.parentElement.getBoundingClientRect();
    return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height };
  }).catch(() => null);
  await page.screenshot({ path: resolve(OUT, "raw-i-dag.png"), fullPage: true });
  await context.close();
}

// ---- EFTER (branch)
{
  const { context, page } = await openAdmin(browser, AFTER, true);
  await page.goto("/admin/growth?tab=roadmap");
  await page.getByText("Planen, som spillerne vil have den", { exact: true }).waitFor({ timeout: 20000 });
  await page.getByText("Bestyrelsesbeskeder gentager sig").waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  boxes.after = await page.evaluate(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height }; };
    const byText = (t) => [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && e.tagName !== "OPTION" && e.textContent.trim() === t);
    const section = (t) => {
      let el = byText(t);
      while (el && !el.querySelector("table, [role='table'], [role='grid']")) el = el.parentElement;
      return el ? rect(el) : null;
    };
    const stats = (() => {
      let el = byText("Har stemt");
      while (el && !(el.textContent.includes("Aktive 14 dage") && el.textContent.includes("Har svaret på alt"))) el = el.parentElement;
      return el ? rect(el) : null;
    })();
    const tab = [...document.querySelectorAll("[role='tab']")].find((e) => e.textContent.trim() === "Roadmap");
    const buttons = [...document.querySelectorAll("button")].filter((b) => ["Nyt punkt", "Ny fejl", "Genindlæs"].includes(b.textContent.trim()));
    const bb = buttons.map(rect);
    const btnBox = bb.length ? { x: Math.min(...bb.map((b) => b.x)), y: Math.min(...bb.map((b) => b.y)), w: Math.max(...bb.map((b) => b.x + b.w)) - Math.min(...bb.map((b) => b.x)), h: bb[0].h } : null;
    return {
      pageHeight: document.documentElement.scrollHeight,
      tab: tab ? rect(tab) : null, buttons: btnBox, stats,
      plan: section("Planen, som spillerne vil have den"),
      progress: section("I gang"),
      ideas: section("Idéer"),
      pool: section("Idé-pulje"),
      confirmed: section("Kendte fejl: bekræftet"),
      checking: section("Kendte fejl: meldt ind, tjekkes"),
    };
  });
  await page.screenshot({ path: resolve(OUT, "raw-efter.png"), fullPage: true });
  await context.close();
}
await browser.close();
writeFileSync(resolve(OUT, "boxes.json"), JSON.stringify(boxes, null, 2));
console.log(JSON.stringify(boxes, null, 2));
