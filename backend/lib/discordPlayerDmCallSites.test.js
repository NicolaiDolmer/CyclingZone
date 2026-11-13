// Forward-guard #8149: ingen privat Discord-besked uden om hovedafbryderen.
//
// discord_player_dm (discordPlayerDmSwitch.js) kan kun stoppe bottens private
// beskeder, hvis ALLE veje til Discords besked-adresser går gennem de fire
// steder, der læser kontakten:
//   1. sendDM               (alle 8 beskedtyper og bestyrelsesspejlet)
//   2. drainDiscordDmOutbox (udbakkens gentagelser)
//   3. sendTestDM           (testknappen i Indstillinger)
//   4. runDiscordRaceDigestSweep (løbsresuméet kl. 20, før noget logges)
//
// Testen scanner hele backend/ statisk og fejler, hvis ny kode
//   - bruger DM-adresserne (/users/@me/channels eller /channels/<id>/messages)
//     uden for de kendte funktioner,
//   - kalder attemptDmDelivery, openDmChannel eller postDm uden for dem, eller
//   - flytter kontakt-læsningen ned under noget, der kan sende.
// Grov tekstlig proxy (samme slags som discordDeadConnectionCallSites.test.js),
// men den fanger præcis "en ny vej udenom" før merge.
//
// Kanal-opslag via webhooks (discord.com/api/webhooks/...), ejerens alarmer og
// bottens læsning/divisionsroller er bevidst uden for kontakten (ejer 13/11) og
// rammer ikke mønstrene herunder.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // backend/
const SKIPPED_DIRS = new Set(["node_modules", "coverage", "dist", "build"]);
const SOURCE_EXT = /\.(?:m|c)?js$/;
const TEST_FILE = /\.test\.(?:m|c)?js$/;

