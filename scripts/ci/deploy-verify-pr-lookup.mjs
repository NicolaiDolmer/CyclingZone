// scripts/ci/deploy-verify-pr-lookup.mjs
// ============================================================
// #5424: `resolve_pr_number()` i .github/workflows/deploy-verify.yml piper
// GitHub-svaret fra `commits/$sha/pulls` direkte til `jq -r '.[0].number //
// empty'`. Faar den et IKKE-tomt svar der ER gyldig JSON men IKKE et array
// (fx en fejl-JSON paa et 200-svar - rate-limit/abuse-besked el. lign.),
// kaster `.[0]` paa et objekt jq's egen "Cannot index object with number"-fejl,
// og trinnet vaelter med jq's raa fejltekst i stedet for den tilsigtede
// `::error::`-besked og retry-logik.
//
// Denne fil rummer kun den RENE afgoerelse (er svaret et brugbart array, og
// hvad er saa PR-nummeret), adskilt fra YAML'ens retry-/gh api-logik, saa den
// kan enhedstestes uden en GitHub Actions-runner
// (node --test scripts/ci/deploy-verify-pr-lookup.test.mjs). Selve
// `resolve_pr_number()` kalder denne fil som CLI og behandler et ikke-nul
// exit-kode som "transient, proev igen" - samme retry-facon (3 forsoeg) som
// foer #5424.
//
// CLI: laeser raw HTTP-body paa stdin.
//   - Tomt body ELLER JSON der ikke er et array: exit 2 (transient), fejl paa
//     stderr, intet paa stdout - kaldestedet behandler det som "proev igen".
//   - Gyldigt array (ogsaa `[]`, dvs. "ingen PR" - en lovlig sti for en
//     direkte push): exit 0, printer PR-nummeret (eller en tom linje) paa
//     stdout.
//
//   gh api repos/OWNER/REPO/commits/$sha/pulls \
//     | node scripts/ci/deploy-verify-pr-lookup.mjs
//
// Refs #5424 #5286 #5338.

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string | null | undefined} rawBody
 * @returns {{ ok: true, number: string } | { ok: false, transient: true, reason: "empty" | "invalid-json" | "not-array" }}
 */
export function parsePrLookupResponse(rawBody) {
  const trimmed = (rawBody ?? "").trim();
  if (!trimmed) {
    return { ok: false, transient: true, reason: "empty" };
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, transient: true, reason: "invalid-json" };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, transient: true, reason: "not-array" };
  }

  const number = parsed[0]?.number;
  return { ok: true, number: number === undefined || number === null ? "" : String(number) };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = await readStdin();
  const result = parsePrLookupResponse(raw);
  if (!result.ok) {
    process.stderr.write(`ikke-brugbart svar fra commits/pulls (${result.reason})\n`);
    return 2;
  }
  process.stdout.write(`${result.number}\n`);
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then((code) => process.exit(code));
}
