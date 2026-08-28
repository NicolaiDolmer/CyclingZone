// Delt Playwright-base for hele e2e-suiten (#4248).
//
// ── Hvorfor denne fil findes ────────────────────────────────────────────────
//
// PR #4238 gik grøn gennem 7.149 backend-tests, 2.342 frontend-tests, 561 e2e
// på tværs af alle tre projekter, lint og 24 CI-checks — og indeholdt en
// TypeError der kastede ved HVER mount af appen for hver spiller (#4244,
// Sentry CYCLINGZONE-4X, 17 spillere på under en time).
//
// Værktøjet til at fange den fandtes allerede: `collectBrowserErrors` i
// fixtures.js (#3601/#3636). Men det var **opt-in**, og målt 28/8 brugte kun
// 9 af 70 specs det. De øvrige 61 var blinde for enhver uncaught fejl, så
// længe DOM'en stadig renderede — og det gør den typisk, når fejlen sker i en
// useEffect frem for i render.
//
// Et værktøj ingen bruger er værre end intet værktøj: det ser ud som dækning.
// Derfor er opsamlingen nu en AUTO-FIXTURE. En spec skal ikke huske noget;
// den skal importere `test` herfra, og så er guarden på.
//
// `guards.test.js` (#4248) fejler hvis en spec importerer `test` direkte fra
// @playwright/test udenom denne fil — samme forward-guard-princip som #3601:
// fejl på KILDEN, ikke på symptomet.
//
// ── Hvad guarden dækker, og hvad den bevidst IKKE dækker ────────────────────
//
// DÆKKER:
//   · uncaught exceptions (`pageerror`)
//   · unhandled promise rejections — netop #4244's fejlklasse var en afvist
//     promise i en effekt, og den er ikke garanteret at nå `pageerror` i alle
//     tre browsere. Derfor en eksplicit `unhandledrejection`-lytter via
//     addInitScript, som virker ens i chromium og webkit.
//
// DÆKKER IKKE (bevidst):
//   · `console.error`. Issuet anbefaler selv at starte med `pageerror` alene:
//     det er unhandled exceptions og har den laveste falsk-positiv-rate.
//     `collectBrowserErrors` kan stadig kaldes direkte af de specs der VIL
//     assertere på konsollen (core-smoke og board-interactive gør det), men
//     konsol-støj fælder ikke hele suiten. Egen etape, egen PR.
//
// ── Undtagelser ────────────────────────────────────────────────────────────
//
// En spec der bevidst fremprovokerer en fejl-sti skriver:
//
//   test.use({ allowedPageErrors: [/Failed to fetch/i] });
//
// Mønstrene er per-fil eller per-describe, og de skal være SMALLE. En tom
// allowlist er default, og `[/./]` ville slukke guarden — hvilket guards.test.js
// også fanger.

import { test as base, expect } from "@playwright/test";
import { WEBKIT_DEV_NOISE } from "./fixtures.js";

// Navnet på den binding init-scriptet kalder. Prefikset gør en kollision med
// app-kode usandsynlig, og guards.test.js behøver ikke kende det.
const REJECTION_BINDING = "__czReportUnhandledRejection";

/**
 * Serialisér en rejection-årsag til noget læsbart i en fejlbesked.
 * Kører i browseren, så den må ikke afhænge af noget fra Node.
 */
function serializeRejection(reason) {
  if (reason instanceof Error) {
    return `${reason.name}: ${reason.message}`;
  }
  if (typeof reason === "object" && reason !== null) {
    try {
      return JSON.stringify(reason);
    } catch {
      return Object.prototype.toString.call(reason);
    }
  }
  return String(reason);
}