/** Mønster → de (fil, funktion)-par, hvor det må stå. */
const RULES = [
  {
    name: "DM-kanal-adressen /users/@me/channels",
    pattern: /users\/@me\/channels/g,
    allowed: ["lib/discordDmDelivery.js#attemptDmDelivery", "lib/discordNotifier.js#openDmChannel"],
  },
  {
    name: "besked-adressen /channels/<id>/messages",
    pattern: /\/channels\/[^\s"'`]*\/messages/g,
    allowed: ["lib/discordDmDelivery.js#attemptDmDelivery", "lib/discordNotifier.js#postDm"],
  },
  {
    name: "kald af attemptDmDelivery",
    pattern: /\battemptDmDelivery\s*\(/g,
    allowed: [
      "lib/discordDmDelivery.js#attemptDmDelivery", // definitionen
      "lib/discordNotifier.js#sendDM",
      "lib/discordNotifier.js#drainDiscordDmOutbox",
    ],
  },
  {
    name: "kald af openDmChannel/postDm",
    pattern: /\b(?:openDmChannel|postDm)\s*\(/g,
    allowed: [
      "lib/discordNotifier.js#openDmChannel", // definitionen
      "lib/discordNotifier.js#postDm", // definitionen
      "lib/discordNotifier.js#sendTestDM",
    ],
  },
];

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (SOURCE_EXT.test(entry) && !TEST_FILE.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Fjern kommentarer, så forklarende tekst ikke tæller som kode. Bevarer
 * længden (erstatter med mellemrum), så offsets og linjenumre stadig passer.
 * `//` efter `:` (https://) og inde i en streng-start røres ikke.
 */
function stripComments(source) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`\\])(\/\/[^\n]*)/gm, (_m, pre, comment) => pre + blank(comment));
}

/** Navnet på den nærmeste `function X(` før offset, eller "<top>". */
function enclosingFunction(code, index) {
  const re = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let name = "<top>";
  for (const m of code.matchAll(re)) {
    if (m.index > index) break;
    name = m[1];
  }
  return name;
}

const lineOf = (code, index) => code.slice(0, index).split("\n").length;

function findOffenders(code, label) {
  const offenders = [];
  for (const rule of RULES) {
    for (const m of code.matchAll(rule.pattern)) {
      const where = `${label}#${enclosingFunction(code, m.index)}`;
      if (!rule.allowed.includes(where)) offenders.push(`${label}:${lineOf(code, m.index)} (${rule.name}) i ${where}`);
    }
  }
  return offenders;
}

/** Kroppen af `function name(...) { ... }` (parametre springes over, de kan have `{}`). */
function functionBody(code, name) {
  const start = code.search(new RegExp(`\\bfunction\\s+${name}\\s*\\(`));
  assert.ok(start >= 0, `fandt ikke function ${name}`);
  let i = code.indexOf("(", start);
  let depth = 0;
  for (; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) break;
  }
  const open = code.indexOf("{", i);
  depth = 0;
  for (let j = open; j < code.length; j++) {
    if (code[j] === "{") depth++;
    else if (code[j] === "}" && --depth === 0) return code.slice(open, j + 1);
  }
  throw new Error(`ubalanceret krop i ${name}`);
}

const read = (rel) => stripComments(readFileSync(join(ROOT, rel), "utf8"));

test("#8149: ingen kode i backend/ når Discords DM-adresser uden om de fire steder", () => {
  const offenders = [];
  for (const file of listSourceFiles(ROOT)) {
    const label = relative(ROOT, file).split(sep).join("/");
    offenders.push(...findOffenders(stripComments(readFileSync(file, "utf8")), label));
  }
  assert.deepEqual(
    offenders,
    [],
    "En ny vej til en privat Discord-besked skal gå gennem sendDM (eller læse discord_player_dm som de fire steder):\n" + offenders.join("\n")
  );
});

test("#8149: sendDM, drainDiscordDmOutbox og sendTestDM læser kontakten, før noget kan sende", () => {
  const code = read("lib/discordNotifier.js");
  for (const name of ["sendDM", "drainDiscordDmOutbox", "sendTestDM"]) {
    const body = functionBody(code, name);
    const gate = body.indexOf("await playerDmEnabled()");
    assert.ok(gate >= 0, `${name} læser ikke hovedafbryderen`);
    for (const later of ["getBotToken(", "liveDiscordBlocked(", "attemptDmDelivery(", "openDmChannel(", "postDm(", "processDmOutboxDrain("]) {
      const at = body.indexOf(later);
      if (at >= 0) assert.ok(gate < at, `${name}: kontakten skal læses før ${later}`);
    }
  }
  // Standard-læseren er den ægte kontakt på modulets egen klient.
  assert.match(code, /let playerDmEnabled = \(\) => isDiscordPlayerDmEnabled\(supabase\);/);
  // Alle typede DM'er (de 8 typer og bestyrelsesspejlet) går gennem notifyDiscordDM → sendDM.
  assert.match(functionBody(code, "notifyDiscordDM"), /await sendDM\(/);
});

test("#8149: løbsresuméet springes over, før det læser rækker eller skriver logrækker", () => {
  const code = read("lib/discordRaceDigestSweep.js");
  assert.match(code, /isPlayerDmEnabled = isDiscordPlayerDmEnabled/);
  const body = functionBody(code, "runDiscordRaceDigestSweep");
  const gate = body.indexOf("await isPlayerDmEnabled(supabase)");
  assert.ok(gate >= 0, "sweepen læser ikke hovedafbryderen");
  for (const later of ["fetchRows(", "fetchEligibleUserIds(", "fetchAlreadySentUserIds(", "sendDigestDM(", "logDigestSent("]) {
    const at = body.indexOf(later);
    assert.ok(at > gate, `sweepen skal læse kontakten før ${later}`);
  }
});

test("#8149: scanneren fanger faktisk en ny vej udenom (vagt mod en regex der er holdt op med at matche)", () => {
  const sneaky = stripComments(
    [
      "export async function notifySomethingNew(discordId, token) {",
      "  const ch = await fetch(`${DISCORD_API}/users/@me/channels`, { method: 'POST' });",
      "  await fetch(`${DISCORD_API}/channels/${ch.id}/messages`, { method: 'POST' });",
      "  return attemptDmDelivery({ discordId, payload: {}, botToken: token });",
      "}",
    ].join("\n")
  );
  const offenders = findOffenders(sneaky, "lib/newFeature.js");
  assert.equal(offenders.length, 3, offenders.join("\n"));
  // Kommentarer og kanal-webhooks tæller ikke.
  const harmless = stripComments(
    [
      "// attemptDmDelivery(...) og /users/@me/channels nævnt i en kommentar",
      "const url = 'https://discord.com/api/webhooks/1/abc';",
    ].join("\n")
  );
  assert.deepEqual(findOffenders(harmless, "lib/newFeature.js"), []);
});
