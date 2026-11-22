// #8549 · Week blocks: ren kerne assignDayFields (prioritet pr. felt + eet laast pas pr. dag).
import assert from "node:assert/strict";
import test from "node:test";

import { assignDayFields, lockSlotOf } from "./trainingWeekBlocks.js";
import { PROGRAM_SLOTS, sessionForDayEntry } from "./trainingPrograms.js";
import { effortForDayEntry } from "./trainingEffortLevels.js";

const FIELDS = [0, 1, 2, 3, 4];
// Alle 2^5 loebsmaengder over dagens fem felter.
const ALL_RACE_SETS = Array.from({ length: 1 << PROGRAM_SLOTS }, (_, mask) => FIELDS.filter((f) => mask & (1 << f)));

// En dag med fem forskellige pas og egne indsatser, saa en kilde kan genkendes paa sit indhold.
const MIXED_DAY = {
  session: "endurance", intensity: "easy",
  slots: [null, "sprint", "technique", "vo2max", "tempo"],
  effort: "normal",
  slotEfforts: ["easy", null, "hard", null, "hard"],
};
const withLock = (entry, lockSlot) => ({ ...entry, lockSlot });

// Invarianten pr. resultat: hver kilde bruges hoejst een gang, og placerede kilder + taken
// er praecis de fem kilder (ingen tabt, ingen dobbelt).
function assertPartition(result, msg) {
  const placed = result.fieldSource.filter((s) => s != null);
  assert.equal(new Set(placed).size, placed.length, `${msg}: ingen kilde to gange`);
  assert.deepEqual([...placed, ...result.taken].sort((a, b) => a - b), FIELDS, `${msg}: alle kilder taelles een gang`);
}

test("ingen loeb = identitet (med og uden laas)", () => {
  for (const lock of [undefined, 0, 2, 4]) {
    const r = assignDayFields({ entry: withLock(MIXED_DAY, lock) });
    assert.deepEqual(r, { fieldSource: [0, 1, 2, 3, 4], taken: [], lockMovedFrom: null }, `lock=${lock}`);
  }
});

test("eet loeb uden laas: felterne rykker ned, og det laveste prioritet falder af", () => {
  const expected = {
    0: [null, 0, 1, 2, 3],
    1: [0, null, 1, 2, 3],
    2: [0, 1, null, 2, 3],
    3: [0, 1, 2, null, 3],
    4: [0, 1, 2, 3, null],
  };
  for (const race of FIELDS) {
    const r = assignDayFields({ entry: MIXED_DAY, raceFields: [race] });
    assert.deepEqual(r.fieldSource, expected[race], `loeb i felt ${race}`);
    assert.deepEqual(r.taken, [4], "prioritet 5 er taget");
    assert.equal(r.lockMovedFrom, null);
  }
});

test("eet loeb med laas i hjemmet LD 5: laasen holder, en anden falder af", () => {
  for (const race of [0, 1, 2, 3]) {
    const r = assignDayFields({ entry: withLock(MIXED_DAY, 4), raceFields: [race] });
    assert.equal(r.fieldSource[4], 4, `loeb i felt ${race}: laasen bliver hjemme`);
    assert.equal(r.lockMovedFrom, null);
    assert.deepEqual(r.taken, [3], "laveste ikke-laaste prioritet falder af");
    assertPartition(r, `race ${race}`);
  }
});

test("loeb i laasens hjemmefelt: laasen flytter til NAERMESTE frie felt, ved lige afstand det senere (ejer 21/11)", () => {
  // Hjem LD 3, loeb kun dér: LD 2 og LD 4 er lige langt vaek -> det senere (LD 4).
  let r = assignDayFields({ entry: withLock(MIXED_DAY, 2), raceFields: [2] });
  assert.deepEqual(r.fieldSource, [0, 1, null, 2, 3]);
  assert.equal(r.lockMovedFrom, 2);
  assert.deepEqual(r.taken, [4]);

  // Hjem LD 3, loeb i LD 3 og LD 4: LD 2 (afstand 1) slaar LD 5 (afstand 2).
  r = assignDayFields({ entry: withLock(MIXED_DAY, 2), raceFields: [2, 3] });
  assert.deepEqual(r.fieldSource, [0, 2, null, null, 1]);
  assert.equal(r.lockMovedFrom, 2);
  assert.deepEqual(r.taken, [3, 4]);

  // Hjem LD 5 med to loeb inkl. LD 5 (det hyppige tilfaelde i maalingen): naermeste frie foer.
  r = assignDayFields({ entry: withLock(MIXED_DAY, 4), raceFields: [0, 4] });
  assert.deepEqual(r.fieldSource, [null, 0, 1, 4, null]);
  assert.equal(r.lockMovedFrom, 4);
  assert.deepEqual(r.taken, [2, 3]);

  // Hjem LD 1, loeb i LD 1: kun LD 2 er naermest.
  r = assignDayFields({ entry: withLock(MIXED_DAY, 0), raceFields: [0] });
  assert.deepEqual(r.fieldSource, [null, 0, 1, 2, 3]);
  assert.equal(r.lockMovedFrom, 0);
});

