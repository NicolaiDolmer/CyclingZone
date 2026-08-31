// #4448 forward-guard — kilde-struktur-scanner (samme form som
// sessionRejection.4350.test.js; der er ingen jsdom i kodebasen).
//
// Fejlklassen der blev fundet i reviewet af PR #4450: da de håndholdte
// eslint-disable-linjer blev fjernet, fulgte `t` fra useTranslation med ind i
// dependency-arrayet på effekter der HENTER data eller ABONNERER på realtime.
// `t` får ny identitet ved hvert sprogskifte (react-i18next re-renderer på
// languageChanged), så en sådan effekt refetcher — eller river en supabase-kanal
// ned og gen-abonnerer — hver gang spilleren skifter sprog. Kommentarerne over
// arrayerne påstod samtidig at effekten var "mount-only".
//
// Reglen er derfor snæver med vilje: `t` er helt legitim i et useMemo-array
// (dér ER en gen-beregning ved sprogskifte det rigtige), men ikke i en effekt
// hvis krop rører fetch/supabase. Det korrekte mønster er tRef —
// `const tRef = useRef(t); useEffect(() => { tRef.current = t; }, [t]);` — som
// AuctionsPage.jsx allerede brugte før #4448.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC = fileURLToPath(new URL("..", import.meta.url));

// Markører for "effekten laver et sideeffekt-kald der ikke må gentages ved
// sprogskifte". Bevidst konkrete — ikke et generelt forbud mod t i arrays.
const SIDE_EFFECT_MARKERS = [/\bfetch\(/, /supabase\.channel\(/, /supabase\.from\(/, /authHeaders\(/];

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) { out.push(...listSourceFiles(full)); continue; }
    if (!/\.jsx?$/.test(entry)) continue;
    if (/\.test\.jsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

// Erstat kommentarer og streng-literaler med mellemrum, så paren-tælleren ikke
// snubler over en uparret parentes i en dansk kodekommentar.
function blankNonCode(src) {
  const out = src.split("");
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < src.length && src[i] !== "\n") { out[i] = " "; i++; }
      continue;
    }
    if (two === "/*") {
      while (i < src.length && src.slice(i, i + 2) !== "*/") { out[i] = " "; i++; }
      for (let k = 0; k < 2 && i < src.length; k++, i++) out[i] = " ";
      continue;
    }
    if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
      const quote = src[i];
      out[i] = " "; i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") { out[i] = " "; i++; if (i < src.length) { out[i] = " "; i++; } continue; }
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < src.length) { out[i] = " "; i++; }
      continue;
    }
    i++;
  }
  return out.join("");
}

// Alle useEffect(...)-kald i filen, som { deps, body, line }.
function effectCalls(src) {
  const code = blankNonCode(src);
  const calls = [];
  const needle = "useEffect(";
  let from = 0;
  for (;;) {
    const start = code.indexOf(needle, from);
    if (start === -1) break;
    from = start + needle.length;
    let depth = 1;
    let i = from;
    while (i < code.length && depth > 0) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
      i++;
    }
    if (depth !== 0) continue; // uafsluttet — lad parseren/eslint om den
    const callCode = code.slice(from, i - 1);
    const depsMatch = callCode.match(/,\s*\[([^\][]*)\]\s*$/);
    if (!depsMatch) continue; // intet dependency-array (kører hver render)
    calls.push({
      deps: depsMatch[1].split(",").map((d) => d.trim()).filter(Boolean),
      // Kroppen læses fra ORIGINALEN, så markørerne stadig kan ses.
      body: src.slice(from, i - 1),
      line: src.slice(0, start).split("\n").length,
    });
  }
  return calls;
}

test("#4448 ingen fetch-/realtime-effekt har t i sit dependency-array", () => {
  const offenders = [];
  for (const file of listSourceFiles(SRC)) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("useTranslation")) continue;
    for (const call of effectCalls(src)) {
      if (!call.deps.includes("t")) continue;
      if (!SIDE_EFFECT_MARKERS.some((m) => m.test(call.body))) continue;
      offenders.push(`${path.relative(SRC, file).replace(/\\/g, "/")}:${call.line} → [${call.deps.join(", ")}]`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "t skifter identitet ved sprogskifte — en effekt der fetcher eller abonnerer, og har t i arrayet, "
      + "kører derfor forfra hver gang sproget skiftes. Læs t gennem en tRef i stedet:\n  "
      + offenders.join("\n  "),
  );
});

test("#4448 scanneren finder rent faktisk effekter (ingen tavs no-op)", () => {
  // Uden denne ville en knækket parser lade guarden bestå tomt for evigt.
  const riderStats = readFileSync(path.join(SRC, "pages/RiderStatsPage.jsx"), "utf8");
  const calls = effectCalls(riderStats);
  const rawCount = (riderStats.match(/useEffect\(/g) || []).length;
  assert.equal(
    calls.length,
    rawCount,
    `scanneren fandt ${calls.length} af ${rawCount} useEffect-kald i RiderStatsPage — paren-tælleren er knækket`,
  );
  assert.ok(rawCount >= 8, `forventede mange useEffect-kald i RiderStatsPage, fandt ${rawCount}`);
  assert.ok(
    calls.some((c) => SIDE_EFFECT_MARKERS.some((m) => m.test(c.body))),
    "scanneren genkendte ingen fetch-/supabase-effekt i RiderStatsPage — markørerne er holdt op med at ramme",
  );
});

test("#4448 de rettede steder læser t gennem en ref", () => {
  const files = [
    "components/admin/RacePointModelSection.jsx",
    "components/admin/RacePointsAdminSection.jsx",
    "pages/RiderStatsPage.jsx",
    // Fundet af scanneren selv (backwards-check) — samme fejlklasse, ældre end #4448.
    "components/SeasonFinanceReportPanel.jsx",
    "components/TeamResultsTab.jsx",
    "components/TeamTransferHistoryTab.jsx",
  ];
  for (const rel of files) {
    const src = readFileSync(path.join(SRC, rel), "utf8");
    assert.match(src, /const tRef = useRef\(t\);/, `${rel} mangler tRef — så er t på vej tilbage i et array`);
    assert.match(src, /tRef\.current = t;/, `${rel} opdaterer ikke tRef, så fejltekster ville hænge på gammelt sprog`);
  }
});
