import { test } from "node:test";
import assert from "node:assert/strict";
import { proRataShare, proRataAmount, ensureMidSeasonSponsor } from "./midSeasonSponsor.js";

// ── proRataShare ─────────────────────────────────────────────────────────────

test("#3730 andel = resterende løbsdage / total", () => {
  assert.equal(proRataShare({ raceDaysTotal: 28, raceDaysCompleted: 0 }), 1);
  assert.equal(proRataShare({ raceDaysTotal: 28, raceDaysCompleted: 14 }), 0.5);
  assert.equal(proRataShare({ raceDaysTotal: 28, raceDaysCompleted: 21 }), 0.25);
});

test("#3730 sæsonen er slut eller på sidste dag → 0, ingen udbetaling", () => {
  assert.equal(proRataShare({ raceDaysTotal: 28, raceDaysCompleted: 28 }), 0);
  assert.equal(proRataShare({ raceDaysTotal: 28, raceDaysCompleted: 29 }), 0);
});

// Skæve data må aldrig give en udbetaling der er større end en fuld base, og aldrig
// en division-by-zero. Et hold der kom ind på den sidste dag skal have 0, ikke alt.
test("#3730 skæve data giver aldrig mere end fuld base og aldrig NaN", () => {
  assert.equal(proRataShare({ raceDaysTotal: 0, raceDaysCompleted: 0 }), 0);
  assert.equal(proRataShare({ raceDaysTotal: -5, raceDaysCompleted: 0 }), 0);
  assert.equal(proRataShare({ raceDaysTotal: null, raceDaysCompleted: 3 }), 0);
  assert.equal(proRataShare({ raceDaysTotal: 28, raceDaysCompleted: null }), 1);
  assert.equal(proRataShare({ raceDaysTotal: 28, raceDaysCompleted: -4 }), 1);
  assert.equal(proRataShare({}), 0);
  assert.equal(proRataShare(), 0);
});

// ── proRataAmount ────────────────────────────────────────────────────────────

test("#3730 beløb = base × andel, afrundet", () => {
  assert.equal(proRataAmount({ guaranteedBase: 292004, share: 1 }), 292004);
  assert.equal(proRataAmount({ guaranteedBase: 292004, share: 0.5 }), 146002);
  assert.equal(proRataAmount({ guaranteedBase: 292004, share: 0.704 }), 205571);
});

test("#3730 ingen base eller ingen andel → 0", () => {
  assert.equal(proRataAmount({ guaranteedBase: 0, share: 0.5 }), 0);
  assert.equal(proRataAmount({ guaranteedBase: 292004, share: 0 }), 0);
  assert.equal(proRataAmount({ guaranteedBase: -100, share: 0.5 }), 0);
  assert.equal(proRataAmount({ guaranteedBase: 292004, share: null }), 0);
  assert.equal(proRataAmount({}), 0);
});

// Forward-guard: andelen kan ikke overstige 1, så en fejl i kaldstedet ikke kan
// udbetale mere end den fulde base.
test("#3730 andel over 1 klippes til fuld base", () => {
  assert.equal(proRataAmount({ guaranteedBase: 292004, share: 2.5 }), 292004);
});

// ── Regressions-lås mod den målte virkelighed ────────────────────────────────
//
// Målt i prod 14/8: de 43 hold oprettet i sæson 2 var med i snit 70,4 % af sæsonen,
// og et fuldt-sæson-D4-hold fik i snit 292.004 i garanteret sponsor. Kompensationen
// blev derfor regnet til ~205.484 pr. hold. Testen låser at formlen giver samme
// størrelsesorden, så en fremtidig ændring af enheden (kalenderdage frem for
// løbsdage, eller base frem for target) fanges her i stedet for i en udbetaling.
test("#3730 matcher den målte kompensation pr. hold (~205k ved 70,4 % af 292.004)", () => {
  const share = proRataShare({ raceDaysTotal: 28, raceDaysCompleted: 8 });
  assert.ok(Math.abs(share - 0.714) < 0.02, `andel ${share} lå ikke omkring 0,70`);
  const amount = proRataAmount({ guaranteedBase: 292004, share });
  assert.ok(
    Math.abs(amount - 205484) < 12000,
    `beløb ${amount} lå ikke omkring den målte kompensation 205.484`,
  );
});

// ── ensureMidSeasonSponsor · flow ────────────────────────────────────────────

