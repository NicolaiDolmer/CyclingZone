// #2104 · Tests for skånefristen i board-auto-accept-cronen.
//
// race_days_completed er et globalt sæson-ur — uden skånefrist står et hold
// oprettet midt i sæsonen "over deadline" fra minut ét og får DNA + plan
// tvangsvalgt af næste cron-tick (ramte Team CSC 2/7). Dækker:
//   - isWithinNewTeamGrace (pure function)
//   - processBoardAutoAcceptCron skipper unge hold helt (ingen reminder/accept)
//   - kontrol: hold ældre end fristen auto-accepteres fortsat

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  BOARD_AUTO_ACCEPT_SELECT,
  NEW_TEAM_GRACE_DAYS,
  isWithinNewTeamGrace,
  processBoardAutoAcceptCron,
} from "./boardAutoAccept.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-02T15:00:00Z");

// =====================================================================
// isWithinNewTeamGrace — pure function
// =====================================================================

test("isWithinNewTeamGrace: hold oprettet for 1 dag siden er i skånefrist", () => {
  const createdAt = new Date(NOW.getTime() - 1 * DAY_MS).toISOString();
  assert.equal(isWithinNewTeamGrace(createdAt, NOW), true);
});

test("isWithinNewTeamGrace: hold oprettet for 30 dage siden er UDE af skånefrist", () => {
  const createdAt = new Date(NOW.getTime() - 30 * DAY_MS).toISOString();
  assert.equal(isWithinNewTeamGrace(createdAt, NOW), false);
});

test("isWithinNewTeamGrace: præcis på grænsen (NEW_TEAM_GRACE_DAYS dage) er UDE af fristen", () => {
  const createdAt = new Date(NOW.getTime() - NEW_TEAM_GRACE_DAYS * DAY_MS).toISOString();
  assert.equal(isWithinNewTeamGrace(createdAt, NOW), false);
});

test("isWithinNewTeamGrace: null/ugyldig created_at behandles som UDE af fristen (fail-open til eksisterende adfærd)", () => {
  assert.equal(isWithinNewTeamGrace(null, NOW), false);
  assert.equal(isWithinNewTeamGrace(undefined, NOW), false);
  assert.equal(isWithinNewTeamGrace("not-a-date", NOW), false);
});

// =====================================================================
// processBoardAutoAcceptCron — orchestrator med fake supabase
// =====================================================================

