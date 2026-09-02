import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import {
  TEST_USER,
  TEST_TEAM,
  RIVAL_TEAM,
  ACTIVE_SEASON,
  RIDERS,
  ROADMAP_ITEMS,
  AUCTIONS,
  SEED_SCOUT_ESTIMATES,
} from "../../src/preview/seedData.js";
import {
  parseTable,
  parseRpc,
  rpcResponse,
  wantsObject,
  restRows,
  restObject,
  apiResponse,
} from "../../src/preview/mockHandlers.js";

// Re-export så eksisterende spec-imports (import { TEST_USER, ... } from "./fixtures.js")
// stadig virker efter flytningen af data + matchers til src/preview/ (#prelive-harness).
// Datakilden er nu seedData.js — fixtures.js holder kun de Playwright-bundne helpers.
export { TEST_USER, TEST_TEAM, RIVAL_TEAM, ACTIVE_SEASON, RIDERS, ROADMAP_ITEMS, AUCTIONS };

// WebKit håndhæver CORS strikst — echo origin + allow credentials, så Supabase-js
// fetch (credentials: "include") accepterer mock-responses. Chromium er mere lempelig
// og kører grønt selv uden disse headers, men WebKit blokerer.
export function corsHeaders(request) {
  const origin = request.headers().origin || "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, prefer, range, accept-profile, content-profile",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "access-control-expose-headers": "Content-Range",
  };
}

export function json(route, data, status = 200) {
  const count = Array.isArray(data) ? data.length : data ? 1 : 0;
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      ...corsHeaders(route.request()),
      "Content-Range": `0-${Math.max(count - 1, 0)}/${count}`,
    },
    body: JSON.stringify(data),
  });
}

// #4581: RaceDetailPage.jsx henter nu race_results PR. ETAPE (.eq("race_id", id)
// .eq("stage_number", n)) i stedet for hele løbet i ét kald — først den valgte/dyb-
// linkede etape + "samlet"-fanens seed-etape, derefter on-demand ved hvert etape-
// skift (cachet, så samme etape ikke hentes to gange). En mock der (som før #4581)
// besvarer ETHVERT race_results-kald med hele datasættet er urealistisk mod prod
// (PostgREST filtrerer server-side på .eq()) og duplikerer rækker i siden ved
// etapeskift (samme række hentes to gange og lægges oveni sig selv — RaceDetail-
// Page.jsx APPENDER on-demand-hentede etaper, den erstatter dem ikke). Denne helper
// filtrerer på query-strengens `stage_number=eq.N`, ligesom PostgREST rent faktisk
// gør — samme mønster som race_results-casen i src/preview/mockHandlers.js's
// restRows() bruger for andre tabeller (fx `riders`s id=eq.-filter). Delt af alle
// specs der mocker race_results for en /races/:id-side (RaceDetailPage), så
// filtreringen ikke drifter mellem specs.
export function raceResultsRoute(dataset) {
  return (route) => {
    const url = new URL(route.request().url());
    const stageMatch = url.search.match(/stage_number=eq\.([^&]+)/);
    const rows = stageMatch
      ? dataset.filter((r) => String(r.stage_number ?? 1) === decodeURIComponent(stageMatch[1]))
      : dataset;
    return json(route, rows);
  };
}

