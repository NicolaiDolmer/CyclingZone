// #6150 — samlet før/efter-billede af /roadmap (spillersiden i fem faner).
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Mønster: 6151-roadmap-admin.shots.mjs.
//
// Alt er mocket via route-interception (ingen kald mod prod, ingen skrivning):
// fixtures.js' installNetworkMocks + login, og derefter egne svar for
// roadmap_items, known_issues, known_issue_updates, roadmap_votes,
// known_issue_reports og /api/me/beta-access. Titlerne er de rigtige punkter fra
// docs/drafts/2026-10-04-roadmap-indhold.md (afsnit 1, 2, 3, 5.6 og 6c), på
// engelsk som spilleren ser dem, rettet efter ejerens godkendelser i afsnit 8
// (4/10): minimumspris ud af Vote, skader nulstilles flyttet til planen, ingen
// Pro-betaling og ingen skjult N15 på planen, ingen "For everyone soon", og
// "Coming to beta" har kun N4. Kendte fejls titel og første opdatering er
// ordret fra afsnit 3.
//
//   EFTER (branchen) = vite preview af branchens dist
//   I DAG (main)     = vite preview af en main-build
//   node tests/e2e/6150-roadmap-hub.shots.mjs <efter-url> <i-dag-url> <ud-mappe>
//
// <i-dag-url> = "reuse" genbruger raw-i-dag.png og boxes.before fra en tidligere
// kørsel i ud-mappen (main-siden har ikke ændret sig), så kun EFTER tages om.
//
// Skriver raa PNG'er, boxes.json, foer-efter.html og foer-efter.png i ud-mappen.

import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, TEST_USER } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const AFTER = process.argv[2] || "http://127.0.0.1:4736";
const BEFORE = process.argv[3] || "http://127.0.0.1:4737";
const OUT = resolve(process.argv[4] || resolve(__dirname, "../../../pr-screens/6150"));
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- mock-data
let n = 0;
const OLD = "2026-09-20T08:00:00Z";
const NEW = "2026-10-03T08:00:00Z"; // nyere end last-seen nedenfor: gul prik
const item = (o) => ({
  id: `item-${String(++n).padStart(2, "0")}`, engine: "training", sort_order: n * 10, title_da: "",
  approved: true, status: "active", horizon: "next", beta_since: null, beta_soon: false, live_soon: false,
  created_at: OLD, shipped_at: null, ...o,
});
const da = (t) => t; // DA-titlerne vises ikke (EN-visning); feltet skal bare findes

