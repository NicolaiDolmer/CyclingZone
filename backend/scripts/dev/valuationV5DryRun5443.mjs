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
  loadValuationModelByIdWithMarket,
  readProductionValueModelId,
  readValuationModelId,
  withMarketFit,
} from "../../lib/riderValuationModelSelect.js";
import { readFileSync } from "node:fs";
import { MAX_DEVELOP_SELL_ROI, developAndSellGate } from "../../lib/valuationV4Scorecard.js";
import { isTypefreeModel, valueTypefree } from "../../lib/valuationTypefree/typefreeValuation.js";
import { buildCapsTypefree, profileSignature, stepTypefree } from "../../lib/valuationTypefree/careerTypefree.js";

// ── #5497 v3: den typefri nøgle (v6) ─────────────────────────────────────────
//   --to=v6            den samlede typefri model
//   --step=N           elitepræmie-trin 0-4 (søndagskørsler siden kørselsdagen)
//                      for hovedfilerne (default 0 = kørselsdagen)
//   --market=<fil>     PRIVAT markeds-fit (typefree5497-market-fit.json fra
//                      målescriptet). Udeladt ⇒ app_config-nøglen
//                      rider_valuation_v6_market (findes den ikke: intet marked,
//                      og opsummeringen siger det).
// For v6 skrives desuden trin.md: population, managerhold, typebyte,
// +1-evnepoint-glathed og udvikl-og-sælg på alle fem trin. Alt kvalitativt
// nok til PR-body står i sektionen "Til PR-body" (andele, ingen navne/beløb).

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

// ── #5497 v3: trin-rapport for den typefri model ────────────────────────────
const hashUnit = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
};
const SWAP_TYPES = ["sprinter", "tt", "climber", "puncheur", "brostensrytter", "rouleur", "baroudeur", "gc"];
const SMOOTH_KEYS = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "aggression", "positioning", "tactics"];
const share = (n, d) => (d > 0 ? `${fmt((n / d) * 100)} %` : "n/a");