export async function installNetworkMocks(page) {
  await page.route("**/auth/v1/token?**", route => json(route, {
    access_token: "e2e-access-token",
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: "e2e-refresh-token",
    user: TEST_USER,
  }));

  await page.route("**/auth/v1/user**", route => json(route, TEST_USER));

  await page.route("**/rest/v1/**", route => {
    const request = route.request();
    const table = parseTable(request.url());

    const accept = request.headers().accept || "";

    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) {
      // #2863: samme rækkefølge som installPreviewMock — seedede RPC'er svares
      // før den generiske mutations-linje, så e2e og preview ser det samme.
      const rpcPayload = rpcResponse(parseRpc(request.url()));
      if (rpcPayload !== undefined) return json(route, rpcPayload);
      return json(route, wantsObject(accept) ? {} : []);
    }

    return json(route, wantsObject(accept) ? restObject(table, request.url()) : restRows(table, request.url()));
  });

  await page.route("**/api/**", route => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });

    // #1162: viewer-maskerede potentiale-estimater (POST, batched fra useScouting).
    // Egne ryttere = eksakt (lo == hi). #1543: andres = SKJULT indtil scoutet
    // (level 0 → { hidden: true }), så intet gratis lo–hi-spænd vises før et slot
    // er brugt — non-null, så den potentiale-gatede række stadig renderes.
    if (url.pathname.endsWith("/api/scouting/estimates") && request.method() === "POST") {
      let ids = [];
      try { ids = JSON.parse(request.postData() || "{}").riderIds || []; } catch { /* tom body */ }
      // #2454: seedet ligger nu i seedData (SEED_SCOUT_ESTIMATES) i stedet for
      // her, fordi runtime-preview-mocken har brug for præcis de samme tal —
      // ellers ville rating-båndet kun findes i den ene af de to mocks.
      const estimates = {};
      for (const id of ids) {
        const rider = RIDERS.find(r => r.id === id);
        if (!rider) continue;
        estimates[id] = SEED_SCOUT_ESTIMATES[id]
          ?? (rider.team_id === TEST_TEAM.id ? { lo: 4.5, hi: 4.5, level: 3 } : { hidden: true, level: 0 });
      }
      return json(route, { teamId: TEST_TEAM.id, maxLevel: 3, estimates });
    }

    if (request.method() !== "GET") return json(route, { ok: true });

    return json(route, apiResponse(url.pathname, url.search));
  });
}

// Tekst-elementer maskeres i pixel-snapshots så testen fanger LAYOUT-regressions
// (cards forsvinder, kolonner kollapser, billeder mangler) uden at fejle på copy-
// eller i18n-ændringer. Indhold valideres via expect-assertions + i18n-key-coverage,
// ikke pixel-diff. Forward-guard mod #412 i18n-snapshot-treadmill — se
// `.claude/learnings/2026-05-17-visual-snapshots-layout-only.md`.
//
// #3684: den brede tag-liste rammer OGSÅ farve-/badge-bærende elementer (fx
// rating-pladen — statPlateStyle/statStyle sætter farven som span'ets egen
// inline background-color), så farve-regressioner kan ikke fejle i de maskede
// side-snapshots. En selector-undtagelse (`:not([style*="background"])`) blev
// AFPRØVET 18/8 og målt inert: Playwright maler hele det maskede elements
// bounding box, og pladerne sidder inde i `td`-celler der selv er i tag-listen
// — forælderens maske maler barnet over uanset. Empirisk: fuld snapshot-refresh
// med undtagelsen gav 0 ændrede filer. Farve-dækningen bor derfor i stedet i
// det UMASKEREDE kitchen-sink-snapshot: "Stat colours"-sektionen på /ui viser
// statStyle-chippen + statPlateStyle-pladen over hele rampen, så et tabt fyld,
// en forkert flyttet skala eller manglende kontrast-blæk HAR et sted at fejle
// (issuets løsning 2). Se `.claude/learnings/2026-08-18-pixel-mask-hid-badge-colors.md`.
export const TEXT_MASK_SELECTOR =
  "main :is(h1,h2,h3,h4,h5,h6,p,span,a,button,li,td,th,label,time,strong,em,dt,dd)";

export async function waitForStableSnapshotTarget(page) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });

  await page.waitForFunction(
    async ({ maskSelector }) => {
      const target = document.querySelector("main");
      if (!target) return false;

      const measure = () => {
        const rect = target.getBoundingClientRect();
        return [
          Math.round(rect.width),
          Math.round(rect.height),
          document.querySelectorAll(maskSelector).length,
        ].join(":");
      };

      let previous = measure();
      let stableFrames = 0;
      while (stableFrames < 4) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const next = measure();
        stableFrames = next === previous ? stableFrames + 1 : 0;
        previous = next;
      }

      return true;
    },
    { maskSelector: TEXT_MASK_SELECTOR },
    { timeout: 3000 }
  );
}