const ITEMS = [
  // Plan: i gang (afsnit 6c "In progress": N4, N9)
  item({ status: "in_progress", engine: "training", title_en: "On the Program tab, pick the rider first and then his program.", beta_soon: true }),
  item({ status: "in_progress", engine: "training", title_en: "Development 2.0: one clear development curve, racing that pays off by role, and a decline in older riders you can slow down." }),
  // Plan: Next (afsnit 8, liste 2: ejerens rækkefølge). "Potentiale ud af
  // værdimodellen" mangler, fordi udkastet ikke har en EN-titel til det.
  item({ status: "planned", engine: "races", title_en: "Secondary rider type explained" }),
  item({ status: "planned", engine: "races", title_en: "Peak where in a stage race, main + backup goal" }),
  item({ status: "planned", engine: "training", title_en: "Race sharpener" }),
  item({ status: "planned", engine: "training", title_en: "Form training for finished riders" }),
  item({ status: "planned", engine: "youth", title_en: "Your own young stars (country/types)" }),
  item({ status: "planned", engine: "club", title_en: "Send a message to another manager straight from his team page." }),
  item({ status: "planned", engine: "youth", title_en: "Move a rider from the transfer list to your U23 squad." }),
  item({ status: "planned", engine: "training", title_en: "Copy one day's training plan to the next days.", created_at: NEW }),
  item({ status: "planned", engine: "training", title_en: "Injuries reset at the season switch, the same way fatigue does." }),
  item({ status: "planned", engine: "races", title_en: "A shared captain: a second rider with his own GC chance, without a free role's breakaway or a helper's sacrifice." }),
  item({ status: "planned", engine: "club", title_en: "A faster game: pages that open quickly, also on your phone." }),
  // Plan: Later (afsnit 6c)
  item({ status: "planned", horizon: "later", engine: "races", title_en: "Road captains and mentors" }),
  item({ status: "planned", horizon: "later", engine: "club", title_en: "New dashboard and inbox" }),
  item({ status: "planned", horizon: "later", engine: "races", title_en: "Ride for a jersey from day one" }),
  item({ status: "planned", horizon: "later", engine: "club", title_en: "The team meeting" }),
  item({ status: "planned", horizon: "later", engine: "races", title_en: "Conditional orders: tell a rider what to do if something happens, for example chase only if other teams help." }),
  item({ status: "planned", horizon: "later", engine: "races", title_en: "Team time trials: your riders ride together against the clock and get the team's time." }),
  // Beta (afsnit 6c, 5 punkter)
  item({ status: "in_progress", engine: "training", title_en: "Train now: run today's training when it suits you, with the same result as the evening run.", beta_since: "2026-09-29T08:00:00Z" }),
  item({ status: "in_progress", engine: "training", title_en: "Training groups: one plan for several riders, and each rider keeps his own copy.", beta_since: "2026-09-30T08:00:00Z" }),
  item({ status: "in_progress", engine: "training", title_en: "Ready-made training programs per race day.", beta_since: "2026-10-02T08:00:00Z" }),
  item({ status: "in_progress", engine: "races", title_en: "The season matrix in Planning fits your phone screen.", beta_since: "2026-10-01T08:00:00Z" }),
  item({ status: "in_progress", engine: "races", title_en: "Choose whether a role applies from this stage to the end, or to this stage only.", beta_since: "2026-10-03T08:00:00Z", created_at: NEW }),
  // Vote: 10 af de 28 idéer (afsnit 6c minus de to, afsnit 8 tog ud)
  item({ engine: "races", title_en: "See a rider's age and abilities in a pop-up while you plan training or use the Planning board." }),
  item({ engine: "races", title_en: "Iconic races are written by hand, so a classic stays the same classic every season." }),
  item({ engine: "races", title_en: "AI teams field riders that fit their division, so Division 4 is no walkover." }),
  item({ engine: "training", title_en: "Each ability and power number explained in plain words when you hover over it or tap it." }),
  item({ engine: "training", title_en: "See on the training page how many days until each rider's next race." }),
  item({ engine: "youth", title_en: "Lower age limits for the youth classification and juniors." }),
  item({ engine: "youth", title_en: "Prize money in youth races." }),
  item({ engine: "market", title_en: "Filter the rider database by division." }),
  item({ engine: "club", title_en: "A longer break between seasons, with time to plan the new one." }),
  item({ engine: "club", title_en: "See which riders the board counts as your stars." }),
  // Done (afsnit 1 "S" + afsnit 2 "Nye Done-rækker")
  item({ status: "shipped", engine: "races", title_en: "Why a stage went the way it did", shipped_at: "2026-10-02T12:00:00Z" }),
  item({ status: "shipped", engine: "training", title_en: "Real training depth: programs per rider", shipped_at: "2026-10-01T12:00:00Z" }),
  item({ status: "shipped", engine: "training", title_en: "Plan a whole week per rider", shipped_at: "2026-10-01T11:00:00Z" }),
  item({ status: "shipped", engine: "training", title_en: "Auto-rest at a fatigue limit", shipped_at: "2026-10-01T10:00:00Z" }),
  item({ status: "shipped", engine: "training", title_en: "One tap for Rest, Recovery or Program on your phone.", shipped_at: "2026-10-01T09:00:00Z" }),
  item({ status: "shipped", engine: "training", title_en: "See how tired each rider will be tonight before you choose.", shipped_at: "2026-10-01T08:00:00Z" }),
  item({ status: "shipped", engine: "training", title_en: "Racing trains your riders: a rider develops from the race itself.", shipped_at: "2026-09-28T12:00:00Z" }),
  item({ status: "shipped", engine: "club", title_en: "Upkeep per race day", shipped_at: "2026-09-27T12:00:00Z" }),
  item({ status: "shipped", engine: "club", title_en: "The new board: one confidence score, one mandate, an annual meeting.", shipped_at: "2026-09-27T11:00:00Z" }),
  item({ status: "shipped", engine: "youth", title_en: "U23 and junior squads, promotion paths", shipped_at: "2026-09-26T12:00:00Z" }),
].map((i) => ({ ...i, title_da: da(i.title_en) }));

