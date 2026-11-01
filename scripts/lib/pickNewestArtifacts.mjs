// #7444: vælg den NYESTE udgave af hvert artefakt-navn.
//
// Baggrund: genkøres en e2e-shard, ligger der to artefakter med samme navn
// (e2e-shard-metrics-<lane>) i samme run. `download-artifact` med pattern +
// merge-multiple lader den senest udpakkede vinde, og rækkefølgen er ikke
// garanteret nyeste. Så kunne samlejobbet dømme på den gamle måling.
//
// Brug i workflowet:
//   gh api --paginate "repos/$REPO/actions/runs/$RUN_ID/artifacts" --jq '.artifacts[]' \
//     | node scripts/lib/pickNewestArtifacts.mjs --prefix e2e-shard-metrics-
// Output: én linje pr. udvalgt artefakt, "<id><TAB><name>", sorteret på navn.

import { fileURLToPath } from "node:url";

function time(artifact) {
  const t = Date.parse(artifact?.created_at ?? "");
  return Number.isNaN(t) ? -Infinity : t;
}

function isNewer(candidate, current) {
  const a = time(candidate);
  const b = time(current);
  if (a !== b) return a > b;
  // Samme tidsstempel: højeste id er det senest oprettede.
  return Number(candidate.id) > Number(current.id);
}

// Rene valglogik. Springer udløbne artefakter (expired: true) og navne uden
// det ønskede præfiks over. Returnerer ét artefakt pr. navn, sorteret på navn.
export function pickNewestArtifacts(artifacts, { prefix = "" } = {}) {
  const newest = new Map();
  for (const artifact of artifacts ?? []) {
    if (!artifact || typeof artifact.name !== "string") continue;
    if (!artifact.name.startsWith(prefix)) continue;
    if (artifact.expired === true) continue;
    const current = newest.get(artifact.name);
    if (!current || isNewer(artifact, current)) newest.set(artifact.name, artifact);
  }
  return [...newest.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// Accepterer et helt API-svar ({artifacts:[...]}), et array, eller ndjson
// (det `gh api --paginate --jq '.artifacts[]'` udskriver).
export function parseArtifactInput(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.artifacts)) return parsed.artifacts;
    return [parsed];
  } catch {
    return trimmed
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .flatMap((line) => parseArtifactInput(line));
  }
}

async function main(argv) {
  const prefixIdx = argv.indexOf("--prefix");
  const prefix = prefixIdx >= 0 ? argv[prefixIdx + 1] ?? "" : "";
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const picked = pickNewestArtifacts(parseArtifactInput(input), { prefix });
  if (picked.length === 0) {
    console.error(`::error::Ingen ikke-udløbne artefakter med præfikset "${prefix}" fundet.`);
    process.exit(1);
  }
  for (const a of picked) console.log(`${a.id}\t${a.name}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2));
}