test("fem loeb: alt er taget, ogsaa laasen", () => {
  for (const lock of [undefined, 0, 4]) {
    const r = assignDayFields({ entry: withLock(MIXED_DAY, lock), raceFields: FIELDS });
    assert.deepEqual(r, { fieldSource: [null, null, null, null, null], taken: [0, 1, 2, 3, 4], lockMovedFrom: null });
  }
});

test("egenskab over alle 2^5 loebsmaengder x laas: partition, loebsfelter er tomme, frie felter fyldes i raekkefoelge", () => {
  for (const lock of [undefined, 0, 1, 2, 3, 4]) {
    for (const races of ALL_RACE_SETS) {
      const msg = `lock=${lock} races=[${races}]`;
      const r = assignDayFields({ entry: withLock(MIXED_DAY, lock), raceFields: new Set(races) });
      assertPartition(r, msg);
      for (const f of races) assert.equal(r.fieldSource[f], null, `${msg}: loebsfelt ${f} har intet pas`);
      const free = FIELDS.filter((f) => !races.includes(f));
      for (const f of free) assert.notEqual(r.fieldSource[f], null, `${msg}: frit felt ${f} faar et pas`);
      assert.equal(r.taken.length, races.length, `${msg}: et loeb tager praecis eet pas`);
      // Ikke-laaste kilder ligger i prioritetsraekkefoelge i tidsraekkefoelge.
      const unlocked = free.map((f) => r.fieldSource[f]).filter((s) => s !== lock);
      assert.deepEqual(unlocked, [...unlocked].sort((a, b) => a - b), `${msg}: prioritet foelger tiden`);
      // Laasen koerer, saa laenge der er et frit felt.
      if (lock != null && free.length) {
        assert.ok(r.fieldSource.includes(lock), `${msg}: laasen koerer`);
        const at = r.fieldSource.indexOf(lock);
        assert.equal(r.lockMovedFrom, at === lock ? null : lock, `${msg}: lockMovedFrom`);
        const nearest = Math.min(...free.map((f) => Math.abs(f - lock)));
        assert.equal(Math.abs(at - lock), nearest, `${msg}: naermeste frie felt`);
        if (free.includes(lock + nearest)) assert.equal(at, lock + nearest, `${msg}: ved lige afstand det senere`);
      }
      // Uden laas tager loeb altid laveste prioritet foerst.
      if (lock == null) assert.deepEqual(r.taken, FIELDS.slice(PROGRAM_SLOTS - races.length), msg);
    }
  }
});

test("prefix-stabilitet: alle 2^5 loebsmaengder x alle settled-prefixer x et senere loeb", () => {
  let cases = 0;
  for (const lock of [undefined, 0, 1, 2, 3, 4]) {
    const entry = withLock(MIXED_DAY, lock);
    for (const races of ALL_RACE_SETS) {
      const before = assignDayFields({ entry, raceFields: races });
      for (let p = 0; p <= PROGRAM_SLOTS; p += 1) {
        const settled = new Map(FIELDS.slice(0, p).map((f) => [f, before.fieldSource[f]]));
        // Samme loeb + afregnet prefix = samme resultat (afregningen flytter intet).
        assert.deepEqual(assignDayFields({ entry, raceFields: races, settled }), before, `lock=${lock} races=[${races}] p=${p}`);
        for (const late of FIELDS.slice(p)) {
          if (races.includes(late)) continue;
          const msg = `lock=${lock} races=[${races}] p=${p} +${late}`;
          const after = assignDayFields({ entry, raceFields: [...races, late], settled });
          for (let f = 0; f < p; f += 1) {
            assert.equal(after.fieldSource[f], before.fieldSource[f], `${msg}: afregnet felt ${f} er uaendret`);
          }
          assert.equal(after.fieldSource[late], null, `${msg}: det nye loebsfelt`);
          assertPartition(after, msg);
          cases += 1;
        }
      }
    }
  }
  assert.ok(cases > 0);
});

test("afregnet ude af raekkefoelge (Train now, #7737): det afregnede felt ligger fast, ingen kilde dobbelt", () => {
  // LD 4 er afregnet med sin kilde foer LD 1..3; et loeb i LD 2 kommer til bagefter.
  const entry = withLock(MIXED_DAY, 1);
  const settled = new Map([[3, 3]]);
  const r = assignDayFields({ entry, raceFields: [1], settled });
  assert.equal(r.fieldSource[3], 3, "LD 4 er uaendret");
  assert.equal(r.fieldSource[2], 1, "laasen (hjem LD 2) flytter til naermeste frie, ikke-afregnede felt (LD 3)");
  assert.equal(r.lockMovedFrom, 1);
  assertPartition(r, "train now");

  // Laasen er allerede koert uden for hjemmet: den koeres ikke igen og staar som flyttet.
  const ran = assignDayFields({ entry, raceFields: [1], settled: new Map([[0, 0], [2, 1]]) });
  assert.deepEqual(ran.fieldSource, [0, null, 1, 2, 3]);
  assert.equal(ran.lockMovedFrom, 1);
  assert.deepEqual(ran.taken, [4]);
});