// ── #1272 · Central waitForPageReady-util + per-route readiness-gates ─────────
// Rod-årsag bag snapshot-flakes (postmortems 2026-05-26 + 2026-05-28): generisk
// "heading synlig + main synlig" gate rammer race-vinduer på data-drevne sider —
// screenshot kan lande mid-render (loader stadig synlig, default-filter ikke sat,
// font/mask-target endnu ikke stabilt). waitForPageReady samler ALLE readiness-
// trin ét sted, så nye specs ikke skal genopfinde ad-hoc-waits:
//
//   1. Generisk surface-gate: heading synlig, <main> synlig, ingen VITE-fejl.
//   2. Route-specifik gate (ROUTE_READINESS) for data-drevne sider — venter på
//      den BRUGEROBSERVERBARE sluttilstand fixture-data forventer (loader væk,
//      data loaded, default-filter sat, tom-state synlig).
//   3. Snapshot-overflade-stabilisering (waitForStableSnapshotTarget): fonts.ready
//      + stabil main-geometri + stabil TEXT_MASK_SELECTOR element-count.
//
// Brug: kald waitForPageReady(page, spec) EFTER page.goto(spec.path), FØR
// toHaveScreenshot. `spec.heading` er påkrævet; `spec.ready` (funktion) eller
// `spec.route` (nøgle i ROUTE_READINESS) er valgfri route-specifikke gates.

// Per-route readiness-definitioner. Nøgle = route-path. Hver gate venter på den
// deterministiske mock-sluttilstand for netop den side. Tilføj en entry her når
// en ny data-drevet route adopteres af core-smoke — IKKE spredte inline-waits.
export const ROUTE_READINESS = {
  // #646 + #512: de 2 kendt-flaky routes. Auktioner (desktop + mobile) havde
  // 103k-pixel-diffs fordi snapshot kunne ramme før loader-væk / default-filter.
  "/auctions": async (page) => {
    // Loader væk.
    await expect(page.locator('[role="status"]')).toHaveCount(0);
    // Tab-data loaded ("Aktive (1)" afspejler den ene mockede auktion).
    await expect(page.getByRole("link", { name: /^(Aktive|Active) \(1\)$/ })).toBeVisible();
    // #1569: fladen defaulter nu til 'All'-fanen for nye spillere (tom "My
    // situation"), så de lander på de faktiske auktioner i stedet for en tom
    // fane. 'All (1)'-fanen er aktiv, og listens ene rytter er den endelige
    // render-tilstand (erstatter den gamle "not involved"-tom-state-gate).
    await expect(
      page.getByRole("button", { name: /^(Alle|All) \(1\)$/ })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Mikkel Hansen/ }).first()).toBeVisible();
  },
  // #2108/#2060: /patch-notes henter nu prosaen on-demand som statisk JSON
  // (/patch-notes.json), så first paint er h1 + "Loading updates…" FØR data er
  // klar. Gaten venter på at loader-teksten er væk og mindst én dag-entry er
  // rendret, så snapshot ikke lander på loading-state (deterministisk first paint).
  "/patch-notes": async (page) => {
    await expect(page.getByText(/^(Loading updates…|Indlæser opdateringer…)$/)).toHaveCount(0);
    await expect(page.getByRole("button", { expanded: true }).first()).toBeVisible();
  },
  // S5 Season Planner (Formplan-fanen i Planlægnings-hubben, #3102 etape 3):
  // vent på at board'et er loadet (enabled → kontrolrække + filter rendret) så
  // snapshot ikke lander på PageLoader-state. Filter-toggle'en er unik + synlig
  // på både desktop og mobil (rytter-navnet findes i BÅDE det skjulte desktop-
  // SVG og det mobile spor, så .first() dér ville ramme et display:none-element).
  "/planning": async (page) => {
    await expect(page.getByRole("button", { name: /^(My races|Mine løb)$/ })).toBeVisible();
  },
};