const byTitle = (start) => ITEMS.find((i) => i.title_en.startsWith(start)).id;
const uid = TEST_USER.id;
const vote = (start, idea, importance) => ({ item_id: byTitle(start), idea_score: idea, importance_score: importance, user_id: uid });
const VOTES = [
  // Plan: tre punkter har en vigtighed
  vote("Secondary rider type", null, 6),
  vote("Race sharpener", null, 4),
  vote("A faster game", null, 5),
  // Vote: tre besvaret helt, én kun første trin
  vote("See a rider's age", 5, 6),
  vote("Each ability and power", 6, 5),
  vote("Filter the rider database", 4, 3),
  vote("Prize money in youth", 5, null),
];

let k = 0;
const issue = (o) => ({
  id: `issue-${++k}`, sort_order: k * 10, published: true, created_at: "2026-09-26T08:00:00Z",
  updated_at: "2026-10-01T08:00:00Z", closed_at: null, ...o,
});
const ISSUES = [
  // Confirmed (fordeling fra afsnit 5.6, titler ordret fra afsnit 3)
  issue({ status: "fixing", area: "training", title_en: "Fatigue and form moved far more in a day than they should.", updated_at: "2026-10-03T08:00:00Z" }),
  issue({ status: "confirmed", area: "races", title_en: "A dangerous GC rider can get into the break without the GC teams reacting.", updated_at: "2026-10-02T08:00:00Z" }),
  issue({ status: "confirmed", area: "training", title_en: "You can't remove a rider's own plan or put him back on the team program.", updated_at: "2026-10-03T08:00:00Z" }),
  // Reported, being checked (fordeling fra afsnit 5.6, titler ordret fra afsnit 3)
  issue({ status: "checking", area: "club", title_en: "Board messages repeat after you negotiate, and the 3-year plan prompt leads nowhere." }),
  issue({ status: "checking", area: "training", title_en: "Riders seem to develop more slowly with the new training." }),
  issue({ status: "checking", area: "other", title_en: "A squad selection reminder you deleted comes back." }),
  // Fixed seneste 14 dage (afsnit 5.6)
  issue({ status: "fixed", area: "races", title_en: "The chase pushed breakaway riders backwards", closed_at: "2026-10-02T12:00:00Z" }),
].map((i) => ({ ...i, title_da: i.title_en }));
// Første opdatering for hver bekræftet fejl, ordret fra afsnit 3 (EN / DA).
const UPDATES = [
  { id: "u1", issue_id: ISSUES[0].id, body_en: "Fatigue and form were recalculated with the fixed model, and earlier training was restored for affected riders. A few cases are still being reviewed.", body_da: "Træthed og form er regnet om med den rettede model, og tidligere træning er genoprettet for de berørte ryttere. Nogle få tilfælde gennemgås stadig.", created_at: "2026-10-03T10:00:00Z" },
  { id: "u2", issue_id: ISSUES[1].id, body_en: "On the new race rules, GC teams react with their free helpers when a threat is up the road. I still get reports of GC riders getting away, and I'm checking them against the standings before the stage.", body_da: "Med de nye løbsregler reagerer klassementsholdene med deres ledige hjælpere, når en trussel er kørt væk. Jeg får stadig meldinger om klassementsryttere, der slipper afsted, og tjekker dem op mod stillingen før etapen.", created_at: "2026-10-02T10:00:00Z" },
  { id: "u3", issue_id: ISSUES[2].id, body_en: "Reported by players. I'm checking the training page and adding a way back to the team program if it's missing.", body_da: "Meldt ind af spillere. Jeg tjekker træningssiden og tilføjer en vej tilbage til holdets program, hvis den mangler.", created_at: "2026-10-03T09:00:00Z" },
];
const REPORTS = [{ issue_id: ISSUES[3].id, user_id: uid }];

