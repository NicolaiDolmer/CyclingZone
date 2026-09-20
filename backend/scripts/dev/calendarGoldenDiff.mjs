#!/usr/bin/env node
// backend/scripts/dev/calendarGoldenDiff.mjs
// ============================================================
// #4123 — den gyldne kalender-diff, kørt I HÅNDEN FØR en sæson genereres.
//
// HVAD DEN ER. CI's lib/calendarGoldenSnapshot.test.js svarer ja/nej: "matcher den
// offline kalender den committede gyldne fil?". Dette script svarer på det spørgsmål et
// menneske faktisk skal have svar på inden §2c's ENE regenerering:
//
//   · hvad ændrede sig, pr. division — løb, etaper, antal berørte dage
//   · hvad ændrede sig, pr. løbstype — endagsløb / etapeløb / Grand Tour
//   · hvilke dage ændrede form, og hvilke etaper kom til / faldt væk
//   · brød noget en HÅRD invariant (to GT'er samme dag, GT-loft, GT-spænd,
//     kronologi, tom kalenderdag) — jf. docs/CALENDAR_RULES.md §2/§3/§7
//
// KØRER 100 % OFFLINE. Kataloget er lib/__fixtures__/racePoolCatalog.prod.json (#4121),
// og planen bygges med præcis samme parametre som prod-dry-runnen via
// scripts/dev/lib/s3OfflineCalendarPlan.mjs. Ingen credentials, ingen DB, intet ur —
// den kan køres af hvem som helst, når som helst, uden risiko for at røre prod.
//
// BRUG (fra backend/):
//   node scripts/dev/calendarGoldenDiff.mjs                 # rapport + hård dom
//   node scripts/dev/calendarGoldenDiff.mjs --json          # maskinlæsbar
//   node scripts/dev/calendarGoldenDiff.mjs --fail-on-diff  # også exit 1 ved ren diff
//   node scripts/dev/calendarGoldenDiff.mjs --golden <fil>  # diff mod en anden snapshot
//   node scripts/dev/calendarGoldenDiff.mjs --candidate <fil>  # og/eller en anden kandidat
//
// EXIT-KODER. 1 = mindst én HÅRD invariant er brudt (eller --fail-on-diff og diffen er
// ikke tom). 0 = ingen hårde brud. En ren diff ALENE er ikke en fejl: den kan være en
// tilsigtet ændring der mangler en `refreshCalendarGoldenSnapshot.mjs`-kørsel. Det er
// netop dét skel scriptet findes for at gøre synligt — CI-gaten dømmer diffen, mennesket
// dømmer meningen.
//
// Refs #4123 #4121 #4571 #4270
// ============================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { buildCalendarGoldenSnapshot } from "./lib/calendarGoldenSnapshotBuilder.mjs";
import {
  detectHardInvariantBreaches, summarizeGoldenDiff, formatGoldenDiffReport,
} from "./lib/calendarGoldenDiffReport.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_GOLDEN_PATH = join(__dirname, "..", "..", "lib", "__fixtures__", "calendarGoldenSnapshot.s3.json");

/**
 * Kører hele diffen mod to snapshots. Ren i forhold til filsystemet — kalderen leverer
 * begge sider, så en test kan injicere en snapshot med en bevidst afvigelse.
 *
 * @param {{gylden: object, ny: object, failOnDiff?: boolean}} args
 * @returns {{diff: object, hårdeBrud: string[], exitCode: number, rapport: string}}
 */
export function runGoldenDiff({ gylden, ny, failOnDiff = false } = {}) {
  const diff = summarizeGoldenDiff(gylden, ny);
  const hårdeBrud = detectHardInvariantBreaches(ny);
  const exitCode = hårdeBrud.length > 0 || (failOnDiff && !diff.uændret) ? 1 : 0;
  return { diff, hårdeBrud, exitCode, rapport: formatGoldenDiffReport(diff, hårdeBrud) };
}

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

// Samme idiom som scripts/dev/calendarScorecard4218.mjs — resolve() på begge sider, så
// Windows-stier (backslashes, drev-bogstav) ikke giver en falsk negativ.
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const goldenPath = argOf("--golden") ?? DEFAULT_GOLDEN_PATH;
  const candidatePath = argOf("--candidate");
  const failOnDiff = process.argv.includes("--fail-on-diff");
  const asJson = process.argv.includes("--json");

  const gylden = JSON.parse(readFileSync(goldenPath, "utf8"));
  const ny = candidatePath ? JSON.parse(readFileSync(candidatePath, "utf8")) : buildCalendarGoldenSnapshot();

  const { diff, hårdeBrud, exitCode, rapport } = runGoldenDiff({ gylden, ny, failOnDiff });

  if (asJson) {
    console.log(JSON.stringify({ diff, hårdeBrud, exitCode }, null, 2));
  } else {
    console.log(rapport);
    console.log("");
    if (hårdeBrud.length > 0) {
      console.log("❌ HÅRDE INVARIANTER BRUDT — kalenderen må IKKE genereres på denne kode.");
    } else if (!diff.uændret) {
      console.log("⚠ Kalenderen er ÆNDRET mod den gyldne snapshot.");
      console.log("  Tilsigtet? Kør `node scripts/dev/refreshCalendarGoldenSnapshot.mjs` og commit i SAMME PR.");
      console.log("  Ikke tilsigtet? Det er en regression i pakkeren/generatoren — ret koden.");
    } else {
      console.log("✅ Kalenderen er identisk med den gyldne snapshot, og ingen hård invariant er brudt.");
    }
  }

  process.exit(exitCode);
}