// Samlet readiness-entry. Erstatter den spredte sekvens
// (goto → heading → main → VITE-check → ad-hoc ready → waitForStableSnapshotTarget)
// med ét kald, så snapshot-overfladen er deterministisk inden toHaveScreenshot.
export async function waitForPageReady(page, spec) {
  // 1. Generisk surface-gate.
  if (spec.heading) {
    await expect(page.getByRole("heading", { name: spec.heading }).first()).toBeVisible();
  }
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("VITE_API_URL is not set");

  // 2. Route-specifik gate (inline spec.ready vinder over ROUTE_READINESS-nøglen).
  const routeGate = spec.ready ?? ROUTE_READINESS[spec.route ?? spec.path];
  if (routeGate) await routeGate(page);

  // 3. Snapshot-overflade-stabilisering.
  await waitForStableSnapshotTarget(page);
}

// ── #1076 · Genbrugelig non-baseline board-fixture ────────────────────────────
// Standard-fixturen (apiResponse ovenfor) er baseline-fase → kun observations-
// banneret rendres. Det interaktive board (plan-faner, medlems-grid, DNA,
// konsekvenser, bonus-tilbud, wizard) kræver en non-baseline /api/board/status-
// payload. Denne builder leverer en komplet payload med aktiv 5-årsplan +
// medlemmer + DNA; override felter efter behov (fx active_consequences,
// bonus_offer, auto_accept, plans). Bruges af board-*.spec.js.
export function makeBoardStatus(overrides = {}) {
  return {
    is_baseline_phase: false,
    setup_next_plan_type: null,
    plans: {
      "5yr": {
        board: {
          satisfaction: 72,
          focus: "balanced",
          current_goals: [
            { type: "stage_wins_total", target: 3, label: "Win 3 stages", importance: "required" },
            { type: "relative_rank", target: 5, label: "Top 5 in division" },
          ],
        },
        plan_duration: 5,
        seasons_remaining: 3,
        seasons_completed: 2,
        plan_progress_pct: 40,
        cumulative_stats: { stage_wins: 1, gc_wins: 0 },
        snapshots: [
          { id: "snap-1", season_number: 1, season_within_plan: 1, division_rank: 4, stage_wins: 1, gc_wins: 0, goals_met: 1, goals_total: 2, satisfaction_delta: 5 },
        ],
        is_expired: false,
        renew_locked: false,
        outlook: { goal_evaluations: [{ status: "on_track", actual: 1, target: 3 }, { status: "watch" }] },
        request_status: null,
        request_options: [],
      },
      "3yr": null,
      "1yr": null,
    },
    team: TEST_TEAM,
    riders: RIDERS.filter(rider => rider.team_id === TEST_TEAM.id),
    standing: { division_rank: 3, division_manager_count: 18 },
    identity_profile: {
      primary_specialization_label: "Climbers",
      competitive_tier_label: "Contender",
      summary: "A climbing-focused outfit.",
      squad_limits: { max: 30 },
      star_profile: { label: "One star", star_rider_count: 1 },
    },
    auto_accept: null,
    active_loans_count: 0,
    team_members: [
      {
        archetype_key: "sponsoraten", selection_kind: "identity", alignment_score: 8, is_chairman: true,
        label: "Sponsoraten", emoji: "💰",
        short_description: "Vogter sponsorforhold og økonomisk disciplin",
        long_description: "En lang karakterbeskrivelse af formanden.",
      },
      {
        archetype_key: "talentspejderen", selection_kind: "identity", alignment_score: 6, is_chairman: false,
        label: "Talentspejderen", emoji: "🔭",
        short_description: "Tror på langsigtet ungdomsudvikling",
        long_description: "",
      },
      {
        archetype_key: "gc_elsker", selection_kind: "wildcard", alignment_score: 4, is_chairman: false,
        label: "GC-elsker", emoji: "⛰️",
        short_description: "Tre uger eller intet, Tour er alt",
        long_description: "",
      },
    ],
    active_consequences: [],
    bonus_offer: null,
    team_dna: {
      key: "skandinavisk_udvikling",
      emoji: "🌱",
      label: "Skandinavisk udviklingshold",
      short_description: "Ungdom, balance og nordisk arv",
      long_description: "Klubben bygger på unge ryttere og nordiske værdier.",
      goal_weighting: { u25_development_delta: 1.4, min_national_riders: 1.2, signature_rider: 0.8 },
    },
    dna_suggestions: [],
    ...overrides,
  };
}