function makeSupabase({ season, insertResult } = {}) {
  const calls = { inserts: [] };
  const supabase = {
    calls,
    from(table) {
      if (table === "seasons") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: season ?? null, error: null }) }) }),
        };
      }
      if (table === "sponsor_contracts") {
        return {
          insert(row) {
            calls.inserts.push(row);
            return { select: () => ({ single: async () => ({ data: insertResult ?? { id: "c1", ...row }, error: null }) }) };
          },
        };
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
  return supabase;
}

const OFFER = {
  variant: "safe", sponsorName: "Preview Sponsor", guaranteedBase: 292004,
  guaranteedFraction: 0.8, raceDayShare: 0.2, lengthSeasons: 2, clauses: [],
};
const DEPS = {
  getActiveContractFn: async () => null,
  getOffersFn: async () => [OFFER],
  loadSeasonStageCountsFn: async () => ({}),
};

test("#3730 ingen aktiv sæson → springer over, kaster ikke", async () => {
  const r = await ensureMidSeasonSponsor({
    supabase: makeSupabase({ season: null }), team: { id: "t1" }, ...DEPS,
    creditFn: async () => ({ skipped: false }),
  });
  assert.deepEqual(r, { skipped: "no_active_season" });
});

test("#3730 holdet har allerede en kontrakt → opretter ikke en til", async () => {
  const sb = makeSupabase({ season: { id: "s2", number: 2, race_days_total: 28, race_days_completed: 8 } });
  const r = await ensureMidSeasonSponsor({
    supabase: sb, team: { id: "t1" }, ...DEPS,
    getActiveContractFn: async () => ({ id: "eksisterende" }),
    creditFn: async () => ({ skipped: false }),
  });
  assert.equal(r.skipped, "already_has_contract");
  assert.equal(sb.calls.inserts.length, 0);
});

test("#3730 sæsonen er kørt færdig → hverken kontrakt eller udbetaling", async () => {
  const sb = makeSupabase({ season: { id: "s2", number: 2, race_days_total: 28, race_days_completed: 28 } });
  let credited = false;
  const r = await ensureMidSeasonSponsor({
    supabase: sb, team: { id: "t1" }, ...DEPS,
    creditFn: async () => { credited = true; return { skipped: false }; },
  });
  assert.equal(r.skipped, "season_over");
  assert.equal(sb.calls.inserts.length, 0);
  assert.equal(credited, false);
});

test("#3730 midt i sæsonen → kontrakt oprettet og forholdsmæssig base udbetalt", async () => {
  const sb = makeSupabase({ season: { id: "s2", number: 2, race_days_total: 28, race_days_completed: 21 } });
  let payload = null;
  const r = await ensureMidSeasonSponsor({
    supabase: sb, team: { id: "t1", division: 4 }, ...DEPS,
    creditFn: async (_c, args) => { payload = args; return { skipped: false }; },
  });

  assert.equal(sb.calls.inserts.length, 1);
  const row = sb.calls.inserts[0];
  assert.equal(row.status, "active");
  assert.equal(row.start_season, 2);
  assert.equal(row.expires_after_season, 3);
  assert.equal(row.guaranteed_base, 292004);

  // 7 af 28 løbsdage tilbage = 25 % af basen.
  assert.equal(r.share, 0.25);
  assert.equal(r.amount, 73001);
  assert.equal(r.paid, true);
  assert.equal(payload.delta, 73001);
  assert.equal(payload.payload.type, "sponsor");
  assert.equal(payload.payload.reason_code, "midseason_sponsor_prorata");
  assert.equal(payload.payload.idempotency_key, "midseason_sponsor:s2:t1");
});

// Forward-guard mod dobbeltbetaling: nøglen SKAL være pr. (sæson, hold), ellers kan en
// retry efter en halvvejs-fejl betale to gange, og et hold der rykker division i samme
// sæson kan få basen igen.
test("#3730 idempotency-nøglen er pr. sæson og hold", async () => {
  const sb = makeSupabase({ season: { id: "sX", number: 5, race_days_total: 40, race_days_completed: 10 } });
  let key = null;
  await ensureMidSeasonSponsor({
    supabase: sb, team: { id: "holdA" }, ...DEPS,
    creditFn: async (_c, args) => { key = args.payload.idempotency_key; return { skipped: true }; },
  });
  assert.equal(key, "midseason_sponsor:sX:holdA");
});