// ------------------------------------------------------------------ routes
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const ok = (route, body) => route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });

async function installRoadmapRoutes(page) {
  await page.route(/\/rest\/v1\/(roadmap_items|known_issues|known_issue_updates|roadmap_votes|known_issue_reports)(\?|$)/, (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (req.method() !== "GET") return route.fulfill({ status: 403, headers: CORS, body: "{}" }); // ingen skrivning
    const url = new URL(req.url());
    const table = url.pathname.split("/").pop();
    // Respektér status=in.(...) som PostgREST, saa main kun faar det, main beder om.
    const st = url.searchParams.get("status");
    const wanted = st?.startsWith("in.(") ? st.slice(4, -1).split(",") : null;
    const items = wanted ? ITEMS.filter((i) => wanted.includes(i.status)) : ITEMS;
    const data = { roadmap_items: items, known_issues: ISSUES, known_issue_updates: UPDATES, roadmap_votes: VOTES, known_issue_reports: REPORTS }[table];
    return ok(route, data);
  });
  await page.route(/\/api\/me\/beta-access/, (route) => ok(route, { state: "none" }));
}

async function open(browser, base, { width, height, onlyUnrated }) {
  const context = await browser.newContext({ baseURL: base, viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await installNetworkMocks(page);
  await installRoadmapRoutes(page);
  await stabilizePage(page);
  // Efter stabilizePage (som laaser DA til login-fixturen): skift til EN, naar
  // flaget er sat, og laas last-seen + filteret, saa billedet er deterministisk.
  await page.addInitScript(({ onlyUnrated }) => {
    if (sessionStorage.getItem("cz_shot_en") === "1") localStorage.setItem("cz_lang", "en");
    localStorage.setItem("cz_roadmap_last_seen", "2026-10-02T00:00:00.000Z");
    localStorage.setItem("cz_roadmap_only_unrated", onlyUnrated ? "1" : "0");
  }, { onlyUnrated });
  await login(page);
  await page.evaluate(() => sessionStorage.setItem("cz_shot_en", "1"));
  return { context, page };
}

const rectOf = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height };
});
async function rel(container, loc) {
  const b = await rectOf(loc.first());
  return { x: b.x - container.x, y: b.y - container.y, w: b.w, h: b.h };
}

const browser = await chromium.launch();
const boxes = {};

