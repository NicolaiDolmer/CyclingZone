// #5405 — ÉT samlet før/efter-bevis for kalenderens kommende-sæson-tilstand.
//
// Tager fire ÆGTE fuldside-skærmbilleder af den rigtige kalenderside (dansk UI,
// vite-serveren fra playwright.config's webServer) og sætter dem sammen til ét
// billede med nummererede pins og en kort dansk forklaring:
//
//   FØR   = det svar backend sendte inden denne PR: holdets NUVÆRENDE pulje
//           lånes til sæson 4, så "Mit hold"-fanen vælges af sig selv og løbene
//           står guld-markeret som "dine". Sidens kode er uændret i den gren —
//           uden divisionPending opfører kalenderen sig præcis som før.
//   EFTER = svaret efter denne PR: ownPoolId null, isMine false, divisionPending.
//
// Skrives til pr-screens/ når CZ_WRITE_COMMITTED_SHOTS=1, ellers til
// frontend/test-results/evidence/ (fixtures.evidenceShotPath). Kun
// desktop-chromium: beviset er ÉT billede, ikke tre.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, evidenceShotPath } from "./fixtures.js";

const AVAILABLE_SEASONS = [
  { id: "s-1", number: 1, status: "completed" },
  { id: "s-2", number: 2, status: "completed" },
  { id: "s-3", number: 3, status: "active" },
  { id: "s-4", number: 4, status: "upcoming" },
];

const DIVISIONS = [
  { division: 1, pools: [{ id: 1, label: "Division 1", poolIndex: 0 }] },
  { division: 2, pools: [{ id: 2, label: "Division 2 — A", poolIndex: 0 }, { id: 3, label: "Division 2 — B", poolIndex: 1 }] },
  { division: 3, pools: [{ id: 4, label: "Division 3 — A", poolIndex: 0 }] },
];

function entry({ id, name, poolId, division, poolLabel, date, terrain, isMine }) {
  return {
    id, name, raceType: "single", raceClass: "ProSeries", stages: 1,
    division, poolId, poolLabel, date, terrain,
    stageSchedule: [{ stage: 1, date, time: "14:00", terrain }],
    isMine, leaderSet: false, entered: false,
  };
}

// Sæson 4's program. `mine` = hvilke løb der bærer "mit holds løb"-markeringen.
function season4Races(mine) {
  return [
    entry({ id: "s4-a", name: "Grand Prix de Namur", poolId: 2, division: 2, poolLabel: "Division 2 — A", date: "2026-10-05", terrain: "sprint", isMine: mine }),
    entry({ id: "s4-b", name: "E3 Saxo Classic", poolId: 2, division: 2, poolLabel: "Division 2 — A", date: "2026-10-12", terrain: "cobbles", isMine: mine }),
    entry({ id: "s4-c", name: "Klasika Bizkaia", poolId: 2, division: 2, poolLabel: "Division 2 — A", date: "2026-10-19", terrain: "itt", isMine: mine }),
    entry({ id: "s4-d", name: "Giro Veneto", poolId: 1, division: 1, poolLabel: "Division 1", date: "2026-10-05", terrain: "hilly", isMine: false }),
    entry({ id: "s4-e", name: "Roue Tourangelle", poolId: 3, division: 2, poolLabel: "Division 2 — B", date: "2026-10-12", terrain: "mountain", isMine: false }),
    entry({ id: "s4-f", name: "Coppa Bernocchi", poolId: 4, division: 3, poolLabel: "Division 3 — A", date: "2026-10-19", terrain: "sprint", isMine: false }),
  ];
}

const SEASON_4_BASE = {
  season: { id: "s-4", number: 4, raceDaysTotal: 28, raceDaysCompleted: 0 },
  availableSeasons: AVAILABLE_SEASONS,
  divisions: DIVISIONS,
  days: [
    { gameDay: 1, date: "2026-10-05" },
    { gameDay: 8, date: "2026-10-12" },
    { gameDay: 15, date: "2026-10-19" },
  ],
};

// Uden divisionPending og MED holdets nuværende pulje = svaret fra før PR'en.
const S4_BEFORE = { ...SEASON_4_BASE, ownPoolId: 2, entries: season4Races(true) };
const S4_AFTER = { ...SEASON_4_BASE, ownPoolId: null, divisionPending: true, entries: season4Races(false) };

const VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  mobile: { width: 412, height: 900 },
};

// Pins pr. panel: [nummer, CSS-selector]. Kun desktop-panelerne bærer pins —
// mobil-rækken er den samme flade på 412 px og ville drukne i markører.
const CAL_TAB = '[role="tablist"][aria-label="Løbskalender"] [role="tab"][aria-selected="true"]';
const PINS = {
  before: [
    [1, '[aria-label="Sæson"]'],
    [2, CAL_TAB],
    [3, '[data-testid="calendar-race-chip"]'],
  ],
  after: [
    [4, '[data-testid="calendar-division-pending"]'],
    [5, CAL_TAB],
    [6, '[data-testid="calendar-race-chip"]'],
  ],
};

async function capture(page, payload, viewport, pinSelectors) {
  await page.setViewportSize(viewport);
  await page.unroute("**/api/races/calendar**").catch(() => {});
  await page.route("**/api/races/calendar**", (route) => json(route, payload));
  await page.goto("/planning?tab=calendar");
  // Mocken svarer sæson 4 uanset query-parameteren, så fladen lander direkte på
  // den sæson vælgeren viser. Det er præcis det manageren ser når han vælger S4.
  await expect(page.getByText(/Sæson 4 · 28 løbsdage/)).toBeVisible();
  await expect(page.getByTestId("calendar-race-chip").first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  // Bokse aflæses FØR skærmbilledet, i sidens egne koordinater. Med scrollY=0 og
  // deviceScaleFactor 1 er de identiske med pixelkoordinater i fullPage-billedet.
  const pins = [];
  for (const [num, selector] of pinSelectors || []) {
    const box = await page.locator(selector).first().boundingBox();
    if (box) pins.push({ num, ...box });
  }
  const buffer = await page.screenshot({ fullPage: true });
  const size = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  return { dataUri: `data:image/png;base64,${buffer.toString("base64")}`, pins, ...size };
}

const LEGEND = [
  "1. Sæson-vælgeren står på sæson 4. Sæsonen findes, men er ikke startet.",
  "2. „Mit hold“ vælges af sig selv og filtrerer kalenderen til holdets NUVÆRENDE division.",
  "3. Løbene står guld-markeret som dine. Op- og nedrykning er ikke afgjort endnu, så markeringen er et gæt.",
  "4. Ny linje: sæsonen er ikke startet, og divisionen afgøres ved sæsonskiftet.",
  "5. „Mit hold“-fanen og „Mit holds løb“-filteret er væk. Hele pyramidens program vises.",
  "6. Ingen løb er markeret som dine. Fladen påstår intet den ikke ved.",
];

// Panelerne står 1:1 — skærmbillederne skaleres ALDRIG ned, så ejeren kan læse
// hvert ord uden at zoome. Prisen er et bredt billede; det er den rigtige pris.
const SHEET_WIDTH = 32 * 2 + VIEWPORTS.desktop.width + 28 + VIEWPORTS.mobile.width * 2 + 20;

function composeHtml(panels) {
  const card = (p, tone) => {
    // Pin'en sidder på elementets VENSTRE kant, lodret centreret. Toppen-midt
    // lagde den oven i ordene på de brede elementer (linjen, fanen, chip'en).
    const pins = p.pins.map((pin) => `
      <span class="pin" style="left:${Math.round(pin.x)}px;top:${Math.round(pin.y + pin.height / 2)}px">${pin.num}</span>`).join("");
    return `
      <figure class="panel">
        <figcaption><span class="tag ${tone}">${tone === "before" ? "Før" : "Efter"}</span>${p.caption}</figcaption>
        <div class="shot" style="width:${p.width}px;height:${p.height}px">
          <img src="${p.dataUri}" style="width:${p.width}px" alt="">${pins}
        </div>
      </figure>`;
  };
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><style>
    :root { --ink:#16181d; --muted:#5b6070; --line:#d7dae2; --gold:#a07800; }
    * { box-sizing:border-box; }
    body { margin:0; background:#f4f5f7; color:var(--ink);
           font:400 15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;
           padding:30px 32px 34px; width:${SHEET_WIDTH}px; }
    h1 { font-size:22px; font-weight:700; margin:0 0 5px; letter-spacing:-0.01em; }
    .sub { font-size:14px; color:var(--muted); margin:0 0 22px; max-width:1100px; }
    .row { display:flex; gap:28px; align-items:flex-start; }
    .col { display:flex; flex-direction:column; gap:18px; }
    .panel { margin:0; }
    figcaption { font-size:13px; color:var(--muted); margin-bottom:6px; display:flex; align-items:center; gap:8px; }
    .tag { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase;
           padding:2px 7px; border-radius:5px; border:1px solid var(--line); color:var(--ink); }
    .tag.after { border-color:var(--gold); color:var(--gold); }
    .shot { position:relative; border:1px solid var(--line); background:#fff; overflow:hidden; border-radius:5px; }
    .shot img { display:block; }
    .pin { position:absolute; transform:translate(-50%,-50%); width:26px; height:26px; border-radius:13px;
           background:var(--gold); color:#fff; font:700 14px/26px system-ui,sans-serif; text-align:center;
           border:2px solid #fff; }
    ol.legend { margin:26px 0 0; padding:16px 0 0; list-style:none; border-top:1px solid var(--line);
                columns:2; column-gap:56px; font-size:14px; max-width:1800px; }
    ol.legend li { margin:0 0 8px; break-inside:avoid; }
    ol.legend li b { color:var(--gold); }
  </style></head><body>
    <h1>Sæson 4 på løbskalenderen: før og efter #5405</h1>
    <p class="sub">Ægte skærmbilleder af løbskalenderen i 1:1 (dansk UI, desktop 1440 px og mobil 412 px). Venstre kolonne er sæson 4 som backend svarede FØR denne PR, højre kolonne er mobil-udgaven af de samme to tilstande. Programmet er det samme i alle fire paneler, kun markeringen er forskellig.</p>
    <div class="row">
      <div class="col">
        ${card(panels.beforeDesktop, "before")}
        ${card(panels.afterDesktop, "after")}
      </div>
      <div class="col">
        <div class="row">
          ${card(panels.beforeMobile, "before")}
          ${card(panels.afterMobile, "after")}
        </div>
      </div>
    </div>
    <ol class="legend">${LEGEND.map((l) => {
      const [n, ...rest] = l.split(". ");
      return `<li><b>${n}.</b> ${rest.join(". ")}</li>`;
    }).join("")}</ol>
  </body></html>`;
}

test("#5405: ét samlet før/efter-bevis for kalenderens kommende sæson", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "beviset er ÉT billede, ikke ét pr. projekt");
  test.setTimeout(120_000);

  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/races/calendar**", (route) => json(route, S4_BEFORE));
  await login(page);

  const beforeDesktop = { caption: "Desktop 1440 px · holdets nuværende division lånes til sæson 4", ...await capture(page, S4_BEFORE, VIEWPORTS.desktop, PINS.before) };
  const beforeMobile = { caption: "Mobil 412 px", ...await capture(page, S4_BEFORE, VIEWPORTS.mobile, null) };
  const afterDesktop = { caption: "Desktop 1440 px · divisionen er ikke afgjort, og siden siger det", ...await capture(page, S4_AFTER, VIEWPORTS.desktop, PINS.after) };
  const afterMobile = { caption: "Mobil 412 px", ...await capture(page, S4_AFTER, VIEWPORTS.mobile, null) };

  // Beviset skal vise en forskel — ellers er billedet ikke et bevis.
  expect(beforeDesktop.pins).toHaveLength(3);
  expect(afterDesktop.pins).toHaveLength(3);

  const sheet = await browser.newPage({ viewport: { width: SHEET_WIDTH, height: 1200 }, deviceScaleFactor: 1 });
  await sheet.setContent(composeHtml({ beforeDesktop, beforeMobile, afterDesktop, afterMobile }), { waitUntil: "load" });
  await sheet.screenshot({
    path: evidenceShotPath("pr-screens/5405-kalender-kommende-saeson-foer-efter.png"),
    fullPage: true,
  });
  await sheet.close();
});