// Registrér en override for /api/board/status OVEN PÅ installNetworkMocks
// (senest registrerede route vinder i Playwright). `status` kan være et objekt
// eller en funktion — funktion gør det muligt at mutere payload mellem fetches
// (fx bonus-accept → refetch uden bonus_offer).
export async function installBoardStatusMock(page, status) {
  await page.route("**/api/board/status**", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    if (request.method() !== "GET") return route.fallback();
    return json(route, typeof status === "function" ? status() : status);
  });
}

export async function login(page) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Cycling Zone" })).toBeVisible();
  await page.getByPlaceholder("din@email.dk").fill(TEST_USER.email);
  await page.getByPlaceholder("••••••••").fill("playwright-password");
  await page.getByRole("button", { name: "Log ind" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function stabilizePage(page) {
  await page.addInitScript(() => {
    // Lock Playwright til DA-locale så fixturens hardcoded danske
    // placeholders/button-navne matcher. Uden dette ville i18n-detection
    // falde tilbage til navigator.language → EN (fallbackLng) → fixture
    // ville lede efter "din@email.dk" mens UI rendered "you@email.com".
    window.localStorage.setItem("cz_lang", "da");

    window.localStorage.setItem("cz_consent_v1", JSON.stringify({
      version: 1,
      necessary: true,
      analytics: false,
      marketing: false,
      email_marketing: false,
      updated_at: "2026-05-13T00:00:00.000Z",
    }));

    const css = `
      *, *::before, *::after {
        animation-duration: 0.001s !important;
        animation-iteration-count: 1 !important;
        caret-color: transparent !important;
        transition-duration: 0s !important;
      }
    `;
    const inject = () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", inject, { once: true });
    } else {
      inject();
    }
  });
}

// ── Bevis-screenshots (#3554) ───────────────────────────────────────────────
//
// Fem specs skrev deres bevis-screenshots DIREKTE til committede stier
// (`pr-screens/`, `docs/screenshots/`, `frontend/tests/screenshots/`). Da
// CLAUDE.md gør hele e2e-suiten obligatorisk før ethvert frontend-push, betød
// det at pre-flighten ALTID efterlod 7-9 ændrede binære filer i arbejdstræet.
// To fælder, begge farlige: enten ryger PNG-diffs med i en urelateret PR (de
// vises ikke som tekst i review), eller man rydder op med `git checkout --` og
// rammer ægte, ucommittede skærmbilleder man lige har lavet.
//
// Default er derfor `frontend/test-results/` (allerede gitignored). Skal
// billederne opdateres bevidst — fx når man laver PR-screens til en visuel
// ændring — sættes `CZ_WRITE_COMMITTED_SHOTS=1`, præcis som
// `--update-snapshots` er den bevidste vej til at opdatere pixel-baselines.
//
//   CZ_WRITE_COMMITTED_SHOTS=1 npx playwright test training-race-day
//
// De frittstående `*.shots.mjs`-generatorer er IKKE omfattet: de køres manuelt
// og har det at skrive committede billeder som hele deres formål.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const WRITES_COMMITTED_SHOTS = process.env.CZ_WRITE_COMMITTED_SHOTS === "1";

/**
 * Sti til et bevis-screenshot. Tager den committede sti (repo-rod-relativ) og
 * returnerer enten den — hvis man BEDER om at opdatere den — eller en spejlet
 * sti under `frontend/test-results/evidence/`.
 *
 * @param {string} committedRelPath fx "pr-screens/3459-race-day-training-desktop.png"
 * @returns {string} absolut sti
 */
export function evidenceShotPath(committedRelPath) {
  return WRITES_COMMITTED_SHOTS
    ? path.join(REPO_ROOT, committedRelPath)
    : path.join(REPO_ROOT, "frontend/test-results/evidence", committedRelPath);
}

// ── WebKit-dev-noise (#3601) ────────────────────────────────────────────────
//
// WebKit + Vite-preview + Playwright-route-mocks kaster uncaught fejl som IKKE
// reproducerer på ægte iOS Safari: dynamiske route-chunks der afbrydes under
// belastning ("Importing a module script failed"), og mock-svar webkit afviser
// som cross-origin ("... due to access control checks"). Chromium er tolerant
// over for begge, så de rammer kun mobile-webkit — og kun når hele suiten
// kører, fordi det er dér timingen bliver presset.
//
// Filtret levede i to kopier (core-smoke + board-interactive) mens
// sponsor-ui.spec.js og landing-hydration.spec.js aldrig fik det. Resultatet
// var at netop de to gik røde på tilfældige PR'er under fuld belastning —
// frontend-smoke er en required check, så en test-artefakt blokerede merges
// for alle. Kopierne er samlet her, så en tredje spec ikke kan mangle den
// igen (samme rettelses-klasse som postmortem 2026-08-11: ret ALLE kopier af
// et kendetegn i samme commit, ellers ser det løst ud uden at være det).
//
// #3636 samlede kopierne, men lukkede ikke hullet — målt på PR #3627 kl. 11:22
// den 11/8, hvor `sponsor-ui.spec.js` gik rød IGEN på præcis den spec fixet
// dækkede. To akser var stadig ufuldstændige:
//
//   1. Beskedvarianten. WebKit formulerer den afbrudte route-chunk forskelligt
//      afhængigt af HVOR i indlæsningen den knækker; `ChunkLoadError ... chunk
//      reload needed` matchede ingen af de to oprindelige mønstre.
//   2. Kanalen. Helperen dækkede kun `pageerror`, så hver spec måtte selv
//      hænge på `console` og huske at genbruge filtret. `sponsor-ui` gjorde
//      det; en fremtidig spec ville ikke.
//
// Begge er lukket nu: mønstrene dækker alle tre kendte formuleringer, og
// `collectBrowserErrors` dækker begge kanaler ét sted. `guards.test.js` fejler
// hvis en spec hænger direkte på `page.on("console"|"pageerror")` udenom.
//
// BEVIDST SMALT: kun disse beskeder, og kun i webkit. Enhver anden uncaught
// fejl — også i webkit — er stadig en ægte fejl der skal fejle testen.
export const WEBKIT_DEV_NOISE = [
  /Importing a module script failed/i,
  /due to access control checks/i,
  /ChunkLoadError/i,
  /Failed to fetch dynamically imported module/i,
];

/**
 * Opsaml uncaught page-errors med webkit-dev-noise filtreret fra.
 *
 * Tynd indpakning af collectBrowserErrors for de specs der KUN asserter på
 * `pageerror`. Bevidst ikke udvidet til også at samle konsol-fejl: det ville
 * udvide hvad core-smoke og board-interactive beviser, i en PR om testtøj.
 *
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").TestInfo} testInfo  bruges til at afgøre om projektet er webkit
 * @returns {string[]} arrayet der fyldes undervejs — assertér på det til sidst
 */
export function collectPageErrors(page, testInfo) {
  return collectBrowserErrors(page, testInfo).pageErrors;
}

/**
 * Opsaml browser-fejl fra BEGGE kanaler — uncaught `pageerror` og
 * `console.error` — med webkit-dev-noise filtreret fra i begge.
 *
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").TestInfo} testInfo
 * @param {{ consoleNoise?: RegExp[] }} [options] spec-specifik konsol-støj
 *        (fx mock-miljøets uopløselige websocket-host) der filtreres i ALLE
 *        projekter, ikke kun webkit.
 * @returns {{ pageErrors: string[], consoleErrors: string[] }} arrays der
 *        fyldes undervejs — assertér på dem til sidst.
 */
export function collectBrowserErrors(page, testInfo, { consoleNoise = [] } = {}) {
  const isWebkit = testInfo.project.name.includes("webkit");
  const isDevNoise = (text) => isWebkit && WEBKIT_DEV_NOISE.some((p) => p.test(text));

  const pageErrors = [];
  const consoleErrors = [];

  page.on("pageerror", (error) => {
    if (isDevNoise(error.message)) return;
    pageErrors.push(error.message);
  });

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (consoleNoise.some((p) => p.test(text))) return;
    if (isDevNoise(text)) return;
    consoleErrors.push(text);
  });

  return { pageErrors, consoleErrors };
}
