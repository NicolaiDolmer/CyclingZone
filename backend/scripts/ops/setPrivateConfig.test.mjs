// #7390: ops-scriptet der sætter en privat indstilling. Syntetiske værdier.
import { test } from "node:test";
import assert from "node:assert/strict";

import { describeChange, parseArgs, runSetPrivateConfig } from "./setPrivateConfig.mjs";
import { PRIVATE_CONFIG_KEYS, privateConfigHash } from "../../lib/privateConfig.ts";

const CURVE = {
  rate: 7.25, levelExponent: 2, capExponent: 0.5,
  load: { fromAge: 16, fullAge: 24, floor: 0.5 },
  potentialCeiling: [0.5, 0.6, 0.7, 0.8, 0.9, 1],
};

// Falsk private_config: én tabel i hukommelsen, updated_at tæller op ved hver skrivning
// (som triggeren), `corruptReadBack` simulerer en tilbagelæsning der ikke matcher.
function fakeDb(initial = {}, { corruptReadBack = false, concurrentWrite = false } = {}) {
  let clock = 0;
  const rows = new Map(Object.entries(initial).map(([key, value]) => [key, { key, value, updated_at: `t${clock}`, updated_by: "seed" }]));
  const writes = [];
  let reads = 0;
  const client = {
    rows, writes,
    from(table) {
      assert.equal(table, "private_config");
      return {
        select: () => ({
          eq: (_c, key) => ({
            maybeSingle: async () => {
              reads += 1;
              const row = rows.get(key);
              if (row && concurrentWrite && reads === 1) {
                // Nogen skriver mellem vores læsning og skrivning.
                const snapshot = { ...row };
                row.updated_at = `t${++clock}`;
                return { data: snapshot, error: null };
              }
              if (row && corruptReadBack && reads > 1) return { data: { ...row, value: { ...row.value, rate: 1 } }, error: null };
              return { data: row ? { ...row } : null, error: null };
            },
          }),
        }),
        update: (patch) => {
          const filters = {};
          const chain = {
            eq(col, val) { filters[col] = val; return chain; },
            async select() {
              const row = rows.get(filters.key);
              if (!row || row.updated_at !== filters.updated_at) return { data: [], error: null };
              Object.assign(row, patch, { updated_at: `t${++clock}` });
              writes.push({ op: "update", ...patch });
              return { data: [{ key: row.key }], error: null };
            },
          };
          return chain;
        },
        insert: async (row) => {
          if (rows.has(row.key)) return { error: { message: "duplicate key" } };
          rows.set(row.key, { ...row, updated_at: `t${++clock}` });
          writes.push({ op: "insert", ...row });
          return { error: null };
        },
      };
    },
  };
  return client;
}

const capture = () => { const out = []; return { out, log: { log: (m) => out.push(String(m)) } }; };
const noNumbersFrom = (out, value) => {
  for (const n of JSON.stringify(value).match(/\d+(\.\d+)?/g)) {
    if (n.length < 2 && !n.includes(".")) continue; // enkeltcifre optræder i hashes/tidsstempler
    assert.ok(!out.some((l) => l.includes(n)), `tallet ${n} må ikke stå i output: ${out.join(" | ")}`);
  }
};

test("parseArgs: --key, --file, --dry-run, --actor; ukendte argumenter afvises", () => {
  assert.deepEqual(parseArgs(["--key", "k", "--file=v.json", "--dry-run", "--actor", "claude (go)"]),
    { key: "k", file: "v.json", dryRun: true, actor: "claude (go)", help: false });
  assert.throws(() => parseArgs(["--bogus"]), /Ukendt argument/);
  assert.throws(() => parseArgs(["--key"]), /kræver en værdi/);
});

