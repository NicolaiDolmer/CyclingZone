// Mekanik-tests for statColor.
//
// #3666: de gamle tests asserterede rytter-rampens ANKER-HEX direkte. Rampen er
// nu tema-bevidst og valgt ud fra målte tilgængeligheds-krav, så hardkodede hex
// ville låse den mod en æstetik i stedet for mod en egenskab — og det var
// præcis dét der gjorde farverne til en tilbagevendende diskussion.
//
// Ansvaret er derfor delt:
//   · statColor.contract.test.js ejer EGENSKABERNE (monoton lyshed,
//     blæk-kontrast, farveblind-adskillelse). Den er vagten.
//   · denne fil ejer MEKANIKKEN (interpolation, clamping, ugyldigt input,
//     scale-opslag) — den slags der skal virke uanset hvilke farver vi vælger.
//
// Staff-skalaerne testes fortsat på deres eksakte hex: de er IKKE lagt om, og
// en utilsigtet ændring af dem skal fanges (ejer-krav i spec §D4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { statColor, statTextColor, statStyle, statPlateStyle, contrastRatio } from "./statColor.js";

// Sætter/fjerner data-theme som lib/theme.jsx gør.
function withTheme(theme, fn) {
  const had = typeof globalThis.document !== "undefined";
  const prev = had ? globalThis.document : undefined;
  globalThis.document = {
    documentElement: { getAttribute: (k) => (k === "data-theme" ? (theme === "dark" ? "dark" : null) : null) },
  };
  try { return fn(); } finally {
    if (had) globalThis.document = prev; else delete globalThis.document;
  }
}
const isHex = (s) => /^#[0-9a-f]{6}$/.test(s);

test("statColor — rytter-rampen er tema-bevidst", () => {
  const lys = withTheme("light", () => statColor(44, { scale: "rating" }));
  const moerk = withTheme("dark", () => statColor(44, { scale: "rating" }));
  assert.ok(isHex(lys) && isHex(moerk));
  assert.notEqual(lys, moerk, "samme tal skal have sin egen farve pr. tema — ellers kan den ene ikke læses");
});

test("statColor — rating og ability er samme rampe (de deler enhed efter #3666)", () => {
  withTheme("dark", () => {
    for (const v of [0, 13, 44, 85, 99]) {
      assert.equal(statColor(v, { scale: "rating" }), statColor(v, { scale: "ability" }));
    }
  });
});

test("statColor — staff-skalaerne er urørte og tema-uafhængige", () => {
  for (const theme of ["light", "dark"]) {
    withTheme(theme, () => {
      assert.equal(statColor(70, { scale: "staffAbility" }), "#33fc96");
      assert.equal(statColor(85, { scale: "staffAbility" }), "#fde447");
      assert.equal(statColor(60, { scale: "staffRating" }), "#33fc96");
      assert.equal(statColor(65, { scale: "staffRating" }), "#fde447");
    });
  }
});

test("statColor — ukendt scale falder tilbage til rytter-rampen", () => {
  withTheme("light", () => {
    assert.equal(statColor(50, { scale: "findes-ikke" }), statColor(50, { scale: "ability" }));
  });
});

test("statColor — klamper uden for 0-99", () => {
  withTheme("light", () => {
    assert.equal(statColor(-40), statColor(0));
    assert.equal(statColor(250), statColor(99));
  });
});

test("statColor — ugyldigt input falder til floor-farven", () => {
  withTheme("light", () => {
    const floor = statColor(0);
    for (const bad of [null, undefined, NaN, "abc", {}]) assert.equal(statColor(bad), floor);
  });
});

test("statColor — accepterer numerisk streng", () => {
  withTheme("light", () => assert.equal(statColor("44"), statColor(44)));
});

test("statColor — interpolerer mellem knæk i stedet for at hoppe", () => {
  withTheme("dark", () => {
    const a = statColor(60, { scale: "rating" });
    const mid = statColor(67, { scale: "rating" });
    const b = statColor(75, { scale: "rating" });
    assert.ok(isHex(mid));
    assert.notEqual(mid, a);
    assert.notEqual(mid, b);
  });
});

test("statTextColor — vælger det blæk der giver mest kontrast", () => {
  // #3666: valget skete før ved en fast luma-tærskel, som ramte forbi omkring
  // mellemtonerne (2,88:1 ved rating 49). Nu måles begge og det bedste vinder.
  for (const theme of ["light", "dark"]) {
    withTheme(theme, () => {
      for (let v = 0; v <= 99; v += 7) {
        const bg = statColor(v, { scale: "rating" });
        const ink = statTextColor(v, { scale: "rating" });
        const anden = ink === "#101014" ? "#f5f5fa" : "#101014";
        assert.ok(contrastRatio(ink, bg) >= contrastRatio(anden, bg),
          `rating ${v}: valgte det dårligste blæk`);
      }
    });
  }
});

test("statStyle — farvet baggrund + kontrast-tekst", () => {
  withTheme("dark", () => {
    const s = statStyle(44);
    assert.equal(s.backgroundColor, statColor(44));
    assert.equal(s.color, statTextColor(44));
  });
});

test("statPlateStyle — fyldt badge med hårfin ramme, ikke farvet tal", () => {
  // Ejer-beslutning 14/8 efter test med en farveblind spiller: farven er badgens
  // FYLD, og formen bæres af rammen, så fyldet må være stille i bunden.
  withTheme("dark", () => {
    const p = statPlateStyle(44);
    assert.equal(p.backgroundColor, statColor(44, { scale: "rating" }));
    assert.equal(p.color, statTextColor(44, { scale: "rating" }));
    assert.ok(/^1px solid /.test(p.border), "badgen skal have en hårfin ramme");
  });
});

test("statPlateStyle — rammen vender med temaet", () => {
  const lys = withTheme("light", () => statPlateStyle(44).border);
  const moerk = withTheme("dark", () => statPlateStyle(44).border);
  assert.notEqual(lys, moerk, "mørk kant på lyst tema, lys kant på mørkt");
});

test("statPlateStyle — staff-skalaen kan stadig bruges eksplicit", () => {
  withTheme("dark", () => {
    const p = statPlateStyle(60, { scale: "staffRating" });
    assert.equal(p.backgroundColor, "#33fc96");
  });
});
