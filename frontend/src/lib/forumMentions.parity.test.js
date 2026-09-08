// #5011 forward-guard: parser-blokken i frontend/src/lib/forumMentions.js SKAL
// være tegn-for-tegn identisk med backend/lib/forumMentions.js.
//
// Hvorfor en kopi overhovedet: serveren afgør hvem der får en notifikation
// (klienten må aldrig kunne bestemme det), mens klienten skal rendre præcis de
// samme navne klikbare og foreslå dem i editoren. Driver de to fra hinanden,
// får man den værste af alle tilstande: et navn står ulinket i teksten mens
// modtageren fik en besked — eller et navn ser klikbart ud uden at nogen blev
// taget. Fejlen ville være tavs i prod og først dukke op som "hvorfor fik jeg
// ikke besked?".
//
// Kilde-tekst-guard (samme mønster som NotificationsPage.typeConfigParity.test.ts):
// den sammenligner filernes tekst i stedet for at importere begge moduler, så
// den også fanger en kommentar der kun blev rettet ét sted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

const SHARED_BLOCK_RE =
  /\/\/ >>> SHARED MENTION PARSER \(#5011\)[\s\S]*?\/\/ <<< SHARED MENTION PARSER \(#5011\)/;

function sharedBlock(relativePath) {
  const source = readFileSync(join(repoRoot, relativePath), "utf8");
  const match = source.match(SHARED_BLOCK_RE);
  assert.ok(match, `${relativePath}: SHARED MENTION PARSER-markørerne skal stå uændret`);
  return match[0];
}

test("#5011 @-tag-parseren er identisk i backend og frontend", () => {
  const backend = sharedBlock("backend/lib/forumMentions.js");
  const frontend = sharedBlock("frontend/src/lib/forumMentions.js");
  assert.equal(
    frontend,
    backend,
    "Parseren er drevet fra hinanden. Ret backend/lib/forumMentions.js og kør: node scripts/sync-forum-mentions-parser.mjs",
  );
});