test("ny række: skrives, læses tilbage og bekræftes; output er værdi-frit", async () => {
  const db = fakeDb();
  const { out, log } = capture();
  const res = await runSetPrivateConfig({ supabase: db, key: "development_curve_b_params", value: CURVE, log, actor: "claude" });
  assert.equal(res.status, "written");
  assert.deepEqual(db.writes, [{ op: "insert", key: "development_curve_b_params", value: CURVE, updated_by: "claude" }]);
  assert.ok(out.some((l) => l.startsWith("Bekræftet:") && l.includes(privateConfigHash(CURVE))));
  assert.ok(out.some((l) => l.includes("(ny række)")));
  noNumbersFrom(out, CURVE);
});

test("eksisterende række: diff viser kun felter + hash; opdatering med optimistisk vagt", async () => {
  const db = fakeDb({ development_curve_b_params: CURVE });
  const { out, log } = capture();
  const next = { ...CURVE, load: { ...CURVE.load, floor: 0.65 }, aboveCeilingFloor: 0.15 };
  const res = await runSetPrivateConfig({ supabase: db, key: "development_curve_b_params", value: next, log });
  assert.equal(res.status, "written");
  assert.ok(out.includes("Felter der ændres: +aboveCeilingFloor, load.floor"), out.join("\n"));
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].op, "update");
  noNumbersFrom(out, next);
});

test("dry-run og uændret værdi skriver intet", async () => {
  const db = fakeDb({ development_curve_b_params: CURVE });
  const { log } = capture();
  assert.equal((await runSetPrivateConfig({ supabase: db, key: "development_curve_b_params", value: { ...CURVE, rate: 9.5 }, dryRun: true, log })).status, "dry-run");
  // Samme indhold i en anden nøgle-rækkefølge er "uændret".
  const reordered = Object.fromEntries(Object.entries(CURVE).reverse());
  assert.equal((await runSetPrivateConfig({ supabase: db, key: "development_curve_b_params", value: reordered, log })).status, "unchanged");
  assert.equal(db.writes.length, 0);
});

test("afvisninger: ukendt nøgle, ugyldig værdi, tom aktør; intet skrives og ingen tal i beskeden", async () => {
  const db = fakeDb();
  const { log } = capture();
  await assert.rejects(() => runSetPrivateConfig({ supabase: db, key: "app_secret", value: {}, log }), /Ukendt nøgle/);
  await assert.rejects(() => runSetPrivateConfig({ supabase: db, key: "development_curve_b_params", value: { ...CURVE, rate: -98765 }, log }),
    (err) => /Ugyldig værdi/.test(err.message) && !err.message.includes("98765"));
  await assert.rejects(() => runSetPrivateConfig({ supabase: db, key: "weekly_engine_drift_thresholds", value: { minStages: 1, groups: { tour: {} } }, log }), /ukendt loebsgruppe/);
  await assert.rejects(() => runSetPrivateConfig({ supabase: db, key: "development_curve_b_params", value: CURVE, actor: " ", log }), /actor/);
  assert.equal(db.writes.length, 0);
});

test("samtidig ændring: opdateringen afvises i stedet for at overskrive", async () => {
  const db = fakeDb({ development_curve_b_params: CURVE }, { concurrentWrite: true });
  const { log } = capture();
  await assert.rejects(() => runSetPrivateConfig({ supabase: db, key: "development_curve_b_params", value: { ...CURVE, rate: 8 }, log }), /ændret af en anden/);
  assert.equal(db.writes.length, 0);
});

test("tilbagelæsning der ikke matcher = fejl (ingen falsk bekræftelse)", async () => {
  const db = fakeDb({}, { corruptReadBack: true });
  const { log } = capture();
  await assert.rejects(() => runSetPrivateConfig({ supabase: db, key: "development_curve_b_params", value: CURVE, log }), /matcher ikke/);
});

test("describeChange: klartekst kun for ikke-private nøgler", () => {
  const priv = describeChange({ key: "k", spec: PRIVATE_CONFIG_KEYS.development_curve_b_params, before: null, after: CURVE });
  assert.ok(!priv.some((l) => l.includes("7.25")));
  const open = describeChange({ key: "k", spec: { private: false }, before: { a: 1 }, after: { a: 2 } });
  assert.ok(open.includes('Efter: {"a":2}'));
});
