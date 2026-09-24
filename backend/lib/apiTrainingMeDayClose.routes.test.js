// #4847 — GET /api/training/me's `dayClose`-kontrakt (knappens aabne-tilstand).
//
// Samme lagdeling som apiTrainingMeRaceDay.routes.test.js: kildeteksten scannes for
// at bevise at ROUTE'N bruger de rigtige udtryk, og de udtryk koeres derefter mod en
// fake supabase-client for at bevise hvad de GOER pr. tilstand. De rene
// lukke-beregninger (pendingStagesFor/gameDaysByDivision/resolveDayCloseStatus) bor
// i trainingDayCloseTrigger.test.js; her daekkes udelukkende responskontrakten:
//
//   flag off  → feltet udelades HELT (ikke `{}`), saa ingen consumer kan forveksle
//               "slukket" med "dagen er ikke lukket endnu".
//   waiting   → { open: false, reason, gameDays, opensAtHour }
//   ready     → { open: true,  reason: "closed", gameDays, opensAtHour }
//
// Refs #4847 #4846

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateFlagStage } from "./featureStage.js";
import { TRAINING_TICK_PER_RACE_DAY_FLAG_KEY } from "./trainingTickRaceDayFlag.js";
import {
  resolveDayCloseStatus, shouldSweepNow, SWEEP_FROM_HOUR,
} from "./trainingDayCloseTrigger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

// ── Kilde-wiring ─────────────────────────────────────────────────────────────

test("api.js importerer lukke-tilstanden fra SAMME modul som cron-sweepen", () => {
  // Een sandhed, to forbrugere (ejer 15/9: knappen aabner "samme betingelse som
  // sweepen"). En kopi af betingelsen i api.js ville kunne drive fra sweepens.
  assert.match(
    apiSource,
    /import \{ resolveDayCloseStatus, teamGameDaysFromDayClose, shouldSweepNow as trainingWindowOpen, SWEEP_FROM_HOUR as TRAINING_SWEEP_FROM_HOUR \} from "\.\.\/lib\/trainingDayCloseTrigger\.js"/,
  );
  assert.match(
    apiSource,
    /import \{ isTrainingTickPerRaceDayEnabled \} from "\.\.\/lib\/trainingTickRaceDayFlag\.js"/,
  );
});

test("GET /training/me: dayClose spredes KUN ind i responsen naar flaget er on", () => {
  assert.match(apiSource, /\.\.\.\(dayClose \? \{ dayClose \} : \{\}\)/);
  // Feltet maa ALDRIG staa ubetinget i res.json — det ville levere et
  // "open: false" til klienter med flaget off og laase den gamle knap.
  assert.doesNotMatch(apiSource, /res\.json\(\{[\s\S]{0,600}\bdayClose,[\s\S]{0,200}\}\);/);
});