// ---- I DAG (main)
const PAD = 16;
const REUSE_BEFORE = BEFORE === "reuse";
if (REUSE_BEFORE) {
  const prev = resolve(OUT, "boxes.json");
  if (!existsSync(prev) || !existsSync(resolve(OUT, "raw-i-dag.png"))) throw new Error("reuse kræver boxes.json og raw-i-dag.png i ud-mappen");
  boxes.before = JSON.parse(readFileSync(prev, "utf8")).before;
} else {
  const { context, page } = await open(browser, BEFORE, { width: 1440, height: 900, onlyUnrated: true });
  await page.goto("/roadmap");
  await page.getByText("See a rider's age", { exact: false }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  const c = await rectOf(page.getByRole("heading", { name: "Roadmap" }).first().locator("xpath=ancestor::div[contains(@class,'max-w-')][1]"));
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const clipH = 1350;
  const col = { x: c.x - PAD, y: 0, w: c.w + 2 * PAD, h: clipH };
  boxes.before = {
    col, pageHeight, screens: +(pageHeight / 900).toFixed(1),
    header: await rel(col, page.getByRole("heading", { name: "Roadmap" })),
    scales: await rel(col, page.getByText("How good an idea?").first().locator("xpath=../..")),
  };
  await page.screenshot({ path: resolve(OUT, "raw-i-dag.png"), fullPage: true, clip: { x: col.x, y: 0, width: col.w, height: clipH } });
  await context.close();
}

// ---- EFTER (branchen), 1440 px, alle fem faner
const TABS = [
  { tab: "plan", wait: "Secondary rider type explained" },
  { tab: "beta", wait: "In beta now" },
  { tab: "vote", wait: "Ideas I am considering" },
  { tab: "issues", wait: "Fatigue and form moved far more" },
  { tab: "done", wait: "Why a stage went the way it did" },
];
boxes.after = {};
{
  const { context, page } = await open(browser, AFTER, { width: 1440, height: 900, onlyUnrated: false });
  for (const { tab, wait } of TABS) {
    await page.goto(`/roadmap?tab=${tab}`);
    await page.getByText(wait).first().waitFor({ timeout: 20000 });
    if (tab === "plan") await page.getByText(/^Later · /).first().click(); // fold Later ud
    await page.waitForTimeout(800);
    const c = await rectOf(page.locator("main .max-w-4xl").first());
    const col = { x: c.x - PAD, y: c.y - PAD, w: c.w + 2 * PAD, h: c.h + 2 * PAD };
    const b = { col };
    b.tabs = await rel(col, page.getByRole("tablist"));
    if (tab === "plan") {
      b.filter = await rel(col, page.getByText(/^Rated \d+ of \d+$/).locator("xpath=.."));
      b.scale = await rel(col, page.getByRole("radiogroup").first());
      b.later = await rel(col, page.getByText(/^Later · /));
      b.newDot = await rel(col, page.getByText("Copy one day's training plan", { exact: false }));
    }
    if (tab === "beta") {
      b.join = await rel(col, page.getByText("Join the beta", { exact: true }));
      b.soon = await rel(col, page.getByText("On the Program tab, pick the rider first", { exact: false }));
    }
    if (tab === "vote") {
      b.answered = await rel(col, page.getByText("See a rider's age", { exact: false }));
      b.open = await rel(col, page.getByText("Iconic races are written by hand", { exact: false }));
    }
    if (tab === "issues") {
      b.updates = await rel(col, page.getByText("Fatigue and form were recalculated", { exact: false }).locator("xpath=.."));
      b.checking = await rel(col, page.getByText("Players have reported these", { exact: false }));
      b.report = await rel(col, page.getByRole("button", { name: "Reported" }));
    }
    if (tab === "done") b.first = await rel(col, page.getByText("The chase pushed breakaway riders backwards"));
    await page.screenshot({ path: resolve(OUT, `raw-efter-${tab}.png`), fullPage: true, clip: { x: col.x, y: col.y, width: col.w, height: col.h } });
    boxes.after[tab] = b;
  }
  await context.close();
}

// ---- EFTER, Vote i 390 px (filteret som standard: kun ubedømte). Viewporten
// gøres lige så høj som siden, så den faste bundmenu står nederst og ikke midt i.
{
  const { context, page } = await open(browser, AFTER, { width: 390, height: 844, onlyUnrated: true });
  await page.goto("/roadmap?tab=vote");
  await page.getByText("Ideas I am considering").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 390, height: h });
  await page.waitForTimeout(600);
  const col = { x: 0, y: 0, w: 390, h };
  boxes.mobile = {
    col,
    tabs: await rel(col, page.getByRole("tablist")),
    areas: await page.evaluate(() => {
      const els = [...document.querySelectorAll("main *")].filter((e) => {
        const t = e.textContent;
        return t.startsWith("All") && t.includes("Races") && t.includes("Club") && e.children.length >= 3;
      });
      const el = els.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0];
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y + scrollY, w: Math.min(r.width, 390 - r.x), h: r.height };
    }),
  };
  await page.screenshot({ path: resolve(OUT, "raw-efter-vote-390.png") });
  await context.close();
}
await browser.close();
writeFileSync(resolve(OUT, "boxes.json"), JSON.stringify(boxes, null, 2));

