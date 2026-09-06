// #4869 forward-guard — kilde-struktur-scanner over HELE frontend/src.
//
// Rod-årsagen: `.single()` på `users`/`teams`-opslag der lovligt kan give 0
// rækker (intet hold endnu på et nyt hold-opslag, RLS-skjult egen profil ved
// udløbet/ugyldig session) gav 406 i produktion i stedet for et almindeligt
// null-svar — målt 68 gange på ÉN bruger (edge_logs 4-5/9). Fixet ved at
// skifte til `.maybeSingle()` + eksplicit null-håndtering alle relevante
// steder (se PR for #4869).
//
// Denne test forhindrer at mønstret sniger sig ind igen: `.single()` på
// `from("users")`/`from("teams")` er forbudt, MEDMINDRE stedet har en
// `// single-ok: <begrundelse>`-kommentar på samme linje som eller linjen
// lige over `.single()` — til de (sjældne) tilfælde hvor 0 ELLER >1 rækker
// rent faktisk ER en fejltilstand, der bevidst skal fejle højlydt.
//
// Scanner bredt (hele src, ikke en liste af kendte filer) så den også dækker
// en fil der ikke findes endnu — samme mønster som authHeadersCanonical.4348.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry) && !/\.test\.[jt]sx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// from("users")/from("teams") efterfulgt — inden for et rimeligt vindue, så
// multi-linje-kæder (.select()/.eq()/.order() ind imellem) også fanges — af
// `.single()`. Case-sensitivt/lowercase "s" så `.maybeSingle()` (stort "S",
// ingen punktum lige før "single") ALDRIG matcher ved en fejl. Vinduet stopper
// ved næste `.from(` (en ny query) så et NABO-kald i fx et Promise.all(...)
// ikke fejlagtigt "låner" en .single() der hører til en anden tabel.
const OFFENDER_RE = /from\(\s*["'](users|teams)["']\s*\)(?:(?!\.from\()[\s\S]){0,300}?\.single\(\)/g;

function findOffenders(source) {
  const lines = source.split("\n");
  const found = [];
  for (const match of source.matchAll(OFFENDER_RE)) {
    const upToMatchEnd = source.slice(0, match.index + match[0].length);
    const lineIdx = upToMatchEnd.split("\n").length - 1; // 0-based
    // Kig op til 3 linjer op (dækker multi-linje-kæder hvor .from(...) og
    // .single() ligger på hver sin linje, og selve kaldet indledes 1-2
    // linjer under en forklarende single-ok-kommentarblok).
    const nearbyLines = lines.slice(Math.max(0, lineIdx - 3), lineIdx + 1);
    if (nearbyLines.some(l => /single-ok:/.test(l))) continue;
    found.push({ table: match[1], line: lineIdx + 1, snippet: match[0].replace(/\s+/g, " ").slice(0, 140) });
  }
  return found;
}

test("#4869 guard-regex opdager en nøgen .single() på users/teams og respekterer single-ok + maybeSingle", () => {
  // Selvtest af regex/undtagelseslogik — uden denne kunne testen nedenfor
  // bestå tomt for evigt hvis OFFENDER_RE eller single-ok-tjekket blev
  // subtilt ødelagt (en grøn test der intet tester er værre end ingen test).
  const violation = 'const { data } = await supabase.from("teams").select("id").eq("user_id", u).single();';
  const allowedSameLine = 'const { data } = await supabase.from("teams").select("id").eq("id", 1).single(); // single-ok: config-singleton, 0 rækker ER en fejl';
  const allowedLineAbove = [
    "// single-ok: config-singleton, 0 rækker ER en fejl",
    'const { data } = await supabase.from("users").select("role").eq("id", 1).single();',
  ].join("\n");
  const maybeSingleIsFine = 'const { data } = await supabase.from("teams").select("id").eq("user_id", u).maybeSingle();';
  const otherTableIsFine = 'const { data } = await supabase.from("seasons").select("*").eq("status", "active").single();';

  assert.equal(findOffenders(violation).length, 1, "regex bør opdage en nøgen .single() på teams");
  assert.equal(findOffenders(allowedSameLine).length, 0, "single-ok på samme linje bør undtage stedet");
  assert.equal(findOffenders(allowedLineAbove).length, 0, "single-ok på linjen over bør undtage stedet");
  assert.equal(findOffenders(maybeSingleIsFine).length, 0, ".maybeSingle() bør aldrig matche (ikke forveksles med .single())");
  assert.equal(findOffenders(otherTableIsFine).length, 0, "andre tabeller end users/teams er uden for denne guards scope");
});

test('#4869 .single() på from("users")/from("teams") kræver .maybeSingle() eller en "// single-ok:"-kommentar', () => {
  const found = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    for (const offender of findOffenders(source)) {
      found.push(`${rel}:${offender.line} (${offender.table}) — ${offender.snippet}`);
    }
  }
  assert.deepEqual(
    found,
    [],
    `${found.length} sted(er) bruger .single() på users/teams uden single-ok-kommentar — 0 rækker er ofte lovligt her ` +
      `(intet hold endnu / RLS-skjult profil ved udløbet session), brug .maybeSingle() i stedet (#4869):\n${found.join("\n")}`,
  );
});
