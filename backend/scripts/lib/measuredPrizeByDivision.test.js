// Tests for measuredPrizeByDivision.js (#1819).
//
// FORWARD-GUARD, ikke enheds-pyntning: rod-årsagen bag #1816 var at en ANTAGET
// præmie stod i moneySupplyScorecard.js og blev brugt som var den målt. Fejlen
// overlevede fordi intet fangede at mærkatet "(IKKE målt)" stadig stod der efter
// at præmien var blevet reskaleret. Disse tests fanger både at provenancen
// mangler, og at gættet sniger sig tilbage i scorecardet.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRIZE_MEASUREMENT,
  MEASURED_PRIZE_SEASON2,
  PRIZE_MEASURED_BY_DIVISION,
  PRIZE_MEDIAN_BY_DIVISION,
  prizeProvenanceLine,
} from "./measuredPrizeByDivision.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCORECARD = join(HERE, "..", "moneySupplyScorecard.js");

describe("measuredPrizeByDivision — provenance", () => {
  it("bærer måledato, sæson og metode", () => {
    assert.match(PRIZE_MEASUREMENT.measured_at, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(PRIZE_MEASUREMENT.season, 2);
    assert.ok(PRIZE_MEASUREMENT.method.length > 40, "metoden skal beskrive attributionen");
    assert.match(PRIZE_MEASUREMENT.method, /league_division_id/);
  });

  it("dækker alle fire divisioner med hold-antal, pulje og note", () => {
    for (const d of [1, 2, 3, 4]) {
      const m = MEASURED_PRIZE_SEASON2[d];
      assert.ok(m, `division ${d} mangler`);
      assert.ok(m.teams > 0, `division ${d}: hold-antal skal være positivt`);
      assert.ok(m.mean > 0, `division ${d}: gennemsnit skal være positivt`);
      assert.ok(m.note && m.note.length > 10, `division ${d}: note skal forklare tallet`);
    }
  });

  it("markerer D1 som AFLEDT (sæson 2 havde ingen hold i D1) og resten som målt", () => {
    assert.equal(MEASURED_PRIZE_SEASON2[1].derived, true);
    for (const d of [2, 3, 4]) assert.equal(MEASURED_PRIZE_SEASON2[d].derived, false);
  });

  it("D1's afledte tal er puljen delt med pladserne, ikke et frit valgt tal", () => {
    const m = MEASURED_PRIZE_SEASON2[1];
    assert.equal(m.mean, Math.round(m.pool / m.teams));
  });

  it("medianen ligger under gennemsnittet hvor den er målt (fordelingen er højreskæv)", () => {
    for (const d of [2, 3, 4]) {
      assert.ok(
        PRIZE_MEDIAN_BY_DIVISION[d] < PRIZE_MEASURED_BY_DIVISION[d],
        `division ${d}: median ${PRIZE_MEDIAN_BY_DIVISION[d]} burde ligge under gennemsnit ${PRIZE_MEASURED_BY_DIVISION[d]}`
      );
    }
    assert.equal(PRIZE_MEDIAN_BY_DIVISION[1], null, "D1 har ingen hold-median at måle");
  });

  it("præmien falder monotont ned gennem divisionerne", () => {
    for (const d of [1, 2, 3]) {
      assert.ok(
        PRIZE_MEASURED_BY_DIVISION[d] > PRIZE_MEASURED_BY_DIVISION[d + 1],
        `D${d} burde tjene mere end D${d + 1}`
      );
    }
  });

  it("provenance-linjen nævner både sæson og måledato", () => {
    const line = prizeProvenanceLine();
    assert.match(line, /sæson 2/);
    assert.match(line, new RegExp(PRIZE_MEASUREMENT.measured_at));
  });
});

describe("moneySupplyScorecard — gættet må ikke snige sig tilbage (#1819)", () => {
  const src = readFileSync(SCORECARD, "utf8");

  it("bærer ikke mærkatet (IKKE målt) i sit output", () => {
    const outputLines = src.split("\n").filter((l) => l.includes("console.log"));
    for (const line of outputLines) {
      assert.ok(!line.includes("IKKE målt"), `outputtet må ikke påstå (IKKE målt): ${line.trim()}`);
    }
  });

  it("henter præmie-niveauet fra måle-modulet i stedet for at hardkode det", () => {
    assert.match(src, /from "\.\/lib\/measuredPrizeByDivision\.js"/);
    assert.ok(
      !/PRIZE_ESTIMATE_BY_DIVISION\s*=\s*\{\s*1:\s*\d/.test(src),
      "præmie-niveauet må ikke hardkodes som et objekt-literal igen"
    );
    assert.ok(
      !/TIERS4_PRIZE_ESTIMATE_BY_DIVISION\s*=\s*\{\s*1:\s*\d/.test(src),
      "4-tier-præmien må ikke hardkodes som et objekt-literal igen"
    );
  });

  it("balance-trajektorien har en NEDRE grænse (en negativ balance er ikke et bestået tjek)", () => {
    const checks = src.match(/const ok = ratio [^\n]*/g) || [];
    assert.ok(checks.length >= 2, "begge sektioner skal have et trajektorie-tjek");
    for (const c of checks) {
      assert.match(c, /ratio >= 0/, `mangler nedre grænse: ${c}`);
    }
  });
});
