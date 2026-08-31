// Forward-guard #3483: ingen kaldested må hardkode ÉN permanent DM-fejl-reason.
//
// Rod-årsagen til #3483 var ikke en fejl i dead-connection-tælleren (#3130), men
// at begge kaldesteder sammenlignede med strengen "recipient-blocked" direkte:
//   discordNotifier.js  — if (result.failure?.reason === "recipient-blocked")
//   discordDmOutbox.js  — if (result.failure?.reason === "recipient-blocked")
// Da classifyDmFailure fik en anden permanent modtager-gren (400/404 →
// "bad-request", Discord-kode 50033), fulgte kaldestederne ikke med. En ramt
// spiller stod som "Discord tilsluttet" i 23 dage med tælleren på 0 og mistede
// undervejs en board_critical-besked i tavshed.
//
// Reviewet af PR #4460 fandt at fejlklassen har en SPEJLVENDT halvdel, og den er
// farligere: discordNotifier.js hardkodede `reason === "token-invalid"` som
// "vores egen fejl". Da 'payload-rejected' (400 fra postDm, kode 50035) kom til,
// ville den have ramt else-grenen og talt som modtager-fejl — og da en payload-
// fejl rammer ALLE modtagere samtidig, ville tre notifikationer have nulstillet
// discord_id for hver eneste tilknyttede spiller. Derfor dækker guarden nu begge
// halvdele: både modtager-reasons og 'token-invalid'.
//
// Listen over reasons der tæller bor ÉT sted:
// PERMANENT_RECIPIENT_FAILURE_REASONS i discordDmDelivery.js, læst via
// isPermanentRecipientFailure(). Denne test scanner kildekoden statisk og fejler
// hvis et kaldested igen sammenligner en reason med en enkelt hardkodet streng.
// Grov tekstlig proxy, men den fanger PRÆCIS #3483-mønstret før merge.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // backend/

// Definitionsfilen selv MÅ nævne de enkelte reasons — den er kilden.
const DEFINITION_FILE = "discordDmDelivery.js";

// Mapper der kan indeholde kaldesteder. Review-fund: den gamle guard scannede
// kun lib/ og routes/, så en kopi af mønstret i cron.js, jobs/ eller scripts/
// ville være sluppet igennem. Vi scanner nu hele backend/ pånær build- og
// afhængighedsmapper.
const SKIPPED_DIRS = new Set(["node_modules", "coverage", "dist", "build"]);

// `reason === "..."` i BEGGE retninger, og med \s der også matcher linjeskift —
// den gamle regex kørte linje-for-linje og missede den flerlinjede form som
// prettier laver af en lang betingelse:
//   if (
//     result.failure?.reason ===
//     "recipient-blocked"
//   )
const GUARDED_REASONS = "recipient-blocked|bad-request|token-invalid";
const HARDCODED_REASON_COMPARE = new RegExp(
  `(?:reason\\s*[!=]==\\s*["'](?:${GUARDED_REASONS})["']` +
    `|["'](?:${GUARDED_REASONS})["']\\s*[!=]==\\s*[\\w.?\\[\\]"']*reason)`,
  "g"
);

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) out.push(full);
  }
  return out;
}

/** 0-indekseret streng-offset → 1-indekseret linjenummer. */
function lineOf(content, index) {
  return content.slice(0, index).split("\n").length;
}

function findOffenders(content, label) {
  const offenders = [];
  for (const match of content.matchAll(HARDCODED_REASON_COMPARE)) {
    offenders.push(`${label}:${lineOf(content, match.index)}: ${match[0].replace(/\s+/g, " ")}`);
  }
  return offenders;
}

test("ingen backend-fil sammenligner en DM-reason med en hardkodet streng (#3483)", () => {
  const files = listJsFiles(ROOT).filter((f) => !f.endsWith(DEFINITION_FILE));
  const offenders = [];
  for (const file of files) {
    offenders.push(...findOffenders(readFileSync(file, "utf8"), file.slice(ROOT.length + 1)));
  }
  assert.deepEqual(
    offenders,
    [],
    "Brug isPermanentRecipientFailure(reason) fra discordDmDelivery.js i stedet for at " +
      "sammenligne med en enkelt reason-streng, ellers falder en permanent fejl-gren ud af " +
      `(eller ind i) auto-afkoblingen igen (#3483):\n${offenders.join("\n")}`
  );
});

test("guarden fanger både enlinjet, flerlinjet og omvendt sammenligning (#3483)", () => {
  // Selvtest: uden den ville en for snæver regex se ud som en grøn guard.
  const enlinjet = 'if (result.failure?.reason === "recipient-blocked") {';
  const flerlinjet = 'if (\n  result.failure?.reason ===\n  "bad-request"\n) {';
  const omvendt = 'if ("token-invalid" !== failure.reason) {';
  const uskyldig = 'if (isPermanentRecipientFailure(result.failure?.reason)) {';

  assert.equal(findOffenders(enlinjet, "x.js").length, 1);
  assert.equal(findOffenders(flerlinjet, "x.js").length, 1);
  assert.equal(findOffenders(omvendt, "x.js").length, 1);
  assert.deepEqual(findOffenders(uskyldig, "x.js"), []);
});

test("guarden scanner mere end lib/ og routes/ (#3483, review af PR #4460)", () => {
  const files = listJsFiles(ROOT).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"));
  // cron.js ligger i backend-roden og var uden for den gamle scanning.
  assert.ok(
    files.includes("cron.js"),
    `Forventede at guarden scannede backend/cron.js — fandt ${files.length} filer`
  );
  assert.ok(files.some((f) => f.startsWith("lib/")), "lib/ skal stadig scannes");
  assert.ok(files.some((f) => f.startsWith("routes/")), "routes/ skal stadig scannes");
});
