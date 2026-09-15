// Tests for #5268-migrationen. Rene funktioner, ingen database.
//
// De fire ting der skal holde, uanset hvordan tallene senere kalibreres:
//   1. Ingen rytter mister evne-masse (ejer-beslutning 15/9, punkt 3).
//   2. Træningsfremgang overlever (delta-princippet, rapportens §5.1).
//   3. Anvendt to gange = samme resultat (idempotens).
//   4. `--apply` kan ikke ske ved et uheld.

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseArgs, readOnlyFetch, referencePlan, applyVariant, calibrateRates, summarise,
  legacyMentalBirthValues, ageOf, bandOf, percentile, VARIANTS, SHARE_CLAMP, selectRows,
} from "./dry-run-5268-mental-abilities.js";
import { CALIBRATION } from "../lib/abilityDerivation.js";

// ── Syntetisk bestand ───────────────────────────────────────────────────────
// Stats spredt over PCM-båndet 50-85 og aldre spredt over alle seks bånd, så
// både unge (som mistede gratis aggression) og veteraner (som mistede gratis
// taktik) er repræsenteret.
function makeRider(i) {
  const age = 16 + (i % 25);
  const birthYear = CALIBRATION.asOfYear - age;
  const s = (offset) => 50 + ((i * 7 + offset * 11) % 35);
  return {
    id: `rider-${String(i).padStart(4, "0")}`,
    firstname: "Test", lastname: `Rytter ${i}`,
    birthdate: `${birthYear}-06-01`,
    potentiale: 1 + (i % 6),
    stat_bj: s(1), stat_fl: s(2), stat_ned: s(3), stat_bro: s(4), stat_ftr: s(5),
    stat_sp: s(6), stat_acc: s(7), stat_bk: s(8), stat_kb: s(9), stat_tt: s(10),
    stat_prl: s(11), stat_udh: s(12), stat_res: s(13), stat_mod: s(14),
  };
}

// De nuværende evne-rækker: fødselsværdien under den GAMLE formel plus lidt
// træningsfremgang, præcis som prod-rækkerne er blevet til.
function makeRows(n = 400, extraProgress = true) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const rider = makeRider(i);
    const birth = legacyMentalBirthValues(rider);
    const progress = extraProgress ? (i % 13) : 0;
    rows.push({
      rider,
      abilities: {
        rider_id: rider.id,
        tactics: Math.min(99, birth.tactics + progress),
        aggression: Math.min(99, birth.aggression + progress),
        climbing: 20, time_trial: 18, flat: 22, tempo: 19, sprint: 15,
        acceleration: 17, punch: 21, endurance: 23, recovery: 16, durability: 18,
        descending: 14, cobblestone: 13, positioning: 20,
        teamwork: null, leadership: null,
      },
    });
  }
  return rows;
}

// ── 1. Masse ────────────────────────────────────────────────────────────────
test("#5268: ingen rytter mister evne-masse (ejer-krav, begge varianter)", () => {
  const plan = referencePlan(makeRows());
  for (const variant of VARIANTS) {
    const applied = applyVariant(plan, variant);
    const brud = applied.filter((e) => !e.massOk);
    assert.equal(brud.length, 0,
      `${variant}: ${brud.length} ryttere mistede masse, fx ${brud[0]?.riderId} `
      + `(${brud[0]?.massBefore} → ${brud[0]?.massAfter})`);
    // Samlet skal massen STIGE: alle får to nye evner oveni.
    const s = summarise(applied);
    assert.ok(s.totalMassAfter > s.totalMassBefore,
      `${variant}: samlet masse faldt (${s.totalMassBefore} → ${s.totalMassAfter})`);
  }
});

test("#5268: de to nye evner får point, taktik/aggression afgiver dem", () => {
  const applied = applyVariant(referencePlan(makeRows()), "v2");
  const s = summarise(applied);
  assert.ok(s.sums.tactics.delta < 0, "taktik skulle falde samlet");
  assert.ok(s.sums.aggression.delta < 0, "aggression skulle falde samlet");
  assert.ok(s.sums.teamwork.delta > 0, "holdarbejde skulle stige fra 0");
  assert.ok(s.sums.leadership.delta > 0, "lederskab skulle stige fra 0");
  assert.equal(s.sums.teamwork.before, 0, "holdarbejde fandtes ikke før");
  assert.equal(s.sums.leadership.before, 0, "lederskab fandtes ikke før");
});

// ── 2. Delta-princippet ─────────────────────────────────────────────────────
test("#5268 delta-princip: træningsfremgangen overlever point for point", () => {
  // Samme rytter-id i begge rækker: fødsels-støjen er salted på id'et, så to
  // forskellige id'er ville give to forskellige fødselsværdier og gøre
  // sammenligningen meningsløs. Det er rytterens EGEN fremgang der skal bevares.
  const rider = makeRider(42);
  const birth = legacyMentalBirthValues(rider);
  const rows = [
    { rider, abilities: { tactics: birth.tactics, aggression: birth.aggression } },
    { rider, abilities: { tactics: birth.tactics + 20, aggression: birth.aggression } },
  ];
  const plan = referencePlan(rows);
  assert.ok(plan[1].reference.tactics <= 99);
  assert.equal(plan[1].reference.tactics - plan[0].reference.tactics, 20,
    `træningsfremgangen på 20 point overlevede ikke `
    + `(${plan[0].reference.tactics} vs ${plan[1].reference.tactics})`);
});

test("#5268 delta-princip: en rytter uden træning lander på den NYE fødselsværdi", () => {
  const rider = makeRider(7);
  const birth = legacyMentalBirthValues(rider);
  const plan = referencePlan([{ rider, abilities: { tactics: birth.tactics, aggression: birth.aggression } }]);
  assert.equal(plan[0].reference.tactics, plan[0].newBirth.tactics);
  assert.equal(plan[0].reference.aggression, plan[0].newBirth.aggression);
});

