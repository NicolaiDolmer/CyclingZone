// Statiske guards for e2e-suitens egne fælder (#3554 + #3601).
//
// Begge fejl er af samme klasse: en rettelse så komplet ud fra den akse man
// kiggede fra, og hullet blev først synligt næste gang nogen betalte for det.
// #3636 samlede webkit-filtret ét sted — men kun for ÉN af to fejlkanaler, så
// `sponsor-ui` gik rød igen dagen efter. Og fem specs skrev til committede
// PNG-stier, hvilket ingen gate fangede, fordi resultatet er et beskidt
// arbejdstræ, ikke en rød test.
//
// Derfor disse to guards: de fejler på KILDEN, ikke på symptomet, og de kører
// i `npm test` (node --test) — sekunder, ikke minutter.
//
// Kører som ren tekst-analyse af spec-filerne. Det er bevidst: en dynamisk
// guard ville kræve at man kørte hele suiten for at opdage problemet, og det
// er præcis den omvej der lod begge fejl overleve.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));

const specFiles = fs
  .readdirSync(E2E_DIR)
  .filter((f) => f.endsWith(".spec.js"))
  .map((f) => ({ name: f, source: fs.readFileSync(path.join(E2E_DIR, f), "utf8") }));

test("der findes specs at kontrollere (guarden må ikke bestå tomt)", () => {
  assert.ok(specFiles.length > 20, `fandt kun ${specFiles.length} specs i ${E2E_DIR}`);
});