test("ens pas paa alle felter = dagens regel: hvert frit felt koerer dagens session og indsats", () => {
  const same = { session: "threshold", intensity: "normal", effort: "hard" };
  for (const lock of [undefined, 0, 2, 4]) {
    for (const races of ALL_RACE_SETS) {
      const entry = withLock(same, lock);
      const r = assignDayFields({ entry, raceFields: races });
      for (const f of FIELDS) {
        // Dagens regel: et loebsfelt springer passet over, et frit felt koerer sit eget pas.
        const today = races.includes(f) ? null : sessionForDayEntry(entry, f);
        const now = r.fieldSource[f] == null ? null : sessionForDayEntry(entry, r.fieldSource[f]);
        assert.equal(now, today, `lock=${lock} races=[${races}] felt ${f}`);
        if (r.fieldSource[f] != null) {
          assert.equal(effortForDayEntry(entry, r.fieldSource[f]), effortForDayEntry(entry, f));
        }
      }
    }
  }
});

test("indsatsen foelger kilden, ikke feltets tidspunkt", () => {
  // Hjem LD 5 (tempo, hard) flytter til LD 4 ved loeb i LD 5: LD 4 koerer tempo paa hard.
  const entry = withLock(MIXED_DAY, 4);
  const r = assignDayFields({ entry, raceFields: [4] });
  assert.equal(r.fieldSource[3], 4);
  assert.equal(sessionForDayEntry(entry, r.fieldSource[3]), "tempo");
  assert.equal(effortForDayEntry(entry, r.fieldSource[3]), "hard");
  assert.notEqual(effortForDayEntry(entry, 3), "hard", "feltets eget pas havde en anden indsats");
  // Uden laas: loeb i LD 1 -> LD 2 koerer prioritet 1 (endurance, easy).
  const r2 = assignDayFields({ entry: MIXED_DAY, raceFields: [0] });
  assert.equal(sessionForDayEntry(MIXED_DAY, r2.fieldSource[1]), "endurance");
  assert.equal(effortForDayEntry(MIXED_DAY, r2.fieldSource[1]), "easy");
});

test("robust input: ugyldig laas, ugyldige loebsfelter, tom raekke, Array som settled", () => {
  assert.equal(lockSlotOf({ lockSlot: 5 }), null);
  assert.equal(lockSlotOf({ lockSlot: -1 }), null);
  assert.equal(lockSlotOf({ lockSlot: "2" }), null);
  assert.equal(lockSlotOf({ lockSlot: 1.5 }), null);
  assert.equal(lockSlotOf(null), null);
  assert.equal(lockSlotOf({ lockSlot: 0 }), 0);
  const r = assignDayFields({ entry: { ...MIXED_DAY, lockSlot: 7 }, raceFields: [9, -1, "2", 1] });
  assert.deepEqual(r, { fieldSource: [0, null, 1, 2, 3], taken: [4], lockMovedFrom: null });
  assert.deepEqual(assignDayFields(), { fieldSource: [0, 1, 2, 3, 4], taken: [], lockMovedFrom: null });
  assert.deepEqual(
    assignDayFields({ entry: MIXED_DAY, raceFields: [2], settled: [[0, 0], [1, 1]] }).fieldSource,
    [0, 1, null, 2, 3],
  );
});

// Dommer 22/11 fund 1 (WB-7): et felt som traethedsgraensen erstattede, afregnes MED sin
// kilde. Saa giver afregningen samme kilder og samme taget som foer, og laasen indhentes ikke.
test("WB-7: laas B, etape paa LD2, graensen erstatter LD3: samme kilder foer og efter afregning", () => {
  const entry = withLock(MIXED_DAY, 1);
  const before = assignDayFields({ entry, raceFields: [1] });
  assert.deepEqual(before.fieldSource, [0, null, 1, 2, 3]);
  assert.deepEqual(before.taken, [4]);
  assert.equal(before.lockMovedFrom, 1);

  // LD1 koerte A, LD2 var loeb (null), LD3 blev erstattet af graensen, men passet (B) er brugt.
  const after = assignDayFields({ entry, raceFields: [1], settled: new Map([[0, 0], [1, null], [2, 1]]) });
  assert.deepEqual(after.fieldSource, before.fieldSource);
  assert.deepEqual(after.taken, before.taken);
  assert.equal(after.lockMovedFrom, 1);
  assertPartition(after, "WB-7 efter afregning");
});

// Dommer 22/11 fund 3: et Map der har vaeret gennem JSON er et almindeligt objekt.
test("settled som almindeligt objekt (efter JSON) giver samme svar som Map", () => {
  const entry = withLock(MIXED_DAY, 1);
  const asMap = assignDayFields({ entry, raceFields: [1], settled: new Map([[0, 0], [1, null], [2, 1]]) });
  const asObject = assignDayFields({ entry, raceFields: [1], settled: JSON.parse(JSON.stringify({ 0: 0, 1: null, 2: 1 })) });
  assert.deepEqual(asObject, asMap);
});
