// #5443 · Tørkørsel: hvad gør v5-værdimodellen ved hele den aktive population?
//
// 100 % READ-ONLY. Scriptet SELECT'er mod prod og skriver kun lokale filer under
// balance-internals/ (gitignoreret). Der findes ingen --apply, ingen skrivning
// og ingen flag-flip her: aktiveringen er ejerens ene skridt i app_config
// (database/2026-09-20-5443-rider-valuation-model.sql), ikke et script.
//
// SAMME BEREGNINGSSTI SOM DEN RIGTIGE KØRSEL. Scriptet henter de samme rækker
// som refreshChangedRiderValues (riderValueRefresh.js) og kalder dens egen
// recomputeRiderValue — først med den model app_config peger på i dag, så med
// v5. Der findes ingen formel i denne fil. Afviger tørkørslen fra søndagen,
// er det fordi rækkerne har flyttet sig imellem de to, ikke fordi tallene er
// regnet et andet sted.
//
// Kør fra backend/:
//   infisical run --env=prod --silent -- node scripts/dev/valuationV5DryRun5443.mjs
//
// TO MODELLER, IKKE ÉN (#5443 ejer-beslutning 2, 20/9 aften). Prisen
// (base_value) og løngrundlaget (current_production_value, 35 %-lønsatsens
// basis) vælger model hver for sig via to app_config-nøgler. Tørkørslen viser
// derfor BEGGE tal og bekræfter eksplicit at løngrundlaget står stille, når kun
// prisens nøgle flyttes. Det er hele pointen i beslutningen: "Løn skal ikke
// følge værdi" — og et tal ejeren skal kunne se, ikke tage på ordet.
//
// Valgfrit:
//   --from=v4        sammenlignings-grundlag for prisen (default: app_config-valget)
//   --to=v5          målmodel for prisen (default: v5)
//   --wage=v4        løngrundlagets model efter skiftet (default: app_config-valget
//                    for rider_production_value_model, altså v4)
//   --out=<mappe>    output-mappe (default: balance-internals/<dato>-5443-v5-dryrun)
//
// Output (kun lokalt):
//   ryttere.csv      én linje pr. rytter: id, type, alder, pris før/efter, løngrundlag før/efter
//   hold.csv         én linje pr. hold: navn, antal ryttere, Σ før, Σ efter, ændring
//   opsummering.md   totaler, fordeling af fald/stigninger, de største udsving,
//                    og en LØN-KONTROL: hvor mange løngrundlag der flyttede sig
//
// Filerne indeholder holdnavne og rytter-id'er og må derfor ALDRIG committes
// eller citeres i repoet/PR-body (hard rule 17). Referér dem ved filnavn.

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { fetchAllRows } from "../../lib/supabasePagination.js";
import { ageForSeason } from "../../lib/riderSeasonAge.js";
import { VALUATION_ABILITY_COLUMNS } from "../../lib/riderValuation.js";
import { recomputeRiderValue } from "../../lib/riderValueRefresh.js";
import {
  loadValuationModelById,
  readProductionValueModelId,
  readValuationModelId,
} from "../../lib/riderValuationModelSelect.js";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = join(__dirname, "../../lib");
const REPO = join(__dirname, "../../..");

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const pct = (before, after) => (before > 0 ? ((after - before) / before) * 100 : null);
const fmt = (n) => (n == null ? "" : String(Math.round(n * 10) / 10));
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const csv = (rows) => rows.map((r) => r.map(csvCell).join(";")).join("\n") + "\n";

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const liveId = await readValuationModelId(sb);
  const liveWageId = await readProductionValueModelId(sb);
  const fromId = arg("from", liveId);
  const toId = arg("to", "v5");
  // Løngrundlaget EFTER skiftet. Default er app_config-valget, altså v4 så
  // længe ejeren ikke har flippet den separate nøgle (ejer-beslutning 2).
  const wageId = arg("wage", liveWageId);
  const from = loadValuationModelById(fromId);
  const to = loadValuationModelById(toId);
  // FØR-billedet skal være prod som den er LIGE NU: pris fra `fromId`,
  // løngrundlag fra den nøgle der faktisk gælder i dag.
  const wageBefore = loadValuationModelById(liveWageId);
  const wageAfter = loadValuationModelById(wageId);
  console.log(`tørkørsel pris:        ${fromId} -> ${toId} (app_config i dag: '${liveId}')`);
  console.log(`tørkørsel løngrundlag: ${liveWageId} -> ${wageId} (app_config i dag: '${liveWageId}')`);
  if (fromId === toId) console.log("ADVARSEL: samme prismodel i begge ender — diffen bliver tom.");

  // ── Samme sæson-anker som refreshChangedRiderValues ────────────────────────
  const { data: active } = await sb.from("seasons").select("number").eq("status", "active").maybeSingle();
  let seasonNumber = active?.number ?? null;
  if (!seasonNumber) {
    const { data: done } = await sb.from("seasons").select("number").eq("status", "completed")
      .order("number", { ascending: false }).limit(1).maybeSingle();
    seasonNumber = done?.number ?? 1;
  }
  console.log(`sæson-anker: ${seasonNumber}`);

  // ── Samme baselines som produktionen ───────────────────────────────────────
  const baseline = JSON.parse(readFileSync(join(LIB, "riderTypesBaseline.json"), "utf8"));
  const youthBaseline = JSON.parse(readFileSync(join(LIB, "riderTypesBaselineYouth.json"), "utf8"));

  // ── Samme selects som refreshChangedRiderValues ────────────────────────────
  const riders = await fetchAllRows(() => sb.from("riders")
    .select("id, team_id, primary_type, secondary_type, valuation_type, base_value, current_production_value, birthdate, potentiale, archetype_draw, is_retired")
    .order("id"));
  for (const r of riders) r.age = ageForSeason(r.birthdate, seasonNumber);

  const abilityRows = await fetchAllRows(() => sb.from("rider_derived_abilities")
    .select(`rider_id, ability_caps, ${VALUATION_ABILITY_COLUMNS.join(", ")}`).order("rider_id"));
  const abilityByRider = new Map(abilityRows.map((a) => [a.rider_id, a]));
  const capsByRider = new Map(abilityRows.map((a) => [a.rider_id, a.ability_caps]));

  const teams = await fetchAllRows(() => sb.from("teams")
    .select("id, name, is_ai, is_test_account, is_frozen, is_bank").order("id"));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // ── Beregn, rytter for rytter, gennem produktionens egen funktion ──────────
  const perRider = [];
  for (const r of riders) {
    if (r.is_retired) continue;
    const ab = abilityByRider.get(r.id);
    if (!ab) continue;
    const caps = capsByRider.get(r.id);
    const a = recomputeRiderValue(r, ab, baseline, from, {
      typeAbilities: caps, youthBaseline, productionModel: wageBefore,
    });
    const b = recomputeRiderValue(r, ab, baseline, to, {
      typeAbilities: caps, youthBaseline, productionModel: wageAfter,
    });
    if (a.base_value == null || b.base_value == null) continue;
    perRider.push({
      id: r.id,
      team_id: r.team_id,
      primary_type: a.primary_type,
      valuation_type: r.valuation_type ?? "",
      age: r.age,
      before: a.base_value,
      after: b.base_value,
      cpv_before: a.current_production_value,
      cpv_after: b.current_production_value,
      delta_pct: pct(a.base_value, b.base_value),
    });
  }

  // ── Pr. hold ───────────────────────────────────────────────────────────────
  const byTeam = new Map();
  for (const p of perRider) {
    if (!p.team_id) continue;
    if (!byTeam.has(p.team_id)) byTeam.set(p.team_id, { n: 0, before: 0, after: 0 });
    const t = byTeam.get(p.team_id);
    t.n += 1; t.before += p.before; t.after += p.after;
  }

  const outDir = resolve(arg("out", join(REPO, "balance-internals",
    `${new Date().toISOString().slice(0, 10)}-5443-v5-dryrun`)));
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, "ryttere.csv"), csv([
    ["rider_id", "team_id", "primaer_type", "frossen_type", "alder", "foer", "efter", "aendring_pct", "cpv_foer", "cpv_efter"],
    ...perRider.map((p) => [p.id, p.team_id ?? "", p.primary_type, p.valuation_type, p.age,
      p.before, p.after, fmt(p.delta_pct), p.cpv_before, p.cpv_after]),
  ]));

  const teamRows = [...byTeam.entries()].map(([id, t]) => {
    const team = teamById.get(id);
    return {
      id,
      name: team?.name ?? "(ukendt)",
      human: !team?.is_ai && !team?.is_test_account && !team?.is_frozen && !team?.is_bank,
      ...t,
      delta_pct: pct(t.before, t.after),
    };
  }).sort((a, b) => (a.delta_pct ?? 0) - (b.delta_pct ?? 0));

  writeFileSync(join(outDir, "hold.csv"), csv([
    ["team_id", "hold", "menneskehold", "ryttere", "foer", "efter", "aendring_pct"],
    ...teamRows.map((t) => [t.id, t.name, t.human ? "ja" : "nej", t.n, t.before, t.after, fmt(t.delta_pct)]),
  ]));

  // ── Opsummering ────────────────────────────────────────────────────────────
  const humanTeamIds = new Set(teamRows.filter((t) => t.human).map((t) => t.id));
  const human = perRider.filter((p) => humanTeamIds.has(p.team_id));
  const sum = (xs, k) => xs.reduce((a, x) => a + x[k], 0);
  const down = (xs, threshold) => xs.filter((p) => p.delta_pct != null && p.delta_pct <= -threshold).length;

  const biggestDrops = [...human].filter((p) => p.delta_pct != null)
    .sort((a, b) => a.delta_pct - b.delta_pct).slice(0, 40);
  const biggestRises = [...human].filter((p) => p.delta_pct != null)
    .sort((a, b) => b.delta_pct - a.delta_pct).slice(0, 20);

  // ── LØN-KONTROL (#5443 ejer-beslutning 2) ────────────────────────────────
  // Flyttes kun prisens nøgle, SKAL hvert eneste løngrundlag stå bit-stille.
  // Tallet herunder er ejerens bevis for at lønnen venter — ikke et løfte.
  const cpvMoved = perRider.filter((p) => p.cpv_before !== p.cpv_after);
  const cpvHuman = perRider.filter((p) => p.cpv_before !== p.cpv_after && p.team_id != null);
  const wageHeld = wageId === liveWageId;

  const lines = [
    `# #5443 tørkørsel — pris ${fromId} -> ${toId}, løngrundlag ${liveWageId} -> ${wageId}`,
    "",
    `Kørt ${new Date().toISOString()} · read-only mod prod · intet skrevet.`,
    `Sæson-anker ${seasonNumber}. Beregnet gennem recomputeRiderValue (samme sti som søndagskørslen).`,
    "",
    "## Løn-kontrol (ejer-beslutning 2: lønnen venter)",
    "",
    `- løngrundlagets model: **${liveWageId} -> ${wageId}**`,
    `- ryttere hvis løngrundlag flytter sig: **${cpvMoved.length}** (heraf med hold: ${cpvHuman.length})`,
    wageHeld
      ? (cpvMoved.length === 0
        ? "- ✅ BEKRÆFTET: intet løngrundlag flytter sig. Fremtidige lønkrav er uændrede."
        : `- ⛔ UVENTET: ${cpvMoved.length} løngrundlag flytter sig, selvom løn-nøglen ikke er skiftet. STOP og undersøg før tænding.`)
      : "- ⚠️ løn-nøglen er skiftet med i denne kørsel — løngrundlag SKAL flytte sig her.",
    "",
    "## Totaler",
    "",
    "| | ryttere | Σ før | Σ efter | ændring |",
    "|---|--:|--:|--:|--:|",
    `| Hele populationen | ${perRider.length} | ${sum(perRider, "before")} | ${sum(perRider, "after")} | ${fmt(pct(sum(perRider, "before"), sum(perRider, "after")))} % |`,
    `| Menneskehold | ${human.length} | ${sum(human, "before")} | ${sum(human, "after")} | ${fmt(pct(sum(human, "before"), sum(human, "after")))} % |`,
    "",
    "## Fordeling (menneskehold)",
    "",
    `- op: ${human.filter((p) => p.after > p.before).length} · ned: ${human.filter((p) => p.after < p.before).length} · uændret: ${human.filter((p) => p.after === p.before).length}`,
    `- mister >= 25 %: ${down(human, 25)} · >= 50 %: ${down(human, 50)} · >= 75 %: ${down(human, 75)}`,
    `- median ændring: ${fmt(median(human.map((p) => p.delta_pct).filter((x) => x != null)))} %`,
    `- hold der taber >= 10 %: ${teamRows.filter((t) => t.human && (t.delta_pct ?? 0) <= -10).length} · >= 25 %: ${teamRows.filter((t) => t.human && (t.delta_pct ?? 0) <= -25).length}`,
    "",
    "## De 40 største fald (menneskehold)",
    "",
    "| rider_id | type | frossen type | alder | før | efter | ændring |",
    "|---|---|---|--:|--:|--:|--:|",
    ...biggestDrops.map((p) => `| ${p.id} | ${p.primary_type} | ${p.valuation_type || "-"} | ${p.age} | ${p.before} | ${p.after} | ${fmt(p.delta_pct)} % |`),
    "",
    "## De 20 største stigninger (menneskehold)",
    "",
    "| rider_id | type | frossen type | alder | før | efter | ændring |",
    "|---|---|---|--:|--:|--:|--:|",
    ...biggestRises.map((p) => `| ${p.id} | ${p.primary_type} | ${p.valuation_type || "-"} | ${p.age} | ${p.before} | ${p.after} | ${fmt(p.delta_pct)} % |`),
    "",
  ];
  writeFileSync(join(outDir, "opsummering.md"), lines.join("\n"));

  console.log(`skrevet: ${outDir}`);
  console.log(`  ryttere.csv (${perRider.length}) · hold.csv (${teamRows.length}) · opsummering.md`);
  console.log(
    wageHeld
      ? `løn-kontrol: ${cpvMoved.length} løngrundlag flytter sig (forventet 0)`
      : `løn-kontrol: løn-nøglen skiftes med — ${cpvMoved.length} løngrundlag flytter sig`
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