// ------------------------------------------------------------- sammensætning
// Ét billede: I DAG til venstre, EFTER i tre kolonner. Alt i 1:1 CSS-px (de raa
// billeder er 2x), så teksten er læsbar i fuld bredde.
const M = 40, GAP = 48, HEAD = 120, LABEL = 44;
const B = boxes.before, A = boxes.after, MB = boxes.mobile;
const BW = 900, BS = BW / B.col.w; // I DAG skaleres en smule ned (bredere side)
const CW = A.plan.col.w;
const xB = M, xR = M + BW + GAP * 2;
const xc = [xR, xR + CW + GAP, xR + 2 * (CW + GAP)];
const blocks = [];
const place = (key, src, x, y, w, h, s, label) => { blocks.push({ key, src, x, y, w, h, s, label }); return y + LABEL + h + GAP; };
let y1 = HEAD, y2 = HEAD, y3 = HEAD;
const lab = (t) => t;
y1 = place("plan", "raw-efter-plan.png", xc[0], y1, CW, A.plan.col.h, 1, lab("Plan (1440 px)"));
y1 = place("beta", "raw-efter-beta.png", xc[0], y1, CW, A.beta.col.h, 1, lab("Beta (1440 px)"));
y2 = place("vote", "raw-efter-vote.png", xc[1], y2, CW, A.vote.col.h, 1, lab("Vote (1440 px)"));
y2 = place("done", "raw-efter-done.png", xc[1], y2, CW, A.done.col.h, 1, lab("Done (1440 px)"));
y3 = place("issues", "raw-efter-issues.png", xc[2], y3, CW, A.issues.col.h, 1, lab("Known issues (1440 px)"));
y3 = place("mobile", "raw-efter-vote-390.png", xc[2], y3, 390, MB.col.h, 1, lab("Vote på telefon (390 px), filteret slået til som standard"));
let yB = place("before", "raw-i-dag.png", xB, HEAD, BW, Math.round(B.col.h * BS), BS, lab("/roadmap på main, indlogget (de første 1,5 skærme)"));

const pins = [];
const pin = (n, block, box, dashed = false) => pins.push({ n, block, box, dashed });
pin(1, "before", B.header, true);
pin(3, "before", B.scales, true);
pin(1, "plan", A.plan.tabs);
pin(2, "plan", A.plan.filter);
pin(3, "plan", A.plan.scale);
pin(4, "plan", A.plan.later);
pin(5, "plan", A.plan.newDot);
pin(6, "beta", A.beta.join);
pin(6, "beta", A.beta.soon);
pin(7, "vote", A.vote.answered);
pin(7, "vote", A.vote.open);
pin(8, "issues", A.issues.updates);
pin(9, "issues", A.issues.checking);
pin(9, "issues", A.issues.report);
pin(10, "done", A.done.first);
pin(11, "mobile", MB.areas);
pin(11, "mobile", MB.tabs);

const byKey = Object.fromEntries(blocks.map((b) => [b.key, b]));
const html = [];
for (const b of blocks) {
  html.push(`<div class="lbl" style="left:${b.x}px;top:${b.y}px">${b.label}</div>`);
  html.push(`<img class="shot" src="${b.src}" style="left:${b.x}px;top:${b.y + LABEL}px;width:${b.w}px;height:${b.h}px">`);
}
for (const p of pins) {
  const b = byKey[p.block];
  const x = b.x + p.box.x * b.s - 5, y = b.y + LABEL + p.box.y * b.s - 5;
  const w = p.box.w * b.s + 10, h = p.box.h * b.s + 10;
  html.push(`<div class="rect${p.dashed ? " dashed" : ""}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`);
  html.push(`<div class="pin" style="left:${x - 17}px;top:${y - 17}px">${p.n}</div>`);
}
const noteY = yB;
html.push(`<div class="note" style="left:${xB}px;top:${noteY}px;width:${BW}px">I dag er alt én lang side uden faner: hvert område har sin egen blok, og hver idé har to skalaer under sig. Med billedets 12 idéer er siden ${B.screens} skærme lang i 1440 px; prod har flere punkter og er længere. Planlagte og igangværende punkter vises slet ikke (main henter kun status active og shipped).</div>`);
html.push(`<div class="title" style="left:${xB}px">I DAG (main)</div>`);
html.push(`<div class="title" style="left:${xR}px">EFTER #6150: /roadmap i fem faner</div>`);
html.push(`<div class="sub" style="left:${xR}px">Ægte punkter fra roadmap-indholdsudkastet (afsnit 1, 2, 3, 5.6 og 6c) efter ejerens godkendelser 4/10 (afsnit 8), mocket lokalt. Filteret "Only what I have not rated" er slået fra på 1440-billederne, så besvarede punkter ses.</div>`);