// Minimal fake supabase (samme mønster som boardMidSeason.test.js) —
// understøtter select/eq/order/limit/maybeSingle/upsert/update.
//
// #2469 · Fake'en RESPEKTERER nu select-kolonnelisten (projektion). Før
// returnerede den hele rækken uanset hvad koden bad om — og præcis dét gjorde
// datatabs-bugget usynligt for testene: prod-koden hentede 5 kolonner og læste
// `existingBoard?.satisfaction` som undefined, mens testens fake serverede
// kolonnen alligevel, så upserten så korrekt ud. En fake der er mere large end
// databasen beviser ingenting. Filtrering (.eq) sker på den FULDE række — som i
// Postgres — projektionen rammer kun outputtet.
function makeFakeSupabase(state) {
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function ensureTable(table) {
    if (!state[table]) state[table] = [];
    return state[table];
  }

  // "id, plan_type" → ["id","plan_type"]; "*"/tom → null (ingen projektion).
  function parseColumns(columns) {
    if (!columns || columns === "*") return null;
    return String(columns).split(",").map((c) => c.trim()).filter(Boolean);
  }

  function project(row, cols) {
    if (!cols) return row;
    const out = {};
    for (const col of cols) {
      if (Object.prototype.hasOwnProperty.call(row, col)) out[col] = row[col];
    }
    return out;
  }

  function makeQuery(table, action, payload = null, columns = null) {
    const filters = [];
    const projection = parseColumns(columns);
    let order = null;
    let limit = null;

    function matches(row) {
      return filters.every((f) => {
        if (f.type === "eq") return row[f.column] === f.value;
        return true;
      });
    }

    function execute() {
      const rows = ensureTable(table);
      if (action === "select") {
        let result = rows.filter(matches);
        if (order) {
          result = [...result].sort((a, b) => {
            const av = a[order.column]; const bv = b[order.column];
            if (av === bv) return 0;
            return (av < bv ? -1 : 1) * (order.ascending ? 1 : -1);
          });
        }
        if (limit != null) result = result.slice(0, limit);
        // Projektion sidst — filter/sort/limit ser den fulde række, som i Postgres.
        return Promise.resolve({ data: clone(result).map((r) => project(r, projection)), error: null });
      }
      if (action === "upsert") {
        const newRows = Array.isArray(payload) ? payload : [payload];
        for (const newRow of newRows) {
          const idx = rows.findIndex((r) => r.team_id === newRow.team_id && r.plan_type === newRow.plan_type);
          if (idx >= 0) rows[idx] = { ...rows[idx], ...clone(newRow) };
          else rows.push({ id: `${table}-${rows.length + 1}`, ...clone(newRow) });
        }
        return Promise.resolve({ data: clone(newRows), error: null });
      }
      if (action === "update") {
        for (const row of rows.filter(matches)) Object.assign(row, clone(payload));
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }

    const query = {
      eq(column, value) { filters.push({ type: "eq", column, value }); return query; },
      order(column, opts = {}) { order = { column, ascending: opts.ascending !== false }; return query; },
      limit(n) { limit = n; return query; },
      select() { return query; },
      single() { return execute().then((r) => ({ data: r.data?.[0] ?? null, error: r.error })); },
      maybeSingle() { return execute().then((r) => ({ data: r.data?.[0] ?? null, error: r.error })); },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    return query;
  }

  return {
    from(table) {
      return {
        select(columns) { return makeQuery(table, "select", null, columns); },
        upsert(payload) { return makeQuery(table, "upsert", payload); },
        update(payload) { return makeQuery(table, "update", payload); },
      };
    },
  };
}

function makeCronState({ teamCreatedAt }) {
  return {
    transfer_windows: [
      { id: "tw-1", board_negotiation_state: "pending_5yr", created_at: "2026-06-22T00:00:00Z" },
    ],
    seasons: [
      { id: "season-1", number: 2, status: "active", race_days_completed: 10, race_days_total: 60 },
    ],
    teams: [
      {
        id: "team-1",
        user_id: "user-1",
        name: "Team Grace",
        balance: 500000,
        sponsor_income: 240000,
        division: 3,
        season_1_identity_basis: null,
        team_dna_key: "sprint_kommerciel", // sat → auto-accept rører ikke DNA-grenen
        created_at: teamCreatedAt,
        is_ai: false,
        is_bank: false,
        is_frozen: false,
        is_test_account: false,
      },
    ],
    board_profiles: [
      {
        id: "bp-1", team_id: "team-1", plan_type: "5yr", focus: "balanced",
        negotiation_status: "pending", is_baseline: false,
      },
    ],
    riders: [],
    season_standings: [],
  };
}

test("processBoardAutoAcceptCron: hold i skånefrist skippes — ingen reminder, ingen auto-accept", async () => {
  const state = makeCronState({
    teamCreatedAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString(),
  });
  const notifications = [];
  const summary = await processBoardAutoAcceptCron({
    supabase: makeFakeSupabase(state),
    notifyUser: async (args) => { notifications.push(args); return { delivered: true }; },
    now: NOW,
  });

  assert.equal(summary.teams_checked, 1);
  assert.equal(summary.auto_accepted, 0);
  assert.equal(summary.reminders_sent, 0);
  assert.equal(summary.errors, 0);
  assert.equal(notifications.length, 0, "ingen notifikationer til hold i skånefrist");
  const board = state.board_profiles.find((b) => b.team_id === "team-1" && b.plan_type === "5yr");
  assert.equal(board.negotiation_status, "pending", "planen står stadig til forhandling");
});

test("processBoardAutoAcceptCron: hold ældre end skånefristen auto-accepteres fortsat", async () => {
  const state = makeCronState({
    teamCreatedAt: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
  });
  const notifications = [];
  const summary = await processBoardAutoAcceptCron({
    supabase: makeFakeSupabase(state),
    notifyUser: async (args) => { notifications.push(args); return { delivered: true }; },
    now: NOW,
  });

  assert.equal(summary.teams_checked, 1);
  assert.equal(summary.auto_accepted, 1, "gammelt hold auto-accepteres som hidtil");
  assert.equal(summary.errors, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].metadata.titleCode, "notif.boardAutoAccepted.title");
  const board = state.board_profiles.find((b) => b.team_id === "team-1" && b.plan_type === "5yr");
  assert.equal(board.negotiation_status, "completed");
});

// =====================================================================
// #2469 · Datatab ved plan-renewal (sæsonskifte)
//
// Kill-kæden: economyEngine.processTeamSeasonEnd skriver den netop optjente
// satisfaction + budget_modifier ind på board-rækken OG sætter
// negotiation_status='pending' når planen udløber. Auto-accept-cron'en tager
// derefter over — og nulstillede før dette fix rækken til 50/1.0, fordi dens
// select ikke hentede kolonnerne. /board/sign havde aldrig fejlen (.select("*")).
// Samme upsert-kode, modsat udfald.
// =====================================================================

// Hold der HAR spillet en sæson: 5yr+3yr signeret, 1yr udløbet → pending med
// optjente værdier. Præcis den tilstand processTeamSeasonEnd efterlader.
function makeRenewalState({ satisfaction = 82, budgetModifier = 1.2, tradeoffPayload = null } = {}) {
  return {
    transfer_windows: [
      { id: "tw-1", board_negotiation_state: "pending_5yr", created_at: "2026-06-22T00:00:00Z" },
    ],
    seasons: [
      { id: "season-2", number: 2, status: "active", race_days_completed: 10, race_days_total: 60 },
    ],
    teams: [
      {
        id: "team-1", user_id: "user-1", name: "Team Renewal",
        balance: 1230000, sponsor_income: 240000, division: 3,
        season_1_identity_basis: null, team_dna_key: "sprint_kommerciel",
        created_at: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
        is_ai: false, is_bank: false, is_frozen: false, is_test_account: false,
      },
    ],
    board_profiles: [
      {
        id: "bp-5", team_id: "team-1", plan_type: "5yr", focus: "balanced",
        negotiation_status: "completed", is_baseline: false,
        satisfaction, budget_modifier: budgetModifier, tradeoff_payload: null,
      },
      {
        id: "bp-3", team_id: "team-1", plan_type: "3yr", focus: "balanced",
        negotiation_status: "completed", is_baseline: false,
        satisfaction, budget_modifier: budgetModifier, tradeoff_payload: null,
      },
      // Den udløbne plan — pending, men BÆRER de optjente værdier.
      {
        id: "bp-1", team_id: "team-1", plan_type: "1yr", focus: "balanced",
        negotiation_status: "pending", is_baseline: false,
        satisfaction, budget_modifier: budgetModifier,
        tradeoff_payload: tradeoffPayload,
        tradeoff_active_until_season_id: tradeoffPayload ? "season-1" : null,
        major_pivot_used_at: null,
      },
    ],
    riders: [],
    season_standings: [],
  };
}

async function runCron(state) {
  const notifications = [];
  const summary = await processBoardAutoAcceptCron({
    supabase: makeFakeSupabase(state),
    notifyUser: async (args) => { notifications.push(args); return { delivered: true }; },
    now: NOW,
  });
  const renewed = state.board_profiles.find((b) => b.team_id === "team-1" && b.plan_type === "1yr");
  return { summary, notifications, renewed };
}

test("#2469: auto-accept BEVARER optjent satisfaction + budget_modifier ved renewal", async () => {
  const state = makeRenewalState({ satisfaction: 82, budgetModifier: 1.2 });
  const { summary, renewed } = await runCron(state);

  assert.equal(summary.auto_accepted, 1, "den udløbne 1yr-plan auto-accepteres");
  assert.equal(renewed.negotiation_status, "completed");
  // Kernen: før fixet blev disse to nulstillet til 50 / 1.0, fordi selecten
  // ikke hentede kolonnerne — spillerens optjente sponsor-bonus forsvandt tavst.
  assert.equal(renewed.satisfaction, 82, "optjent tilfredshed må ikke nulstilles til 50");
  assert.equal(renewed.budget_modifier, 1.2, "optjent sponsor-modifier må ikke nulstilles til 1.0");
});

test("#2469: gælder også nedad — en straffet modifier må heller ikke gratis-opskrives", async () => {
  const state = makeRenewalState({ satisfaction: 30, budgetModifier: 0.9 });
  const { renewed } = await runCron(state);
  assert.equal(renewed.satisfaction, 30);
  assert.equal(renewed.budget_modifier, 0.9, "0.9 må ikke 'heles' til 1.0 af auto-accept");
});

test("#2469: ægte NY plan (ingen eksisterende række) defaulter fortsat til 50 / 1.0", async () => {
  const state = makeRenewalState();
  // Fjern 1yr-rækken helt → findPendingPlanType returnerer '1yr' uden board.
  state.board_profiles = state.board_profiles.filter((b) => b.plan_type !== "1yr");
  const { summary, renewed } = await runCron(state);

  assert.equal(summary.auto_accepted, 1);
  assert.equal(renewed.satisfaction, 50, "ny plan starter neutralt");
  assert.equal(renewed.budget_modifier, 1.0);
});

test("#2469: auto-accept anvender spillerens deferred tradeoff (samme udfald som /board/sign)", async () => {
  const payload = { kind: "identity_tighten", u25_delta: 1 };
  const state = makeRenewalState({ tradeoffPayload: payload });
  const { renewed } = await runCron(state);

  // Stramningen er bagt ind i finalGoals af buildBoardProposal — og ryddes
  // derefter, præcis som /board/sign gør, så den ikke stables ved næste renewal.
  assert.equal(renewed.tradeoff_payload, null, "tradeoff ryddes efter anvendelse");
  assert.equal(renewed.tradeoff_active_until_season_id, null);
  assert.equal(renewed.major_pivot_used_at, null, "frisk plan = frisk pivot-cooldown");
});

// Forward-guard: fanger at en fremtidig ændring læser et NYT felt fra
// existingBoard uden at udvide selecten — nøjagtig den fejl der skabte #2469.
test("#2469 forward-guard: BOARD_AUTO_ACCEPT_SELECT dækker hvert felt der læses fra existingBoard", async () => {
  const raw = await readFile(new URL("./boardAutoAccept.js", import.meta.url), "utf8");
  // Strip kommentarer først — ellers matcher regexen forklarende prosa
  // (fx `existingBoard?.x ?? default` i kommentaren ovenfor konstanten).
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const selected = new Set(BOARD_AUTO_ACCEPT_SELECT.split(",").map((c) => c.trim()));

  const read = new Set();
  for (const m of src.matchAll(/existingBoard\?\.(\w+)/g)) read.add(m[1]);

  assert.ok(read.size > 0, "regexen skal faktisk finde noget — ellers er guarden tandløs");
  assert.ok(read.has("satisfaction") && read.has("budget_modifier"),
    "guarden skal se de felter #2469 handlede om — ellers er den holdt op med at virke");
  const missing = [...read].filter((field) => !selected.has(field));
  assert.deepEqual(
    missing, [],
    `Disse felter læses fra existingBoard men hentes ikke af BOARD_AUTO_ACCEPT_SELECT: ${missing.join(", ")}. `
    + "Uden kolonnen bliver 'existingBoard?.x ?? default' til en tavs nulstilling (#2469)."
  );
});
