// DOMMER #6110, regel R11: DAGLIG VARIATION, CA. 50-150 % PR. DAG, INGEN SAESON-PERIODER.
// Kilde: ejer 12/11 (kort 2), ordret: "Jeg synes det skal svinge dagligt i stedet for
// paa saesonbasis. Det er forfaerdeligt design, hvis en rytter har en hel saeson, hvor de
// traener elendigt. Men det er rigtigt godt design, hvis den enkelte dag og session kan
// variere." Stoerrelse: ca. 50-150 % pr. dag. Afloeser valget 7/11 om hukommelse.

import test from "node:test";
import assert from "node:assert/strict";

import { applyDailyTick } from "./dailyTraining.js";
import {
  kraev, xpParams, xpParamsMedVariation, SPRINTER, NORMAL_SPURT,
} from "./dommer6110.fixtures.mjs";

const dato = (n) => new Date(Date.UTC(2026, 10, 15) + n * 86_400_000).toISOString().slice(0, 10);

async function faktorer(antalRyttere, antalDatoer) {
  const { developmentXpDayVariation } = await kraev("./developmentXpVariation.ts", "developmentXpDayVariation");
  const params = await xpParamsMedVariation();
  const ud = [];
  for (let r = 0; r < antalRyttere; r++) {
    const raekke = [];
    for (let d = 0; d < antalDatoer; d++) {
      raekke.push(developmentXpDayVariation({ riderId: `dommer-rytter-${r}`, dateStr: dato(d) }, params.variation));
    }
    ud.push(raekke);
  }
  return ud;
}

const snit = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

test("R11 variation: hver dag ligger mellem 50 og 150 %, og hele spaendet bruges", async () => {
  const alle = (await faktorer(400, 60)).flat();
  assert.ok(alle.every((f) => f >= 0.5 && f <= 1.5), "ingen dag under 50 % eller over 150 %");
  assert.ok(Math.min(...alle) < 0.6, "der findes tunge dage naer 50 %");
  assert.ok(Math.max(...alle) > 1.4, "der findes gode dage naer 150 %");
  assert.ok(alle.filter((f) => f < 0.75).length > alle.length * 0.15, "tunge dage er almindelige, ikke sjaeldne");
  assert.ok(alle.filter((f) => f > 1.25).length > alle.length * 0.15, "gode dage er almindelige, ikke sjaeldne");
  assert.ok(Math.abs(snit(alle) - 1) < 0.01, `snittet skal vaere 100 % (var ${snit(alle).toFixed(4)})`);
});

test("R11 variation: ingen hukommelse, saa i gaar siger intet om i dag", async () => {
  const raekker = await faktorer(400, 60);
  let sumXY = 0; let sumXX = 0; let n = 0;
  for (const raekke of raekker) {
    for (let d = 1; d < raekke.length; d++) {
      sumXY += (raekke[d] - 1) * (raekke[d - 1] - 1);
      sumXX += (raekke[d - 1] - 1) ** 2;
      n += 1;
    }
  }
  const sammenhaeng = sumXY / sumXX;
  assert.ok(n > 20000);
  assert.ok(Math.abs(sammenhaeng) < 0.03, `dag til dag-sammenhaeng skal vaere nul (var ${sammenhaeng.toFixed(4)})`);
});

test("R11 variation: ingen rytter har en hel saeson, hvor han traener elendigt (eller fantastisk)", async () => {
  const saesoner = (await faktorer(400, 160)).map(snit);
  assert.ok(Math.min(...saesoner) > 0.88, `daarligste saeson-snit ${Math.min(...saesoner).toFixed(3)}`);
  assert.ok(Math.max(...saesoner) < 1.12, `bedste saeson-snit ${Math.max(...saesoner).toFixed(3)}`);
  // Og heller ingen maaned: 30 datoer i traek ligger taet paa 100 %.
  const maaneder = (await faktorer(400, 30)).map(snit);
  assert.ok(Math.min(...maaneder) > 0.72 && Math.max(...maaneder) < 1.28);
});

test("R11 variation: gennem motoren svinger dagens XP 50-150 %, ens for alle evner samme dag, og en dato kan regnes om", async () => {
  const uden = await xpParams();
  const med = await xpParamsMedVariation();
  const tick = (params, dateStr) => applyDailyTick({
    ...SPRINTER, dateStr, caps: {}, progress: {}, conditionMult: 1, program: NORMAL_SPURT, developmentXp: params,
  }).xp;
  const forhold = [];
  for (let d = 0; d < 40; d++) {
    const a = tick(uden, dato(d));
    const b = tick(med, dato(d));
    const dagens = Object.keys(a).map((evne) => b[evne] / a[evne]);
    for (const f of dagens) assert.ok(Math.abs(f - dagens[0]) < 1e-9, "samme dag, samme udsving i alle evner");
    assert.ok(dagens[0] >= 0.5 && dagens[0] <= 1.5, `${dato(d)}: ${dagens[0]}`);
    assert.deepEqual(tick(med, dato(d)), b, "samme rytter og dato giver samme tal igen");
    forhold.push(dagens[0]);
  }
  assert.ok(Math.max(...forhold) - Math.min(...forhold) > 0.5, "dagene er tydeligt forskellige");
  assert.ok(new Set(forhold.map((f) => f.toFixed(6))).size >= 35, "naesten hver dag er sin egen");
});

test("R11 variation: to ryttere har ikke samme gode og daarlige dage", async () => {
  const [a, b] = await faktorer(2, 60);
  assert.ok(a.filter((f, i) => Math.abs(f - b[i]) > 0.05).length > 40);
});