const legend = [
  "Fem faner med tal: Plan og Vote viser, hvor mange du mangler at bedømme; Known issues viser bekræftede fejl. I dag: ingen faner.",
  "Filteret \"Only what I have not rated\" (standard til, huskes) og tælleren \"Rated 6 of 27\".",
  "Plan har kun én skala, \"Important to you?\". I dag har hvert punkt to skalaer (idé + vigtighed).",
  "Later-folden: punkterne efter de næste ti ligger samlet og foldes ud.",
  "Gul prik ved punkter, der er nye siden sidste besøg.",
  "Beta: \"Join the beta\" fører til ansøgningen under Profil; \"Coming to beta\" har kun \"pick the rider first\" (ejer 4/10).",
  "Vote i to trin: \"Important to you?\" kommer frem, når \"Good idea?\" er valgt. Skalaerne står i samme kolonne i alle rækker.",
  "Known issues: bekræftede fejl med dateret opdatering (første opdatering ordret fra udkastets afsnit 3).",
  "\"Reported, being checked\": det, spillerne har meldt ind, uden løfte. Knappen viser \"Reported\", når du selv har meldt.",
  "Done: features og rettede fejl i én liste, nyeste først.",
  "Telefon: fanerækken og områdefilteret står på én linje og scroller vandret; korttitlen står over hintet.",
];
const contentH = Math.max(y1, y2, y3, noteY + 160);
const legendTop = contentH + 10;
legend.forEach((t, i) => html.push(`<div class="leg" style="top:${legendTop + 50 + i * 40}px"><b>${i + 1}</b>${t}</div>`));
html.push(`<div class="title" style="left:${M}px;top:${legendTop}px">Legende</div>`);
const totalW = Math.ceil(xc[2] + CW + M);
const totalH = Math.ceil(legendTop + 50 + legend.length * 40 + 40);

const doc = `<!doctype html><html><head><meta charset="utf-8"><title>6150 før og efter</title><style>
body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;width:${totalW}px;height:${totalH}px;position:relative;color:#111}
.title{position:absolute;top:24px;font-size:34px;font-weight:700}
.sub{position:absolute;top:72px;font-size:19px;color:#444}
.lbl{position:absolute;font-size:20px;font-weight:700;color:#333}
.shot{position:absolute;border:1px solid #bbb;box-sizing:border-box}
.rect{position:absolute;border:3px solid #d62828;box-sizing:border-box;border-radius:4px}.rect.dashed{border-style:dashed}
.pin{position:absolute;width:34px;height:34px;border-radius:50%;background:#d62828;color:#fff;font-weight:700;font-size:18px;line-height:30px;text-align:center;border:2px solid #fff;box-sizing:border-box;box-shadow:0 0 0 1px #d62828}
.note{position:absolute;font-size:19px;line-height:1.4;color:#333}
.leg{position:absolute;left:${M}px;font-size:22px}.leg b{display:inline-block;width:32px;height:32px;border-radius:50%;background:#d62828;color:#fff;text-align:center;line-height:32px;font-size:17px;margin-right:12px}
</style></head><body>${html.join("\n")}</body></html>`;
writeFileSync(resolve(OUT, "foer-efter.html"), doc);
{
  const b2 = await chromium.launch();
  const page = await b2.newPage({ viewport: { width: totalW, height: totalH }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(OUT, "foer-efter.html")).href);
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(OUT, "foer-efter.png"), fullPage: true });
  await b2.close();
}
console.log("ok", totalW, totalH, JSON.stringify(boxes.before), JSON.stringify(boxes.mobile));
