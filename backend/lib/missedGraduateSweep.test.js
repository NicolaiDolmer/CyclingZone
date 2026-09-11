import test from "node:test";
import assert from "node:assert/strict";

import { runMissedGraduateSweep, findMissedGraduates } from "./missedGraduateSweep.js";
import { GRADUATION } from "./academyGraduation.js";

// ─── Mock-supabase ─────────────────────────────────────────────────────────────
// Samme fire tabeller som stuckAcademyGraduates.test.js (vagtens prædikat læses
// uændret herfra), plus SKRIVE-vejen: academy_graduation.insert.
//
// Hard rule 16: ingen vægur-tid — `now` injiceres i hver test.

function makeMock({
  activeSeason = { id: "s3", number: 3 },
  riders = [],
  auctions = [],
  graduations = [],
  insertError = null,
} = {}) {
  const rec = { inserts: [] };
  const supabase = {
    from(table) {
      if (table === "seasons") {
        const b = {
          select() { return b; },
          eq() { return b; },
          order() { return b; },
          limit() { return b; },
          maybeSingle() { return Promise.resolve({ data: activeSeason, error: null }); },
        };
        return b;
      }
      if (table === "riders") {
        const filters = [];
        const b = {
          select() { return b; },
          eq(col, val) { filters.push(["eq", col, val]); return b; },
          not(col, op, val) { if (op === "is") filters.push(["not-is", col, val]); return b; },
          order() { return b; },
          range(from, to) {
            const out = riders.filter((r) => filters.every(([op, c, v]) => {
              if (op === "eq") return (r[c] ?? false) === v;
              if (op === "not-is") return (r[c] ?? null) !== v;
              return true;
            })).slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      if (table === "auctions") {
        const inFilters = [];
        const b = {
          select() { return b; },
          in(col, vals) { inFilters.push([col, vals]); return b; },
          order() { return b; },
          range(from, to) {
            const out = auctions.filter((a) => inFilters.every(([c, v]) => v.includes(a[c]))).slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      if (table === "academy_graduation") {
        const inFilters = [];
        const b = {
          select() { return b; },
          in(col, vals) { inFilters.push([col, vals]); return b; },
          order() { return b; },
          range(from, to) {
            const out = graduations.filter((g) => inFilters.every(([c, v]) => v.includes(g[c]))).slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
          insert(row) {
            rec.inserts.push(row);
            if (insertError) return Promise.resolve({ error: insertError });
            // Skrivningen er synlig for efterfølgende læsninger i SAMME mock, så
            // "kør igen → ingen dublet" tester den ægte idempotens-kæde og ikke
            // bare en tom tabel.
            graduations.push({ id: `g-${rec.inserts.length}`, rider_id: row.rider_id, status: row.status, deadline: row.deadline, created_at: row.deadline });
            return Promise.resolve({ error: null });
          },
        };
        return b;
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
  return { supabase, rec };
}

function spyNotify() {
  const calls = [];
  const fn = async (payload) => { calls.push(payload); };
  fn.calls = calls;
  return fn;
}

const NOW = new Date("2026-09-11T08:00:00.000Z");
// ageForSeason(birthdate, 3) = 2026 + 2 − fødselsår.
const bornForSeason3Age = (age) => `${2028 - age}-10-25`;

// Den konkrete rytter fra #5133: 22 i S3, menneskehold, ingen grad-række.
const MISSED = {
  id: "r-missed", team_id: "t-human", ai_team_id: null,
  firstname: "Missed", lastname: "Graduate",
  is_academy: true, is_retired: false, birthdate: bornForSeason3Age(22),
};
const YOUNG = {
  id: "r-young", team_id: "t-human", ai_team_id: null,
  firstname: "Still", lastname: "Young",
  is_academy: true, is_retired: false, birthdate: bornForSeason3Age(20),
};

const enabled = async () => true;

test("sweep: finder rytter uden grad-række og opretter ÉN pending-række + notifikation", async () => {
  const { supabase, rec } = makeMock({ riders: [MISSED, YOUNG] });
  const notify = spyNotify();
  const res = await runMissedGraduateSweep({ supabase, now: NOW, isEnabled: enabled, notify });

  assert.equal(res.created, 1);
  assert.equal(res.failed, 0);
  assert.equal(rec.inserts.length, 1);
  assert.equal(rec.inserts[0].rider_id, "r-missed");
  assert.equal(rec.inserts[0].team_id, "t-human");
  assert.equal(rec.inserts[0].season_id, "s3");
  assert.equal(rec.inserts[0].status, "pending");

  // Managerens fulde override-vindue, ikke et udløbet et: deadline = now + 7 dage.
  const expected = new Date(NOW.getTime() + GRADUATION.DEADLINE_DAYS * 86_400_000).toISOString();
  assert.equal(rec.inserts[0].deadline, expected);

  assert.equal(notify.calls.length, 1);
  assert.equal(notify.calls[0].type, "academy_graduation_ready");
  assert.equal(notify.calls[0].teamId, "t-human");
  assert.equal(notify.calls[0].relatedId, "r-missed");
  assert.equal(notify.calls[0].metadata.titleParams.name, "Missed Graduate");
});

test("sweep: anden kørsel opretter ingen dublet", async () => {
  const { supabase, rec } = makeMock({ riders: [MISSED] });
  const notify = spyNotify();
  await runMissedGraduateSweep({ supabase, now: NOW, isEnabled: enabled, notify });
  const second = await runMissedGraduateSweep({ supabase, now: NOW, isEnabled: enabled, notify });

  assert.equal(second.created, 0, "anden kørsel opretter intet");
  assert.equal(rec.inserts.length, 1, "kun én insert i alt");
  assert.equal(notify.calls.length, 1, "manageren får ikke beskeden to gange");
});

test("sweep: rytter med eksisterende grad-række springes over", async () => {
  // 'sold' uden gennemført salg er #4495's klasse (resolveUnsoldGraduate ejer
  // den) — dette sweep må ikke skrive oven i en anden histories reparation.
  const { supabase, rec } = makeMock({
    riders: [MISSED],
    graduations: [{ id: "g-old", rider_id: "r-missed", status: "sold", deadline: "2026-08-30T18:00:00.000Z", created_at: "2026-08-23T18:00:00.000Z" }],
  });
  const res = await runMissedGraduateSweep({ supabase, now: NOW, isEnabled: enabled, notify: spyNotify() });
  assert.equal(res.created, 0);
  assert.equal(rec.inserts.length, 0);
});

test("sweep: rytter med ÅBENT override-vindue røres ikke", async () => {
  const { supabase, rec } = makeMock({
    riders: [MISSED],
    graduations: [{ id: "g-open", rider_id: "r-missed", status: "pending", deadline: "2026-09-15T08:00:00.000Z", created_at: "2026-09-10T08:00:00.000Z" }],
  });
  const res = await runMissedGraduateSweep({ supabase, now: NOW, isEnabled: enabled, notify: spyNotify() });
  assert.equal(res.created, 0);
  assert.equal(rec.inserts.length, 0);
});

test("sweep: rytter på åben graduate-auktion røres ikke", async () => {
  const { supabase, rec } = makeMock({
    riders: [MISSED],
    auctions: [{ rider_id: "r-missed", status: "active" }],
  });
  const res = await runMissedGraduateSweep({ supabase, now: NOW, isEnabled: enabled, notify: spyNotify() });
  assert.equal(res.created, 0);
  assert.equal(rec.inserts.length, 0);
});

test("sweep: akademi-fri-agent (team_id NULL) er invariant D's klasse, ikke vores", async () => {
  const stranded = { ...MISSED, id: "r-stranded", team_id: null };
  const { supabase, rec } = makeMock({ riders: [stranded] });
  const res = await runMissedGraduateSweep({ supabase, now: NOW, isEnabled: enabled, notify: spyNotify() });
  assert.equal(res.created, 0);
  assert.equal(rec.inserts.length, 0);
});

test("sweep: flag OFF → no-op", async () => {
  const { supabase, rec } = makeMock({ riders: [MISSED] });
  const res = await runMissedGraduateSweep({ supabase, now: NOW, isEnabled: async () => false, notify: spyNotify() });
  assert.equal(res.skipped, "flag_off");
  assert.equal(res.created, 0);
  assert.equal(rec.inserts.length, 0);
});

test("sweep: ingen aktiv sæson → no-op i stedet for et gæt", async () => {
  const { supabase, rec } = makeMock({ riders: [MISSED], activeSeason: null });
  const res = await runMissedGraduateSweep({ supabase, now: NOW, isEnabled: enabled, notify: spyNotify() });
  assert.equal(res.skipped, "no_active_season");
  assert.equal(rec.inserts.length, 0);
});

test("sweep (dryRun): lister kandidaten med hvad der ville blive oprettet, uden writes", async () => {
  const { supabase, rec } = makeMock({ riders: [MISSED, YOUNG] });
  const notify = spyNotify();
  const res = await runMissedGraduateSweep({ supabase, now: NOW, dryRun: true, isEnabled: enabled, notify });

  assert.equal(res.created, 0);
  assert.equal(rec.inserts.length, 0);
  assert.equal(notify.calls.length, 0);
  assert.equal(res.candidates.length, 1);
  assert.equal(res.candidates[0].riderId, "r-missed");
  assert.equal(res.candidates[0].teamId, "t-human");
  assert.equal(res.candidates[0].age, 22);
  assert.equal(res.candidates[0].name, "Missed Graduate");
  assert.equal(res.candidates[0].wouldCreate.season_id, "s3");
  assert.equal(res.candidates[0].wouldCreate.status, "pending");
});

test("sweep: unique-violation tælles som duplicate, ikke som fejl", async () => {
  const { supabase } = makeMock({
    riders: [MISSED],
    insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
  });
  const notify = spyNotify();
  const res = await runMissedGraduateSweep({ supabase, now: NOW, isEnabled: enabled, notify });
  assert.equal(res.created, 0);
  assert.equal(res.duplicates, 1);
  assert.equal(res.failed, 0);
  assert.equal(notify.calls.length, 0);
});

test("sweep: per-rytter fejl isoleres — de øvrige får stadig deres vindue", async () => {
  const other = { ...MISSED, id: "r-other", team_id: "t-other", firstname: "Other", lastname: "Graduate" };
  const { supabase, rec } = makeMock({ riders: [MISSED, other] });
  const notify = async (payload) => {
    if (payload.relatedId === "r-missed") throw new Error("notifikation kaputt");
  };
  const res = await runMissedGraduateSweep({ supabase, now: NOW, isEnabled: enabled, notify });
  assert.equal(res.failed, 1);
  assert.equal(res.created, 1);
  assert.equal(res.errors[0].riderId, "r-missed");
  assert.match(res.errors[0].message, /kaputt/);
  assert.equal(rec.inserts.length, 2);
});

// Importen her er halvdelen af pointen: den beviser at scriptets modulkæde
// loader rent. Et brækket import i et ops-script opdages ellers først når
// nogen kører det mod prod.
test("detect-missed-graduates: holdnavne slås op så dry-run'en kan skelne menneskehold fra AI-hold", async () => {
  const { fetchTeamLabels } = await import("../scripts/detect-missed-graduates.js");
  const supabase = {
    from(table) {
      assert.equal(table, "teams");
      return { select() { return { in(col, ids) {
        assert.equal(col, "id");
        return Promise.resolve({ data: ids.map((id) => ({ id, name: `Team ${id}`, is_ai: id === "t-ai" })), error: null });
      } }; } };
    },
  };
  const labels = await fetchTeamLabels(supabase, ["t-human", "t-ai"]);
  assert.equal(labels.get("t-human").isAi, false);
  assert.equal(labels.get("t-ai").isAi, true);
  assert.equal(labels.get("t-human").name, "Team t-human");

  assert.equal((await fetchTeamLabels(supabase, [])).size, 0, "tom liste rammer ikke databasen");
});

test("findMissedGraduates: kun ryttere uden nogen grad-række", async () => {
  const resolved = { ...MISSED, id: "r-resolved" };
  const { supabase } = makeMock({
    riders: [MISSED, resolved],
    graduations: [{ id: "g1", rider_id: "r-resolved", status: "released", deadline: "2026-08-30T18:00:00.000Z", created_at: "2026-08-23T18:00:00.000Z" }],
  });
  const res = await findMissedGraduates(supabase, { now: NOW, seasonNumber: 3 });
  assert.deepEqual(res.missed.map((m) => m.riderId), ["r-missed"]);
  assert.equal(res.checked, 2);
});
