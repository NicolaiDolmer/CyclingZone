import { expect } from "@playwright/test";
import {
  TEST_USER,
  TEST_TEAM,
  RIVAL_TEAM,
  ACTIVE_SEASON,
  RIDERS,
  ROADMAP_ITEMS,
  AUCTIONS,
} from "../../src/preview/seedData.js";
import {
  parseTable,
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
      const estimates = {};
      for (const id of ids) {
        const rider = RIDERS.find(r => r.id === id);
        if (!rider) continue;
        estimates[id] = rider.team_id === TEST_TEAM.id
          ? { lo: 4.5, hi: 4.5, exact: true, level: 3 }
          : { hidden: true, level: 0 };
      }
      return json(route, { teamId: TEST_TEAM.id, maxLevel: 3, estimates });
    }

    if (request.method() !== "GET") return json(route, { ok: true });

    return json(route, apiResponse(url.pathname));
  });
}

// Tekst-elementer maskeres i pixel-snapshots så testen fanger LAYOUT-regressions
// (cards forsvinder, kolonner kollapser, billeder mangler) uden at fejle på copy-
// eller i18n-ændringer. Indhold valideres via expect-assertions + i18n-key-coverage,
// ikke pixel-diff. Forward-guard mod #412 i18n-snapshot-treadmill — se
// `.claude/learnings/2026-05-17-visual-snapshots-layout-only.md`.
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
