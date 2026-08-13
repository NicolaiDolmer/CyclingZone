// KONTRAKT-VAGT for rytter-rampen (#3666).
//
// ═══ HVORFOR DENNE FIL FINDES ═══
// Ejer-mandat: "Vi har ændret rating farver for tit i dette spil og det er for
// uoptimalt." Årsagen var ikke sjusk — den var at der aldrig fandtes en
// definition af "godt nok" som en ændring kunne fejle imod. Ankrene var
// percentiler i en befolkning der flyttede sig, så de SKULLE re-fittes, og hver
// re-fit var en ny diskussion uden facit.
//
// Denne test er facitlisten. Den måler præcis de tre egenskaber der gør en
// talskala læsbar for alle, og den fejler bygningen hvis en fremtidig ændring
// bryder dem. Efter den kan farverne godt ændres — men kun til noget der holder.
//
// ═══ DE TRE KRAV ═══
// 1. MONOTON LYSHED. Højere rating skal ALTID være lysere (mørkt tema) eller
//    altid mørkere (lyst tema). Det er dét ene krav der gør at rækkefølgen
//    overlever alle former for farveblindhed OG gråtone — hvis lysheden vender
//    om på midten, læses skalaens to yderpunkter ens. Den gamle skala gjorde
//    præcis det: rating 95 var mørkere end rating 5.
// 2. TALLET SKAL KUNNE LÆSES. Blækket mod badgens fyld skal mindst nå 3:1.
// 3. TRINNENE SKAL KUNNE SKELNES af en farveblind spiller — målt som farve-
//    afstand mellem to ratings der ligger 10 point fra hinanden, simuleret
//    gennem deuteranopi, protanopi og tritanopi.
//
// Bemærk hvad der IKKE gates: badgens fyld mod sidens flade. Det er bevidst.
// Fyldet er stille i bunden, så en lav rating ikke råber, og badgens form bæres
// i stedet af den hårfine ramme i statPlateStyle. At gate fyldet ville tvinge
// bunden op og koste en tredjedel af adskillelsen i krav 3 — det blev målt, og
// ejeren valgte rammen 14/8.
import { test } from "node:test";
import assert from "node:assert/strict";
import { statColor, statTextColor, contrastRatio } from "./statColor.js";

const THEMES = ["light", "dark"];
const MIN_INK_CONTRAST = 3.0;   // WCAG stor tekst
const MIN_STEP_SEPARATION = 3.0; // ΔE (OKLab ×100) for et 10-points spring
const MIN_ENDS_SEPARATION = 25;  // ΔE mellem rating 5 og 90

// Sætter/fjerner data-theme som lib/theme.jsx gør, så vi måler den rampe
// visningen faktisk ville bruge — ikke en kopi af den.
function withTheme(theme, fn) {
  const had = typeof globalThis.document !== "undefined";
  const prev = had ? globalThis.document : undefined;
  const attr = theme === "dark" ? "dark" : null;
  globalThis.document = {
    documentElement: { getAttribute: (k) => (k === "data-theme" ? attr : null) },
  };
  try { return fn(); } finally {
    if (had) globalThis.document = prev; else delete globalThis.document;
  }
}

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toLinear = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };

function oklab(hex) {
  const [r, g, b] = hex2rgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
// Brettel/Viénot-projektion for de tre dikromat-typer.
const M_LMS = [[0.31399022, 0.63951294, 0.04649755], [0.15537241, 0.75789446, 0.08670142], [0.01775239, 0.10944209, 0.87256922]];
const M_INV = [[5.47221206, -4.6419601, 0.16963708], [-1.1252419, 2.29317094, -0.1678952], [0.02980165, -0.19318073, 1.16364789]];
const SIM = {
  protan: [[0, 1.05118294, -0.05116099], [0, 1, 0], [0, 0, 1]],
  deutan: [[1, 0, 0], [0.9513092, 0, 0.04866992], [0, 0, 1]],
  tritan: [[1, 0, 0], [0, 1, 0], [-0.86744736, 1.86727089, 0]],
};
const mul = (M, v) => M.map((row) => row.reduce((acc, k, i) => acc + k * v[i], 0));
function simulate(hex, kind) {
  const lin = hex2rgb(hex).map(toLinear);
  const out = mul(M_INV, mul(SIM[kind], mul(M_LMS, lin)));
  return "#" + out.map((c) => {
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, "0");
  }).join("");
}
const deltaE = (a, b) => {
  const x = oklab(a), y = oklab(b);
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
const cvdMin = (a, b) => Math.min(...Object.keys(SIM).map((k) => deltaE(simulate(a, k), simulate(b, k))));

for (const theme of THEMES) {
  test(`rytter-rampen (${theme}): lysheden er monoton`, () => {
    withTheme(theme, () => {
      let prev = null, dir = 0;
      for (let v = 0; v <= 99; v++) {
        const L = oklab(statColor(v, { scale: "rating" }))[0];
        if (prev !== null) {
          const step = Math.sign(L - prev);
          if (step !== 0) {
            if (dir === 0) dir = step;
            else assert.equal(step, dir,
              `lysheden vender om ved rating ${v}. Hele rækkefølgen hviler på at den `
              + "ikke gør det — ellers læses skalaens to ender ens i gråtone og for en "
              + "farveblind spiller. Det var netop den gamle skalas hovedfejl.");
          }
        }
        prev = L;
      }
      assert.notEqual(dir, 0, "rampen er helt flad i lyshed");
    });
  });

  test(`rytter-rampen (${theme}): tallet kan læses på sin badge`, () => {
    withTheme(theme, () => {
      for (let v = 0; v <= 99; v++) {
        const fill = statColor(v, { scale: "rating" });
        const ink = statTextColor(v, { scale: "rating" });
        const c = contrastRatio(ink, fill);
        assert.ok(c >= MIN_INK_CONTRAST,
          `rating ${v}: tallet står i ${c.toFixed(2)}:1 mod sit fyld (krav ${MIN_INK_CONTRAST}:1). `
          + `Fyld ${fill}, blæk ${ink}.`);
      }
    });
  });

  test(`rytter-rampen (${theme}): trinnene kan skelnes af en farveblind spiller`, () => {
    withTheme(theme, () => {
      for (let v = 0; v <= 89; v += 5) {
        const d = cvdMin(statColor(v, { scale: "rating" }), statColor(v + 10, { scale: "rating" }));
        assert.ok(d >= MIN_STEP_SEPARATION,
          `rating ${v} og ${v + 10} ligger kun ΔE ${d.toFixed(1)} fra hinanden under farveblindhed `
          + `(krav ${MIN_STEP_SEPARATION}). To ryttere med 10 points forskel skal kunne skelnes.`);
      }
      const ends = cvdMin(statColor(5, { scale: "rating" }), statColor(90, { scale: "rating" }));
      assert.ok(ends >= MIN_ENDS_SEPARATION,
        `skalaens ender ligger kun ΔE ${ends.toFixed(1)} fra hinanden under farveblindhed `
        + `(krav ${MIN_ENDS_SEPARATION}). Den gamle skala lå på 11,3 — en svag og en elite-rytter `
        + "så næsten ens ud.");
    });
  });
}

test("rating og evne deler rampe — samme tal, samme farve", () => {
  withTheme("dark", () => {
    for (const v of [0, 9, 13, 24, 44, 60, 85, 99]) {
      assert.equal(statColor(v, { scale: "rating" }), statColor(v, { scale: "ability" }),
        `rating og evne farver ${v} forskelligt. De deler enhed efter #3666 og skal dele farve — `
        + "ellers betyder det samme tal to ting afhængigt af hvilken celle man kigger i.");
    }
  });
});

test("staff-skalaerne er urørt af rytter-omlægningen", () => {
  // Ejer-krav i spec §D4. Staff er en anden population og har egne ankre.
  withTheme("light", () => {
    assert.equal(statColor(60, { scale: "staffRating" }), "#33fc96");
    assert.equal(statColor(70, { scale: "staffAbility" }), "#33fc96");
  });
  withTheme("dark", () => {
    assert.equal(statColor(60, { scale: "staffRating" }), "#33fc96",
      "staff-skalaen må ikke være blevet tema-afhængig");
  });
});