export const test = base.extend({
  /**
   * Spec-specifik allowlist. Tom som default — en spec skal aktivt og smalt
   * undtage det den bevidst fremprovokerer.
   * @type {RegExp[]}
   */
  allowedPageErrors: [[], { option: true }],

  /**
   * Auto-fixture: hænger fejlopsamlingen på FØR specen kører, og fælder testen
   * bagefter hvis der faldt noget ud. Specen skal ikke gøre eller huske noget.
   *
   * Rapporterende tilstand: sæt CZ_E2E_ERROR_GUARD=report for at få fundene
   * printet uden at fejle. Brugt til at kortlægge eksisterende støj ved
   * indførelsen; ikke tiltænkt CI.
   */
  czPageErrorGuard: [
    async ({ page, allowedPageErrors }, use, testInfo) => {
      const isWebkit = testInfo.project.name.includes("webkit");
      const reportOnly = process.env.CZ_E2E_ERROR_GUARD === "report";

      const found = [];
      // Chromium rapporterer en afvist promise ad BEGGE kanaler: vores
      // unhandledrejection-lytter og `pageerror`. Webkit gør det ikke altid.
      // Uden dedup ville samme fejl tælles to gange og fejlbeskeden lyve om
      // omfanget. Nøglen er beskeden uden "Name: "-præfiks, som er den eneste
      // forskel mellem de to formuleringer.
      const seen = new Set();
      const dedupeKey = (text) => text.replace(/^[A-Za-z]*Error:\s*/, "").trim();

      const record = (kind, text) => {
        const key = dedupeKey(text);
        if (seen.has(key)) return;
        seen.add(key);
        found.push(`${kind} · ${text}`);
      };

      const isIgnored = (text) => {
        // WebKit's dev-noise er allerede kortlagt i fixtures.js og gælder kun
        // webkit — genbrugt her frem for gen-defineret, så de to steder ikke
        // kan drive fra hinanden (postmortem 2026-08-11: ret ALLE kopier).
        if (isWebkit && WEBKIT_DEV_NOISE.some((p) => p.test(text))) return true;
        return allowedPageErrors.some((p) => p.test(text));
      };

      page.on("pageerror", (error) => {
        const text = error.message;
        if (isIgnored(text)) return;
        record("pageerror", text);
      });

      // Unhandled rejections når ikke pålideligt `pageerror` i alle tre
      // projekter, og #4244 var netop en afvist promise i en effekt. Bindingen
      // + init-scriptet installeres før første navigation, så også fejl under
      // den allerførste mount fanges.
      await page.exposeBinding(REJECTION_BINDING, (_source, message) => {
        if (typeof message !== "string" || isIgnored(message)) return;
        record("unhandledrejection", message);
      });

      await page.addInitScript(
        ({ bindingName, serializerSource }) => {
          const serialize = new Function(`return (${serializerSource})`)();
          window.addEventListener("unhandledrejection", (event) => {
            try {
              window[bindingName]?.(serialize(event.reason));
            } catch {
              // Bindingen kan være væk hvis siden lukkes midt i en rejection.
              // At tabe den ene besked er bedre end at kaste inde i handleren.
            }
          });
        },
        { bindingName: REJECTION_BINDING, serializerSource: serializeRejection.toString() },
      );

      await use();

      if (found.length === 0) return;

      const detail = found.map((f) => `  · ${f}`).join("\n");
      if (reportOnly) {
        console.log(
          `[czPageErrorGuard/report] ${testInfo.titlePath.join(" › ")}\n${detail}`,
        );
        return;
      }

      throw new Error(
        `Appen kastede ${found.length} ubehandlet fejl under denne test:\n${detail}\n\n` +
          `En uncaught fejl er en fejl, også når DOM'en stadig renderer — det var ` +
          `præcis sådan #4244 slap forbi 561 grønne tests og ramte 17 spillere.\n` +
          `Er fejlen bevidst fremprovokeret af specen, så undtag den SMALT:\n` +
          `  test.use({ allowedPageErrors: [/…/] });`,
      );
    },
    { auto: true },
  ],
});

export { expect };