// ── Kalibreringen er løst, ikke gættet ──────────────────────────────────────
test("#5268: V2 giver de ældste bånd en større taktik-sænkning end de yngste", () => {
  const plan = referencePlan(makeRows(600));
  const { rates } = calibrateRates(plan, "v2");
  assert.ok(rates.tactics["34+"] > rates.tactics["16-21"],
    `34+ (${rates.tactics["34+"]}) skulle miste en større andel end 16-21 (${rates.tactics["16-21"]})`);
});

test("#5268: V1 har præcis én sats pr. evne, V2 én pr. aldersbånd", () => {
  const plan = referencePlan(makeRows(600));
  const v1 = calibrateRates(plan, "v1");
  const v2 = calibrateRates(plan, "v2");
  assert.deepEqual(Object.keys(v1.rates.tactics), ["all"]);
  assert.equal(Object.keys(v2.rates.tactics).length, 6);
});

// ── 3. Idempotens ───────────────────────────────────────────────────────────
test("#5268: anvendt to gange på samme plan giver samme resultat", () => {
  const plan = referencePlan(makeRows());
  for (const variant of VARIANTS) {
    const a = applyVariant(plan, variant);
    const b = applyVariant(plan, variant);
    assert.deepEqual(b.map((e) => e.next), a.map((e) => e.next));
  }
});

test("#5268: en migreret rytter udelades af anden kørsel (markøren ER idempotensen)", () => {
  // Regnestykket kan ikke se på et tal om det allerede er sænket — en anden
  // kørsel UDEN markøren ville sænke igen. Derfor er filteret det der skal
  // testes, ikke formlen. Backup-tabellen skrives FØR opdateringen netop så
  // markøren aldrig kan mangle for en rytter der ER opdateret.
  const riders = [makeRider(1), makeRider(2), makeRider(3)];
  const abilityRows = riders.map((r) => ({ rider_id: r.id, tactics: 40, aggression: 20 }));
  const foerste = selectRows(riders, abilityRows, new Set());
  assert.equal(foerste.rows.length, 3);
  assert.equal(foerste.skipped.length, 0);

  const anden = selectRows(riders, abilityRows, new Set([riders[0].id, riders[2].id]));
  assert.deepEqual(anden.rows.map((r) => r.rider.id), [riders[1].id]);
  assert.deepEqual(anden.skipped, [riders[0].id, riders[2].id]);

  const tredje = selectRows(riders, abilityRows, new Set(riders.map((r) => r.id)));
  assert.equal(tredje.rows.length, 0, "alle migreret ⇒ kørslen er et no-op");
});

test("#5268: ryttere uden evne-række eller uden taktik/aggression springes over", () => {
  const riders = [makeRider(1), makeRider(2)];
  assert.equal(selectRows(riders, [], new Set()).rows.length, 0);
  assert.equal(
    selectRows(riders, [{ rider_id: riders[0].id, tactics: null, aggression: 20 }], new Set()).rows.length,
    0,
  );
});

// ── 4. Gates på selve kørslen ───────────────────────────────────────────────
test("#5268: --apply kan ikke ske ved et uheld", () => {
  assert.deepEqual(parseArgs([]), { apply: false, variant: null, sample: 5 });
  assert.deepEqual(parseArgs(["--dry-run"]), { apply: false, variant: null, sample: 5 });
  assert.throws(() => parseArgs(["--apply"]), /--owner-go/);
  assert.throws(() => parseArgs(["--apply", "--owner-go"]), /--variant/);
  assert.throws(() => parseArgs(["--kaboom"]), /Ukendt argument/);
  assert.deepEqual(parseArgs(["--apply", "--owner-go", "--variant=v1"]),
    { apply: true, variant: "v1", sample: 5 });
});

test("#5268: dry-run-transporten afviser alt andet end læsning", () => {
  assert.throws(() => readOnlyFetch("https://example.test", { method: "POST" }), /ikke-læsende/);
  assert.throws(() => readOnlyFetch("https://example.test", { method: "PATCH" }), /ikke-læsende/);
});

// ── Hjælpefunktioner ────────────────────────────────────────────────────────
test("#5268: aldersbånd og alder følger derivationens egen semantik", () => {
  assert.equal(ageOf({ birthdate: `${CALIBRATION.asOfYear - 17}-01-01` }), 17);
  assert.equal(ageOf({}), 25, "ingen fødselsdato ⇒ snit-alder 25, som i derivationen");
  assert.equal(bandOf(16), "16-21");
  assert.equal(bandOf(29), "28-30");
  assert.equal(bandOf(41), "34+");
});

test("#5268: percentil på tom liste er null, ikke NaN", () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
});

test("#5268: fordelingsnøglen er klampet, så ingen evne får hele puljen", () => {
  assert.ok(SHARE_CLAMP.min > 0 && SHARE_CLAMP.max < 1);
  const applied = applyVariant(referencePlan(makeRows(300)), "v1");
  const withLoss = applied.filter((e) => e.lost > 5);
  assert.ok(withLoss.length > 0, "testbestanden skulle indeholde ryttere der mister point");
  for (const e of withLoss) {
    assert.ok(e.next.teamwork > e.newBirth.teamwork || e.next.teamwork === 99,
      `${e.riderId}: holdarbejde fik intet af puljen`);
    assert.ok(e.next.leadership > e.newBirth.leadership || e.next.leadership === 99,
      `${e.riderId}: lederskab fik intet af puljen`);
  }
});
