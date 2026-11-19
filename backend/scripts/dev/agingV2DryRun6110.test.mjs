// #6110 dommer-fund F5 (19/11): prøvekørslen af sæsonskiftet viser den regel, skiftet bruger.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dryRunAgingCfg } from "./agingV2DryRun6110.mjs";
import { XP_TEST_PARAMS } from "../../lib/__fixtures__/developmentXpOffScenarios.js";
import { DEVELOPMENT_XP_FLAG_KEY, DEVELOPMENT_XP_FROM_DATE_KEY, DEVELOPMENT_XP_PARAMS_KEY } from "../../lib/developmentXpFlag.ts";

const AGING = { plateauThroughAge: 26, declineByYearsPastPlateau: [{ maxYears: 99, drop: 2 }], late: { fromAge: 32, drop: 0.5 } };
const B = { ...XP_TEST_PARAMS, price: { ...XP_TEST_PARAMS.price, top: 140 }, aging: AGING };

function sb({ app = {}, priv = {} } = {}) {
  return {
    from(table) {
      let key = null;
      const chain = {
        select() { return chain; },
        eq(_c, k) { key = k; return chain; },
        async maybeSingle() {
          const src = table === "app_config" ? app : table === "private_config" ? priv : {};
          return { data: key !== null && key in src ? { value: src[key] } : null, error: null };
        },
      };
      return chain;
    },
  };
}

test("F5: kandidat-talfil (--talfil) giver XP-aldringen uden at læse prod", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dryrun6110-"));
  const file = join(dir, "kandidat.json");
  writeFileSync(file, JSON.stringify({ xp: B }));
  const throwing = { from() { throw new Error("prod må ikke læses med --talfil"); } };
  const { cfg, source } = await dryRunAgingCfg({ sb: throwing, date: "2026-11-28", talfil: file });
  assert.equal(source, "talfil");
  assert.equal(cfg.plateauThroughAge, 26);
  assert.deepEqual(cfg.late, AGING.late);
});

test("F5: ugyldig kandidat-talfil stopper prøvekørslen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dryrun6110-"));
  const file = join(dir, "kandidat.json");
  writeFileSync(file, JSON.stringify({ xp: { ...B, aging: undefined } }));
  await assert.rejects(dryRunAgingCfg({ sb: sb(), date: "2026-11-28", talfil: file }), /ugyldig/);
});

test("F5: uden --talfil læses prod: kontakt off = dagens, on fra skiftets dato = XP", async () => {
  const priv = { [DEVELOPMENT_XP_PARAMS_KEY]: B };
  assert.equal((await dryRunAgingCfg({ sb: sb({ app: { [DEVELOPMENT_XP_FLAG_KEY]: "off" }, priv }), date: "2026-11-28" })).cfg, null);
  const on = sb({ app: { [DEVELOPMENT_XP_FLAG_KEY]: "on", [DEVELOPMENT_XP_FROM_DATE_KEY]: "2026-11-28" }, priv });
  assert.ok((await dryRunAgingCfg({ sb: on, date: "2026-11-28" })).cfg);
  assert.equal((await dryRunAgingCfg({ sb: on, date: "2026-11-27" })).cfg, null, "dagen før startdatoen");
});