// ── #3601 · fejlopsamling skal gå gennem fixtures.js ────────────────────────
//
// En spec der selv hænger på `page.on("console")` eller `page.on("pageerror")`
// arver ikke WEBKIT_DEV_NOISE, og opdager det først når frontend-smoke går rød
// på en urelateret PR. Undtagelser skal være eksplicitte og begrundede.
const ERROR_CHANNEL = /page\.on\(\s*["'](console|pageerror)["']/;
const EXEMPT_MARKER = "e2e-error-collector-exempt:";

test("#3601 specs samler browser-fejl via fixtures.js (eller er eksplicit undtaget)", () => {
  const offenders = [];

  for (const { name, source } of specFiles) {
    const lines = source.split("\n");
    lines.forEach((line, i) => {
      if (!ERROR_CHANNEL.test(line)) return;
      // Undtagelsen skal stå på linjen selv eller i kommentarblokken lige over
      // den, så begrundelsen står ved siden af det den undtager. 10 linjers
      // vindue: en ordentlig begrundelse fylder mere end to linjer, og en
      // undtagelse uden begrundelse er præcis det denne guard findes for.
      const context = lines.slice(Math.max(0, i - 10), i + 1).join("\n");
      if (context.includes(EXEMPT_MARKER)) return;
      offenders.push(`${name}:${i + 1}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `Disse specs hænger direkte på en browser-fejlkanal i stedet for at bruge ` +
      `collectBrowserErrors/collectPageErrors fra fixtures.js:\n  ${offenders.join("\n  ")}\n\n` +
      `Brug helperen — den filtrerer webkit-dev-noise i BEGGE kanaler. Er en ` +
      `direkte lytter det rigtige (fx fordi specen filtrerer på noget helt ` +
      `andet), så skriv "// ${EXEMPT_MARKER} <grund>" over linjen.`,
  );
});

// ── #4248 · specs skal arve fejl-guarden fra e2e-base.js ───────────────────
//
// Fejlopsamlingen fandtes før (#3601/#3636), men var opt-in: målt 28/8 brugte
// 9 af 70 specs den. De 61 øvrige var blinde for enhver uncaught fejl så længe
// DOM'en renderede — og det gør den typisk, når fejlen sker i en useEffect.
// Det var sådan #4244 slap forbi 561 grønne tests og ramte 17 spillere.
//
// Guarden er nu en auto-fixture i e2e-base.js. Denne test sikrer at ingen ny
// spec kan falde udenom ved at importere `test` direkte fra @playwright/test.
const PLAYWRIGHT_TEST_IMPORT = /^\s*import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*["']@playwright\/test["']/m;

test("#4248 specs importerer test fra ./e2e-base.js, ikke fra @playwright/test", () => {
  const offenders = specFiles
    .filter(({ source }) => PLAYWRIGHT_TEST_IMPORT.test(source))
    .map(({ name }) => name);

  assert.deepEqual(
    offenders,
    [],
    `Disse specs importerer \`test\` direkte fra @playwright/test:\n  ${offenders.join("\n  ")}\n\n` +
      `Brug \`import { test, expect } from "./e2e-base.js";\` i stedet. Basen hænger ` +
      `automatisk fejlopsamling (pageerror + unhandled rejections) på hver test, så en ` +
      `uncaught fejl fælder testen i stedet for at gå ubemærket forbi.\n` +
      `Fremprovokerer specen bevidst en fejl, så undtag den SMALT i specen selv:\n` +
      `  test.use({ allowedPageErrors: [/…/] });`,
  );
});

// Guarden ovenfor er værdiløs hvis e2e-base.js ikke faktisk installerer
// opsamlingen. Denne kontrollerer kilden, så en fremtidig refaktor ikke kan
// tømme basen og efterlade 70 specs der importerer en tom skal.
test("#4248 e2e-base.js installerer fejl-guarden som auto-fixture", () => {
  const base = fs.readFileSync(path.join(E2E_DIR, "e2e-base.js"), "utf8");

  assert.match(base, /auto:\s*true/, "fejl-guarden i e2e-base.js skal være en auto-fixture");
  assert.match(base, /page\.on\(\s*["']pageerror["']/, "e2e-base.js skal lytte på pageerror");
  assert.match(base, /unhandledrejection/, "e2e-base.js skal fange unhandled promise rejections");
});

// ── #3554 · specs må ikke skrive til committede stier ───────────────────────
//
// Alt hvad `playwright test` skriver skal lande i test-results/ (gitignored)
// eller gå gennem evidenceShotPath(), som kun rammer den committede sti når
// CZ_WRITE_COMMITTED_SHOTS=1 er sat bevidst.
// Kun `path:` INDE i et screenshot-kald. `path:` alene ville også ramme
// route-tabellerne i core-smoke/seo-public-routes ({ path: "/dashboard" }).
const SCREENSHOT_PATH_ARG = /\.screenshot\(\s*\{[^}]*?\bpath:\s*(`[^`]*`|"[^"]*"|'[^']*')/g;
const STRING_CONST = /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*["'`]([^"'`]*)["'`]\s*;/gm;
const ALLOWED_OUTPUT = /^(test-results\/|playwright-report\/)/;

test("#3554 specs skriver screenshots til test-results/, ikke til committede stier", () => {
  const offenders = [];

  for (const { name, source } of specFiles) {
    // Stier bygges ofte som `${SHOT_DIR}/navn.png`. Slå simple string-consts op
    // i samme fil og indsæt dem, så guarden ser den FAKTISKE sti — ellers
    // ville den falsk-flage enhver spec der bruger en mappe-konstant.
    const consts = new Map();
    for (const c of source.matchAll(STRING_CONST)) consts.set(c[1], c[2]);

    for (const match of source.matchAll(SCREENSHOT_PATH_ARG)) {
      const literal = match[1].slice(1, -1);
      const resolved = literal.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (whole, ident) =>
        consts.has(ident) ? consts.get(ident) : whole,
      );
      // Normalisér windows-separatorer så guarden opfører sig ens på begge OS.
      const normalized = resolved.replace(/\\/g, "/");
      if (ALLOWED_OUTPUT.test(normalized)) continue;
      const line = source.slice(0, match.index).split("\n").length;
      offenders.push(`${name}:${line} → ${literal}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Disse specs skriver til en sti uden for test-results/:\n  ${offenders.join("\n  ")}\n\n` +
      `Committede PNG'er må kun skrives bevidst. Brug evidenceShotPath("<repo-relativ sti>") ` +
      `fra fixtures.js — den skriver til test-results/evidence/ som default og til den ` +
      `committede sti når CZ_WRITE_COMMITTED_SHOTS=1.`,
  );
});
