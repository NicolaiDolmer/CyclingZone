// #5864 · rod-årsag: sæsonskiftets kontraktudløb skal også tage U23/junior/akademi med.
//
// Modsat contractExpiryRelease.test.js injiceres fetcheren IKKE her: testene kører
// normalvejens EGEN default-forespørgsel (præcis det Phase 5c i seasonTransition.js
// kalder) mod en lille in-memory-database der evaluerer PostgREST-filtrene
// (eq/neq/lte/gt/in/is/not/or + embedded team/races). Dermed bevises både
// forespørgslens form og frigivelsen, udskydelsen, oprydningen og notifikationen.
import test from "node:test";
import assert from "node:assert/strict";

import {
  releaseExpiredContractRiders,
  buildContractReleasePatch,
  fetchExpiredSeniorContractRiders,
  fetchExpiredYouthContractRiders,
} from "./contractExpiryRelease.js";

// ─── In-memory PostgREST-fake ────────────────────────────────────────────────

function parseValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  return raw;
}

function makeDb(seed) {
  const tables = {
    teams: seed.teams.map((t) => ({ ...t })),
    riders: seed.riders.map((r) => ({ ...r })),
    races: (seed.races || []).map((r) => ({ ...r })),
    race_entries: (seed.race_entries || []).map((r) => ({ ...r })),
    race_withdrawals: (seed.race_withdrawals || []).map((r) => ({ ...r })),
    transfer_listings: (seed.transfer_listings || []).map((r) => ({ ...r })),
  };
  const log = [];

  function embed(table, row, selectCols) {
    const out = { ...row };
    if (table === "riders" && /team:team_id!inner\(/.test(selectCols)) {
      out.team = tables.teams.find((t) => t.id === row.team_id) || null;
    }
    if (table === "race_entries" && /races!inner\(/.test(selectCols)) {
      out.races = tables.races.find((r) => r.id === row.race_id) || null;
    }
    return out;
  }

  function get(row, col) {
    if (!col.includes(".")) return row[col];
    const [rel, field] = col.split(".");
    return row[rel]?.[field];
  }

  function from(table) {
    const s = { table, op: "select", patch: null, select: "", returning: false, preds: [], range: null };
    const q = {
      select(cols = "") { if (s.op === "select") s.select = cols; else s.returning = true; return q; },
      update(patch) { s.op = "update"; s.patch = patch; return q; },
      delete() { s.op = "delete"; return q; },
      eq(c, v) { s.preds.push((r) => get(r, c) === v); return q; },
      neq(c, v) { s.preds.push((r) => get(r, c) !== null && get(r, c) !== undefined && get(r, c) !== v); return q; },
      gt(c, v) { s.preds.push((r) => get(r, c) != null && get(r, c) > v); return q; },
      lte(c, v) { s.preds.push((r) => get(r, c) != null && get(r, c) <= v); return q; },
      in(c, vs) { s.preds.push((r) => vs.includes(get(r, c))); return q; },
      is(c, v) { s.preds.push((r) => (get(r, c) ?? null) === v); return q; },
      not(c, op, v) {
        if (op !== "is") throw new Error(`fake: not(${op}) unsupported`);
        s.preds.push((r) => (get(r, c) ?? null) !== v);
        return q;
      },
      or(expr) {
        const parts = expr.split(",").map((p) => {
          const [c, op, raw] = p.split(".");
          const v = parseValue(raw);
          if (op === "eq") return (r) => get(r, c) === v;
          if (op === "neq") return (r) => get(r, c) != null && get(r, c) !== v;
          throw new Error(`fake: or op ${op} unsupported`);
        });
        s.preds.push((r) => parts.some((fn) => fn(r)));
        return q;
      },
      order() { return q; },
      range(fromIdx, toIdx) { s.range = [fromIdx, toIdx]; return q; },
      then(resolve, reject) {
        try { resolve(run()); } catch (e) { reject(e); }
      },
    };

    function run() {
      log.push({ table, op: s.op, select: s.select, patch: s.patch });
      const base = tables[table];
      if (!base) return { data: [], error: null };
      const isInner = (row) => {
        if (table === "riders" && /team:team_id!inner\(/.test(s.select)) return row.team != null;
        if (table === "race_entries" && /races!inner\(/.test(s.select)) return row.races != null;
        return true;
      };
      const matches = base.filter((raw) => {
        const row = embed(table, raw, s.select);
        return isInner(row) && s.preds.every((p) => p(row));
      });
      if (s.op === "update") {
        for (const raw of matches) Object.assign(raw, s.patch);
        return { data: s.returning ? matches.map((r) => ({ id: r.id })) : null, error: null };
      }
      if (s.op === "delete") {
        tables[table] = base.filter((r) => !matches.includes(r));
        return { data: null, error: null };
      }
      let rows = matches.map((raw) => embed(table, raw, s.select));
      if (s.range) rows = rows.slice(s.range[0], s.range[1] + 1);
      return { data: rows, error: null };
    }
    return q;
  }

  return { supabase: { from }, tables, log, rider: (id) => tables.riders.find((r) => r.id === id) };
}

// ─── Fixture: sæson 4 er netop afsluttet (S4 → S5) ───────────────────────────

const team = (id, extra = {}) => ({
  id, user_id: `user-${id}`, is_ai: false, is_frozen: false, is_bank: false, is_test_account: false, ...extra,
});

const rider = (id, team_id, extra = {}) => ({
  id, firstname: "F", lastname: id, team_id, pending_team_id: null, squad: "senior", is_academy: false,
  is_retired: false, salary: 10, contract_length: 1, contract_end_season: 4, acquired_at: "2026-08-01", ...extra,
});

function seed() {
  return {
    teams: [
      team("H"),                                       // menneskehold, aktivt
      team("F", { is_frozen: true }),                  // frosset menneskehold
      team("T", { is_test_account: true }),            // testkonto
      team("BANK", { is_bank: true, user_id: null }),  // bank
      team("AI", { is_ai: true, user_id: null }),      // AI-hold
    ],
    riders: [
      // Hold H
      rider("h-sen-exp", "H"),
      rider("h-sen-ok", "H", { contract_end_season: 5 }),
      rider("h-u23-exp", "H", { squad: "u23", is_academy: true, contract_end_season: 3 }),
      rider("h-jun-exp", "H", { squad: "junior", is_academy: true }),
      rider("h-acad-senior-squad", "H", { squad: "senior", is_academy: true, contract_end_season: 2 }),
      rider("h-u23-plain-exp", "H", { squad: "u23", is_academy: false }),
      rider("h-u23-ok", "H", { squad: "u23", is_academy: true, contract_end_season: 5 }),
      rider("h-u23-nocontract", "H", { squad: "u23", is_academy: true, contract_end_season: null }),
      rider("h-u23-racing", "H", { squad: "u23", is_academy: true }),
      // Uden for scope
      rider("f-u23-exp", "F", { squad: "u23", is_academy: true }),
      rider("f-sen-exp", "F"),
      rider("t-jun-exp", "T", { squad: "junior", is_academy: true }),
      rider("bank-u23-exp", "BANK", { squad: "u23", is_academy: true }),
      // AI: senior frigives som før; AI-ungdom bevidst uden for (ingen auto-fornyelse af ungdom)
      rider("ai-sen-exp", "AI"),
      rider("ai-u23-exp", "AI", { squad: "u23", is_academy: true }),
      // Fri agent (intet hold)
      rider("free-u23", null, { squad: "u23", is_academy: false }),
    ],
    races: [
      { id: "race-active-stage", race_type: "stage_race", status: "scheduled", stages_completed: 2 },
      { id: "race-future", race_type: "one_day", status: "scheduled", stages_completed: 0 },
      { id: "race-done", race_type: "one_day", status: "completed", stages_completed: 1 },
    ],
    race_entries: [
      { race_id: "race-active-stage", rider_id: "h-u23-racing", team_id: "H" },
      { race_id: "race-future", rider_id: "h-u23-exp", team_id: "H", race_role: "captain" },
      { race_id: "race-done", rider_id: "h-u23-exp", team_id: "H", race_role: "helper" },
    ],
    transfer_listings: [
      { id: "l1", rider_id: "h-jun-exp", status: "open" },
      { id: "l2", rider_id: "f-u23-exp", status: "open" },
    ],
  };
}

function notifyRecorder() {
  const calls = [];
  return { calls, notify: async (args) => { calls.push(args); return { delivered: true }; } };
}

const RELEASED = (r) => r.team_id === null && r.contract_end_season === null && r.salary === null && r.contract_length === null;

// ─── Tests ───────────────────────────────────────────────────────────────────

test("#5864: U23, junior og akademi med udløbet kontrakt frigives ved sæsonskiftet (default-forespørgslen)", async () => {
  const db = makeDb(seed());
  const { notify, calls } = notifyRecorder();
  const stats = await releaseExpiredContractRiders({ supabase: db.supabase, seasonNumber: 4, notify });

  for (const id of ["h-u23-exp", "h-jun-exp", "h-acad-senior-squad", "h-u23-plain-exp"]) {
    assert.ok(RELEASED(db.rider(id)), `${id} skal være fri agent`);
  }
  // Squad bevares, akademiflaget nulstilles (samme form som #6198-scriptet gav).
  assert.equal(db.rider("h-u23-exp").squad, "u23");
  assert.equal(db.rider("h-u23-exp").is_academy, false);
  assert.equal(db.rider("h-jun-exp").squad, "junior");
  assert.equal(db.rider("h-jun-exp").is_academy, false);
  assert.equal(db.rider("h-acad-senior-squad").squad, "senior");
  assert.equal(db.rider("h-acad-senior-squad").is_academy, false);

  // Ikke-udløbne ungdomsryttere og ungdom uden kontrakt bliver.
  assert.equal(db.rider("h-u23-ok").team_id, "H");
  assert.equal(db.rider("h-u23-ok").is_academy, true);
  assert.equal(db.rider("h-u23-nocontract").team_id, "H");

  assert.equal(stats.youthNormalized, 3, "kun akademiryttere tælles som normaliseret");
  // Notifikation til ejeren for hver frigivet rytter på menneskeholdet.
  const notified = calls.map((c) => c.relatedId).sort();
  assert.deepEqual(notified, ["h-acad-senior-squad", "h-jun-exp", "h-sen-exp", "h-u23-exp", "h-u23-plain-exp"]);
  assert.ok(calls.every((c) => c.userId === "user-H" && c.type === "contract_expired_release"));
});

test("#5864: race-entry-oprydning og opslags-lukning gælder også ungdom; historik bevares", async () => {
  const db = makeDb(seed());
  await releaseExpiredContractRiders({ supabase: db.supabase, seasonNumber: 4, notify: notifyRecorder().notify });

  const entries = db.tables.race_entries.filter((e) => e.rider_id === "h-u23-exp").map((e) => e.race_id);
  assert.deepEqual(entries, ["race-done"], "fremtidig tilmelding fjernet, afviklet løb (brugt i sæsonen) bevaret");
  assert.equal(db.tables.transfer_listings.find((l) => l.id === "l1").status, "withdrawn");
  assert.equal(db.tables.transfer_listings.find((l) => l.id === "l2").status, "open", "frosset holds opslag røres ikke");
});

test("#5864: seniorvejen er uændret (alle gameplay-hold, også AI)", async () => {
  const db = makeDb(seed());
  await releaseExpiredContractRiders({ supabase: db.supabase, seasonNumber: 4, notify: notifyRecorder().notify });

  assert.ok(RELEASED(db.rider("h-sen-exp")));
  assert.equal(db.rider("h-sen-exp").is_academy, false);
  assert.equal(db.rider("h-sen-ok").team_id, "H", "senior med gyldig kontrakt bliver");
  assert.ok(RELEASED(db.rider("ai-sen-exp")), "AI-senior frigives stadig (Phase 5b-2 har fornyet dem der skal blive)");

  // Seniorforespørgslen er samme form som før: kun seniortruppen, ingen is_ai-filtrering.
  const senior = await fetchExpiredSeniorContractRiders({ supabase: makeDb(seed()).supabase, seasonNumber: 4 });
  assert.deepEqual(senior.map((r) => r.id).sort(), ["ai-sen-exp", "h-sen-exp"]);
});

test("#5864: senior-patchen er bit-identisk med før; kun akademiryttere får is_academy=false", () => {
  const base = { team_id: null, pending_team_id: null, salary: null, contract_length: null, contract_end_season: null, acquired_at: null };
  assert.deepEqual(buildContractReleasePatch({ squad: "senior", is_academy: false }), base);
  assert.deepEqual(buildContractReleasePatch({ squad: "u23", is_academy: false }), base);
  assert.deepEqual(buildContractReleasePatch({ squad: "u23", is_academy: true }), { ...base, is_academy: false });
  assert.equal("squad" in buildContractReleasePatch({ squad: "junior", is_academy: true }), false, "squad røres aldrig");
});

test("#5864: etapeløbs-udskydelsen gælder også ungdom", async () => {
  const db = makeDb(seed());
  const stats = await releaseExpiredContractRiders({ supabase: db.supabase, seasonNumber: 4, notify: notifyRecorder().notify });

  const r = db.rider("h-u23-racing");
  assert.equal(r.team_id, "H");
  assert.equal(r.is_academy, true);
  assert.equal(r.contract_end_season, 4, "beholder udløbet kontrakt og fanges af næste kørsel");
  assert.equal(stats.deferredByRacing, 1);
  assert.ok(db.tables.race_entries.some((e) => e.rider_id === "h-u23-racing"), "løbs-tilmeldingen røres ikke");
});

test("#5864: frosne hold, testkonti, bank og AI-ungdom røres ikke", async () => {
  const db = makeDb(seed());
  const { notify, calls } = notifyRecorder();
  await releaseExpiredContractRiders({ supabase: db.supabase, seasonNumber: 4, notify });

  for (const [id, teamId] of [["f-u23-exp", "F"], ["f-sen-exp", "F"], ["t-jun-exp", "T"], ["bank-u23-exp", "BANK"], ["ai-u23-exp", "AI"]]) {
    const r = db.rider(id);
    assert.equal(r.team_id, teamId, `${id} bliver på holdet`);
    assert.equal(r.contract_end_season, 4, `${id} beholder sin kontrakt`);
  }
  assert.equal(db.rider("ai-u23-exp").is_academy, true);
  assert.ok(calls.every((c) => c.userId === "user-H"), "ingen notifikation til frosne/test-hold");

  const youth = await fetchExpiredYouthContractRiders({ supabase: makeDb(seed()).supabase, seasonNumber: 4 });
  assert.deepEqual(
    youth.map((r) => r.id).sort(),
    ["h-acad-senior-squad", "h-jun-exp", "h-u23-exp", "h-u23-plain-exp", "h-u23-racing"],
    "ungdomsforespørgslen: kun menneskehold i scope, kun udløbne, aldrig fri agenter",
  );
});

test("#5864: idempotent; en ny kørsel samme sæson frigiver intet nyt (udskudt rytter stadig udskudt)", async () => {
  const db = makeDb(seed());
  const first = await releaseExpiredContractRiders({ supabase: db.supabase, seasonNumber: 4, notify: notifyRecorder().notify });
  assert.equal(first.candidates, 7);
  assert.equal(first.released, 6);
  const { notify, calls } = notifyRecorder();
  const second = await releaseExpiredContractRiders({ supabase: db.supabase, seasonNumber: 4, notify });
  assert.deepEqual(
    { candidates: second.candidates, released: second.released, deferredByRacing: second.deferredByRacing },
    { candidates: 1, released: 0, deferredByRacing: 1 },
  );
  assert.equal(calls.length, 0, "ingen dobbelt-notifikation");
});