test("POST /training/run-today: loebsdags-stien gates paa BAADE vinduet og lukningen", () => {
  const start = apiSource.indexOf('router.post("/training/run-today"');
  assert.ok(start !== -1);
  const block = apiSource.slice(start, start + 4000);
  assert.match(block, /if \(!trainingWindowOpen\(new Date\(\)\)\)/);
  assert.match(block, /resolveDayCloseStatus\(\{/);
  assert.match(block, /error: "day_not_closed"/);
  // Bonussen fjernes i MOTOREN (executedBy === "manager" && !useRaceDayKey), ikke
  // ved at kalde med "assistant" — ellers ville rapporten lyve om hvem der koerte.
  assert.match(block, /executedBy: "manager",\s*\n\s*gameDay,/);
});

// ── Adfaerd pr. tilstand ─────────────────────────────────────────────────────
// Spejler route'ns udtryk med de AEGTE helpers (samme moenster som
// apiTrainingMeRaceDay.routes.test.js's trainingMeRaceDayGate).

// #4846: default er "gaarsdagen sluttede paa loebsdag 39". Et TOMT prior-opslag
// betyder nu saesonens foerste loebsdato (spaendet starter paa loebsdag 0), og det er
// ikke den tilstand fixturerne her beskriver.
function fakeSupabase({ flagValue, races = [], stages = [], priorStages = [{ race_id: "r1", game_day: 39 }] }) {
  return {
    from(table) {
      // #4847 regel 4: resolveDayCloseStatus laver TO race_stage_schedule-opslag —
      // dagens etaper (.gte(dayStart).lt(dayEnd)) og "sidste loebsdag FOER i dag"
      // (.lt(dayStart) + order desc + limit 1). Uden order/limit i kaeden kastede
      // prior-opslaget en TypeError, som loadPriorMaxGameDayByDivision's
      // best-effort-catch slugte til null — saa denne fake kunne ALDRIG se
      // spaend-adfaerden, uanset fixture.
      const ctx = { gte: false, order: null, limit: null };
      const chain = {
        select() { return this; },
        in() { return this; },
        gte() { ctx.gte = true; return this; },
        lt() { return this; },
        eq() { return this; },
        order(col, o = {}) { ctx.order = { col, ascending: o.ascending !== false }; return this; },
        limit(n) { ctx.limit = n; return this; },
        async maybeSingle() { return this.__resolve(); },
        __resolve() {
          if (table === "app_config") {
            return { data: flagValue === undefined ? null : { value: flagValue }, error: null };
          }
          if (table === "races") return { data: races, error: null };
          if (table === "race_stage_schedule") {
            if (ctx.gte) return { data: stages, error: null };
            let rows = [...priorStages];
            if (ctx.order) {
              rows.sort((a, b) => (ctx.order.ascending
                ? Number(a[ctx.order.col]) - Number(b[ctx.order.col])
                : Number(b[ctx.order.col]) - Number(a[ctx.order.col])));
            }
            return { data: Number.isFinite(ctx.limit) ? rows.slice(0, ctx.limit) : rows, error: null };
          }
          return { data: [], error: null };
        },
        then(resolve, reject) { return Promise.resolve(this.__resolve()).then(resolve, reject); },
      };
      return chain;
    },
  };
}

async function dayCloseField(supabase, { now, isBetaTester = false, seasonId = "s1" } = {}) {
  const raceDayTickOn = evaluateFlagStage(
    (await supabase.from("app_config").select("value").eq("key", TRAINING_TICK_PER_RACE_DAY_FLAG_KEY).maybeSingle()).data?.value ?? null,
    { isBetaTester },
  );
  if (!raceDayTickOn) return {};
  const windowOpen = shouldSweepNow(now);
  const close = windowOpen && seasonId
    ? await resolveDayCloseStatus({ supabase, seasonId, now, divisionId: "d1" })
    : { closed: false, reason: windowOpen ? "no_active_season" : "before_window", gameDays: [] };
  return {
    dayClose: {
      open: close.closed,
      reason: close.reason,
      gameDays: close.gameDays ?? [],
      opensAtHour: SWEEP_FROM_HOUR,
    },
  };
}

const CLOSED_DAY = {
  races: [{ id: "r1", league_division_id: "d1", stages_completed: 3, finalize_state: null }],
  stages: [{ race_id: "r1", stage_number: 3, game_day: 40, scheduled_at: "2026-09-15T09:00:00Z" }],
};
const OPEN_DAY = {
  races: [{ id: "r1", league_division_id: "d1", stages_completed: 2, finalize_state: null }],
  stages: [{ race_id: "r1", stage_number: 3, game_day: 40, scheduled_at: "2026-09-15T09:00:00Z" }],
};
const IN_WINDOW = new Date("2026-09-15T18:30:00Z");   // 20:30 dansk tid
const BEFORE_WINDOW = new Date("2026-09-15T15:00:00Z"); // 17:00 dansk tid

test("flag off: dayClose udelades HELT (ikke et tomt objekt)", async () => {
  for (const flagValue of [false, undefined, "vaguely-on"]) {
    const out = await dayCloseField(fakeSupabase({ flagValue, ...CLOSED_DAY }), { now: IN_WINDOW });
    assert.deepEqual(out, {}, `flagvaerdi ${String(flagValue)} skal give et felt-loest svar`);
  }
});

test("flag beta: feltet leveres kun til beta-testere", async () => {
  const supabase = fakeSupabase({ flagValue: "beta", ...CLOSED_DAY });
  assert.deepEqual(await dayCloseField(supabase, { now: IN_WINDOW, isBetaTester: false }), {});
  const out = await dayCloseField(supabase, { now: IN_WINDOW, isBetaTester: true });
  assert.equal(out.dayClose.open, true);
});

test("waiting (foer kl. 20): open=false, reason=before_window, ingen DB-opslag noedvendigt", async () => {
  const out = await dayCloseField(fakeSupabase({ flagValue: true, ...CLOSED_DAY }), { now: BEFORE_WINDOW });
  assert.deepEqual(out.dayClose, {
    open: false, reason: "before_window", gameDays: [], opensAtHour: SWEEP_FROM_HOUR,
  });
});

test("waiting (dagens sidste loeb koerer stadig): open=false, reason=awaiting_finalization", async () => {
  const out = await dayCloseField(fakeSupabase({ flagValue: true, ...OPEN_DAY }), { now: IN_WINDOW });
  assert.equal(out.dayClose.open, false);
  assert.equal(out.dayClose.reason, "awaiting_finalization");
  assert.deepEqual(out.dayClose.gameDays, [40]);
  assert.equal(out.dayClose.opensAtHour, 20);
});

test("ready (dagen er lukket): open=true, reason=closed, dagens loebsdage med", async () => {
  const out = await dayCloseField(fakeSupabase({ flagValue: true, ...CLOSED_DAY }), { now: IN_WINDOW });
  assert.deepEqual(out.dayClose, {
    open: true, reason: "closed", gameDays: [40], opensAtHour: SWEEP_FROM_HOUR,
  });
});

test("#4847 regel 4: knappen lover de RENE TRAENINGSDAGE med, ikke kun dagens loeb", async () => {
  // Divisionen koerte sidst loebsdag 38; i dag koeres 40. Loebsdag 39 har ingen
  // etape og er en ren traeningsdag — sweepen tikker den, saa fladen SKAL vise
  // den. Een sandhed, to forbrugere (ejer 15/9, beslutning 3).
  const out = await dayCloseField(
    fakeSupabase({ flagValue: true, ...CLOSED_DAY, priorStages: [{ race_id: "r1", game_day: 38 }] }),
    { now: IN_WINDOW },
  );
  assert.deepEqual(out.dayClose, {
    open: true, reason: "closed", gameDays: [39, 40], opensAtHour: SWEEP_FROM_HOUR,
  });
});

test("ingen aktiv saeson: open=false (en ukendt tilstand maa aldrig AABNE knappen)", async () => {
  const out = await dayCloseField(
    fakeSupabase({ flagValue: true, ...CLOSED_DAY }), { now: IN_WINDOW, seasonId: null },
  );
  assert.equal(out.dayClose.open, false);
  assert.equal(out.dayClose.reason, "no_active_season");
});

test("frontend behandler et manglende dayClose som den GAMLE knap", () => {
  const useTrainingSource = readFileSync(
    resolve(__dirname, "../../frontend/src/lib/useTraining.js"), "utf8",
  );
  assert.match(useTrainingSource, /setDayClose\(data\.dayClose \?\? null\)/,
    "null = flaget er off = uaendret 'Train today'-adfaerd");
  const pageSource = readFileSync(
    resolve(__dirname, "../../frontend/src/pages/TrainingPage.jsx"), "utf8",
  );
  // Knappens tekst OG gate skal begge haenge paa feltets tilstedevaerelse —
  // ellers ville flag off kunne laase den gamle knap.
  assert.match(pageSource, /dayClose \? t\("runDayNow"\) : t\("trainToday"\)/);
  // #5485: gaten bor eet sted, i guld-knappens regel (primaryActionFor) og den
  // sekundaere "Run now" (canRunToday). Siden skal sende feltet ind i begge.
  assert.match(pageSource, /primaryActionFor\(\{[^}]*\bdayClose,?\s*\}\)/);
  assert.match(pageSource, /canRunToday\(\{[^}]*\bdayClose\s*\}\)/);
  const overviewSource = readFileSync(
    resolve(__dirname, "../../frontend/src/components/training/trainingOverview.ts"), "utf8",
  );
  // null (flag off) aabner; kun et felt med open=false lukker.
  assert.match(overviewSource, /if \(dayClose && !dayClose\.open\) return \{ kind: "none" \}/);
  assert.match(overviewSource, /return !\(dayClose && !dayClose\.open\)/);
});
