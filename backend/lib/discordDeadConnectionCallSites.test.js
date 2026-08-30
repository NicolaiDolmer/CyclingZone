// Forward-guard #3483: ingen kaldested må hardkode ÉN permanent modtager-reason.
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
// Listen over reasons der tæller bor nu ÉT sted:
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

// `reason === "..."` / `reason !== "..."` med en af de permanente modtager-grene.
const HARDCODED_REASON_COMPARE = /reason\s*[!=]==\s*["'](recipient-blocked|bad-request)["']/;

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) out.push(full);
  }
  return out;
}

test("ingen backend-fil sammenligner en DM-reason med en hardkodet modtager-streng (#3483)", () => {
  const files = [...listJsFiles(join(ROOT, "lib")), ...listJsFiles(join(ROOT, "routes"))].filter(
    (f) => !f.endsWith(DEFINITION_FILE)
  );
  const offenders = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (HARDCODED_REASON_COMPARE.test(line)) {
        offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "Brug isPermanentRecipientFailure(reason) fra discordDmDelivery.js i stedet for at " +
      "sammenligne med en enkelt reason-streng, ellers falder den anden permanente " +
      `modtager-gren ud af auto-afkoblingen igen (#3483):\n${offenders.join("\n")}`
  );
});