function typefreeStepReport({ perRider, humanTeamIds, baseline, youthBaseline, to, wageAfter, liveWageId, wageId }) {
  const STEPS = [0, 1, 2, 3, 4];
  const rec = (p, phaseStep, r = p.src.r, ab = p.src.ab) => recomputeRiderValue(r, ab, baseline, to, {
    typeAbilities: p.src.caps, youthBaseline, productionModel: wageAfter, phaseStep,
  });
  const byStep = new Map(); // rider id -> [out trin 0..4]
  for (const p of perRider) byStep.set(p.id, STEPS.map((i) => rec(p, i)));
  const isHuman = (p) => humanTeamIds.has(p.team_id);
  const human = perRider.filter(isHuman);

  const L = [
    `# #5497 v3 — typefri model (${to.model_id}) på alle fem præmie-trin`,
    "",
    `Read-only mod prod, ${new Date().toISOString()}. Gennem recomputeRiderValue. Marked: ${to.market_fit ? "ja" : "NEJ (intet fit)"}.`,
    "",
    "## Population pr. trin (før = prod i dag)",
    "",
    "| trin | gruppe | Σ ændring | median | op | ned | uændret | mister >= 25 % | mister >= 50 % |",
    "|---|---|--:|--:|--:|--:|--:|--:|--:|",
  ];
  const pubLines = [];
  for (const i of STEPS) {
    for (const [label, rows] of [["alle", perRider], ["menneskehold", human]]) {
      const after = rows.map((p) => byStep.get(p.id)[i].base_value);
      const before = rows.map((p) => p.before);
      const deltas = rows.map((p, j) => pct(before[j], after[j])).filter((x) => x != null);
      const up = rows.filter((p, j) => after[j] > before[j]).length;
      const dn = rows.filter((p, j) => after[j] < before[j]).length;
      const same = rows.length - up - dn;
      const sb = before.reduce((a, x) => a + x, 0);
      const sa = after.reduce((a, x) => a + x, 0);
      L.push(`| ${i} | ${label} | ${fmt(pct(sb, sa))} % | ${fmt(median(deltas))} % | ${share(up, rows.length)} | ${share(dn, rows.length)} | ${share(same, rows.length)} | ${share(deltas.filter((d) => d <= -25).length, rows.length)} | ${share(deltas.filter((d) => d <= -50).length, rows.length)} |`);
      if (label === "menneskehold") pubLines.push(`- Trin ${i}, ryttere på menneskehold: ${share(up, rows.length)} op, ${share(dn, rows.length)} ned, ${share(same, rows.length)} uændret.`);
    }
  }

  // Managerhold: ændrer rytterne sig overhovedet?
  const humanChanged = human.filter((p) => byStep.get(p.id)[0].base_value !== p.before).length;
  // Løn: flytter løngrundlaget sig på NOGET trin?
  const wageMoved = perRider.filter((p) => byStep.get(p.id).some((o) => o.current_production_value !== p.cpv_before)).length;
  // Markedet: hvor mange fik en faktor ≠ 1, og ramte loftet?
  const mf = perRider.map((p) => byStep.get(p.id)[0].valuation_components?.market_factor ?? 1);
  const capF = to.market_fit ? Math.exp(Number(to.market_fit.cap_ln)) : null;
  const atCap = capF ? mf.filter((f) => Math.abs(f - capF) < 1e-9 || Math.abs(f - 1 / capF) < 1e-9).length : 0;

  // Typebyte: samme evner, anden type/frossen type/anlæg ⇒ samme pris på alle trin.
  let swapN = 0, swapDiff = 0;
  for (const p of perRider) {
    if (hashUnit(`swap:${p.id}`) >= 0.2) continue;
    const other = SWAP_TYPES.find((t) => t !== p.src.r.primary_type && t !== p.src.r.valuation_type) ?? "gc";
    const r2 = { ...p.src.r, primary_type: other, valuation_type: other, archetype_draw: { primary: other, secondary: null, isHybrid: false } };
    for (const i of STEPS) {
      swapN++;
      if (rec(p, i, r2).base_value !== byStep.get(p.id)[i].base_value) swapDiff++;
    }
  }

  // +1 evnepoint: hvor ofte sænker ét ekstra point prisen (trin 0 og ny normal)?
  const smooth = {};
  for (const i of [0, 4]) {
    let n = 0, neg = 0, negBase = 0, over1 = 0;
    for (const p of perRider) {
      if (hashUnit(`sm:${p.id}`) >= 0.03) continue;
      const o0 = byStep.get(p.id)[i];
      for (const k of SMOOTH_KEYS) {
        const v = Number(p.src.ab[k]);
        if (!Number.isFinite(v) || v >= 99) continue;
        const o1 = rec(p, i, p.src.r, { ...p.src.ab, [k]: v + 1 });
        n++;
        if (o1.base_value < o0.base_value) neg++;
        if (o1.base_value < o0.base_value * 0.99) over1++;
        if (o1.valuation_components.base < o0.valuation_components.base) negBase++;
      }
    }
    smooth[i] = { n, neg, negBase, over1 };
  }

  // Udvikl-og-sælg (samme grænse som valuationV4Scorecard, 4 sæsoner):
  // prospects = alder <= 21 og potentiale >= 5. Løngrundlag = det der faktisk
  // gælder efter skiftet (v4). Fremskrivning = den typefri prognose.
  const prospects = perRider.filter((p) => p.age <= 21 && Number(p.src.r.potentiale) >= 5);
  const projectTf = (p) => {
    const sig = profileSignature(p.src.ab, to.profile);
    const capsTf = buildCapsTypefree(p.src.ab, sig, p.src.r.potentiale, { headroom: to.profile?.headroom });
    let ab = { ...p.src.ab };
    for (let s = 0; s < 4; s++) ab = stepTypefree(ab, capsTf, sig, { potentiale: p.src.r.potentiale, age: p.age + s });
    return ab;
  };
  const horizonByStep = new Map();
  for (const p of prospects) {
    const abH = projectTf(p);
    horizonByStep.set(p.id, STEPS.map((i) => valueTypefree({ age: p.age + 4, potentiale: p.src.r.potentiale }, abH, to, { phaseStep: i }).value));
  }
  const dev = STEPS.map((i) => {
    const gs = prospects.map((p) => ({
      p,
      start: byStep.get(p.id)[i].base_value,
      g: developAndSellGate({
        bvStart: byStep.get(p.id)[i].base_value,
        cpvStart: byStep.get(p.id)[i].current_production_value,
        bvAtHorizon: horizonByStep.get(p.id)[i],
        seasons: 4,
      }),
    }));
    const best = gs.reduce((b, y) => (y.start > (b?.start ?? -Infinity) ? y : b), null);
    return {
      i,
      n: gs.length,
      best,
      overCap: gs.filter((y) => y.g.roi > MAX_DEVELOP_SELL_ROI).length,
      netNeg: gs.filter((y) => !(y.g.pnl > 0)).length,
      medianRoi: median(gs.map((y) => y.g.roi).filter(Number.isFinite)),
    };
  });

  L.push(
    "",
    "## Kontroller",
    "",
    `- Løngrundlag (${liveWageId} -> ${wageId}) flyttet på noget trin: **${wageMoved}** ryttere`,
    `- Menneskeholds ryttere hvis pris ændrer sig på kørselsdagen: **${humanChanged} / ${human.length}**`,
    `- Typebyte (20 % stikprøve × 5 trin): **${swapDiff} afvigelser** af ${swapN}`,
    ...[0, 4].map((i) => `- +1 evnepoint, trin ${i} (3 % stikprøve, ${smooth[i].n} tilfælde): prisen falder i ${share(smooth[i].neg, smooth[i].n)} (over 1 %: ${share(smooth[i].over1, smooth[i].n)}); grundværdien alene falder i ${share(smooth[i].negBase, smooth[i].n)}`),
    `- Marked: faktor ≠ 1 for ${share(mf.filter((f) => f !== 1).length, mf.length)}; ved loftet: ${share(atCap, mf.length)}`,
    "",
    "## Udvikl-og-sælg pr. trin (4 sæsoner, prospects alder <= 21 og potentiale >= 5)",
    "",
    "| trin | prospects | dyreste: ROI | dyreste: ikke-dominant | dyreste: net-positiv | over ROI-loft | net-negative | median ROI |",
    "|---|--:|--:|--:|--:|--:|--:|--:|",
    ...dev.map((d) => `| ${d.i} | ${d.n} | ${Number.isFinite(d.best?.g?.roi) ? `${fmt(d.best.g.roi * 100)} %` : "-"} | ${Number.isFinite(d.best?.g?.roi) ? (d.best.g.roi <= MAX_DEVELOP_SELL_ROI ? "ja" : "NEJ") : "-"} | ${d.best ? (d.best.g.pnl > 0 ? "ja" : "NEJ") : "-"} | ${d.overCap} | ${d.netNeg} | ${fmt((d.medianRoi ?? NaN) * 100)} % |`),
    "",
    "## Til PR-body (kvalitativt, ingen navne/beløb)",
    "",
    `- Løngrundlag flyttet: ${wageMoved === 0 ? "0 (bekræftet på alle fem trin)" : `${wageMoved} (STOP)`}.`,
    `- Menneskeholds ryttere ændrer sig: ${share(humanChanged, human.length)} af dem får ny pris på kørselsdagen.`,
    `- Typebyte: ${swapDiff} afvigelser.`,
    `- +1 evnepoint sænker prisen i ${share(smooth[0].neg, smooth[0].n)} af tilfældene på kørselsdagen og ${share(smooth[4].neg, smooth[4].n)} i den nye normal.`,
    `- Udvikl-og-sælg "ikke dominant" for den dyreste prospect: ${dev.every((d) => Number.isFinite(d.best?.g?.roi) && d.best.g.roi <= MAX_DEVELOP_SELL_ROI) ? "grøn på alle fem trin" : "RØD på mindst ét trin"}; net-positiv: ${dev.map((d) => (d.best && d.best.g.pnl > 0 ? "grøn" : "rød")).join(" / ")}.`,
    ...pubLines,
    "",
  );
  return L;
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
  const marketFile = arg("market");
  let to = loadValuationModelById(toId);
  if (isTypefreeModel(to)) {
    to = marketFile
      ? withMarketFit(to, JSON.parse(readFileSync(resolve(marketFile), "utf8")))
      : await loadValuationModelByIdWithMarket(sb, toId);
    if (marketFile && !to.market_fit) throw new Error(`--market=${marketFile} er ikke et gyldigt markeds-fit`);
    console.log(`typefri model: marked ${to.market_fit ? `fra ${marketFile ? "--market" : "app_config"}` : "MANGLER (regnes uden marked)"}`);
  }
  const phaseStep = Math.max(0, Math.min(4, Number(arg("step", "0")) || 0));
  if (isTypefreeModel(to)) console.log(`elitepræmie-trin: ${phaseStep}`);
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
      typeAbilities: caps, youthBaseline, productionModel: wageAfter, phaseStep,
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
      src: { r, ab, caps },
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
    isTypefreeModel(to)
      ? `${new Date().toISOString().slice(0, 10)}-5497-${toId}-dryrun-trin${phaseStep}`
      : `${new Date().toISOString().slice(0, 10)}-5443-v5-dryrun`)));
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

  if (isTypefreeModel(to)) {
    writeFileSync(join(outDir, "trin.md"), typefreeStepReport({
      perRider, humanTeamIds, baseline, youthBaseline, from, to, wageBefore, wageAfter, liveWageId, wageId,
    }).join("\n"));
    console.log("  trin.md (alle fem præmie-trin, typebyte, glathed, udvikl-og-sælg)");
  }

  console.log(`skrevet: ${outDir}`);
  console.log(`  ryttere.csv (${perRider.length}) · hold.csv (${teamRows.length}) · opsummering.md`);
  console.log(
    wageHeld
      ? `løn-kontrol: ${cpvMoved.length} løngrundlag flytter sig (forventet 0)`
      : `løn-kontrol: løn-nøglen skiftes med — ${cpvMoved.length} løngrundlag flytter sig`
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
