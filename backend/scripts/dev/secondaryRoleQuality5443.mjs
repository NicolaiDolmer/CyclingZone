// #5443 / #3353 runde 4 · Hvor god er den SEKUNDÆRE rolle som bærer af en del
// af prisen — og er der en bedre måde at vælge "den anden rolle" på?
//
// Kandidat C5 lægger 30 % af værdien på rytterens sekundære rolle. Staff har
// kaldt den sekundære "random", og ejeren besluttede 11/9 at den skæve fordeling
// KUN rettes for nye ryttere. Dette script måler konsekvensen og bygger tre
// varianter af "den anden rolle":
//
//   C5a  sekundær-typen som den står i dag
//   C5b  rytterens bedste ANDEN rolle målt på LOFTERNE (ability_caps = potentiale)
//   C5c  C5a for ryttere med et ægte, jævnt trukket anlæg; C5b for resten
//
// Hvorfor lofterne er en kandidat: `buildCapsForRider` (riderProgression.js:746)
// afhænger KUN af potentiale, alder, primær og sekundær — ikke af dagens evner.
// Loftet flytter sig derfor ikke af træning, kun ved aldring (sæsonskiftet) eller
// en regelændring. En rolle valgt på lofter kan altså ikke vippe fra uge til uge,
// modsat D-049's bedste-rolle-nu (runde 3, prøve 5).
//
// READ-ONLY mod prod (kun SELECT). Skriver kun filer.
//
//   infisical run --env=prod --silent -- node scripts/dev/secondaryRoleQuality5443.mjs \
//     --sample=lib/riderProductionSample.json --out-dir=lib/refit5443 \
//     --report=<sti til markdown>

import "dotenv/config";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { fetchAllRows } from "../../lib/supabasePagination.js";
import { RIDER_TYPE_KEYS } from "../../lib/riderTypes.js";
import { ABILITY_KEYS as RACE_ABILITY_KEYS } from "../../lib/raceSimulator.js";
import { ABILITY_KEYS } from "../../lib/riderTypes.js";
import { DISPLAY_RECIPES, ratingForRole } from "../../lib/weights/displayRecipes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, "../..");

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : def;
};
const SAMPLE = resolve(join(BACKEND, String(arg("sample", "lib/riderProductionSample.json"))));
const OUT_DIR = resolve(join(BACKEND, String(arg("out-dir", "lib/refit5443"))));
const REPORT = arg("report", null);
const BLEND = Number(arg("blend", 0.7));
// Kohorte-skillet er MÅLT, ikke gættet: ryttere oprettet før 11/8 fik ingen
// trukket sekundær (HYBRID_PROBABILITY 0,15) og fik feltet udfyldt af
// klassifikatoren; #3593 frøs derefter gættet ned i archetype_draw. Fordelings-
// fixet (#3800/#3631) landede 15/8. Målt i prod 20/9 på menneskehold:
// rouleur+sprinter dækker 58,4 % før 11/8 mod 30,1 % efter 15/8 (mål ~30,3 %).
const DRAWN_FROM = String(arg("drawn-from", "2026-08-16"));

const RECIPES = Object.fromEntries(DISPLAY_RECIPES.map((r) => [r.key, { ...r.weights }]));

function normalized(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / total]));
}
function blendRecipes(a, b, w) {
  const na = normalized(RECIPES[a]);
  const nb = normalized(RECIPES[b]);
  const out = {};
  for (const k of new Set([...Object.keys(na), ...Object.keys(nb)])) {
    const v = w * (na[k] ?? 0) + (1 - w) * (nb[k] ?? 0);
    if (v > 0) out[k] = Number(v.toFixed(6));
  }
  return out;
}

// Roller rangeret efter et evne-sæt (lofter eller dagens evner), højest først.
function rankRoles(abilities) {
  return RIDER_TYPE_KEYS
    .map((key) => ({ key, score: ratingForRole(abilities, key) }))
    .filter((r) => r.score != null)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

// Bedste rolle der IKKE er primæren.
function bestOther(abilities, primary) {
  const ranked = rankRoles(abilities).filter((r) => r.key !== primary);
  return ranked.length ? ranked[0] : null;
}

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)} %` : "—");

async function main() {
  const art = JSON.parse(readFileSync(SAMPLE, "utf8"));
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler. Kør via infisical.");
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const riders = await fetchAllRows(() => sb.from("riders")
    .select("id, firstname, lastname, team_id, is_retired, primary_type, secondary_type, created_at, archetype_draw")
    .order("id"));
  const teams = await fetchAllRows(() => sb.from("teams").select("id, is_ai, is_bank, is_test_account").order("id"));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const abilityCols = [...new Set([...ABILITY_KEYS, ...RACE_ABILITY_KEYS])];
  const abilities = await fetchAllRows(() => sb.from("rider_derived_abilities")
    .select(`rider_id, ability_caps, ${abilityCols.join(", ")}`).order("rider_id"));
  const abById = new Map(abilities.map((a) => [a.rider_id, a]));
  console.log(`Hentet ${riders.length} ryttere, ${abilities.length} evne-raekker (kun SELECT).`);

  const isHuman = (r) => {
    const t = r.team_id ? teamById.get(r.team_id) : null;
    return Boolean(t && t.is_ai === false && t.is_bank !== true && t.is_test_account !== true);
  };
  const drawn = (r) => String(r.created_at ?? "") >= DRAWN_FROM;

  // ── 1. Kvalitet af sekundaeren ────────────────────────────────────────────
  const groups = { "trukket jaevnt (efter 15/8)": [], "klassifikator-udfyldt (foer 15/8)": [] };
  const capsRole = {};   // rider_id -> bedste ANDEN rolle paa lofter
  const nowRole = {};    // rider_id -> bedste ANDEN rolle paa dagens evner

  for (const r of riders) {
    if (r.is_retired) continue;
    const ab = abById.get(r.id);
    if (!ab || !r.primary_type) continue;
    const caps = ab.ability_caps;
    const bo = caps ? bestOther(caps, r.primary_type) : null;
    const bn = bestOther(ab, r.primary_type);
    if (bo) capsRole[r.id] = bo.key;
    if (bn) nowRole[r.id] = bn.key;
    if (!isHuman(r)) continue;

    const key = drawn(r) ? "trukket jaevnt (efter 15/8)" : "klassifikator-udfyldt (foer 15/8)";
    const secOnCaps = caps ? ratingForRole(caps, r.secondary_type) : null;
    const secOnNow = ratingForRole(ab, r.secondary_type);
    groups[key].push({
      id: r.id,
      secondary: r.secondary_type,
      caps_best_other: bo?.key ?? null,
      caps_match: bo ? bo.key === r.secondary_type : null,
      caps_gap: bo && secOnCaps != null ? bo.score - secOnCaps : null,
      now_best_other: bn?.key ?? null,
      now_match: bn ? bn.key === r.secondary_type : null,
      now_gap: bn && secOnNow != null ? bn.score - secOnNow : null,
      // Er loftet FORMET af sekundaeren? buildYouthCaps giver sekundaeren et
      // loeft, saa sekundaerens loft-score boer ligge over en tilfaeldig rolles.
      sec_caps_rank: caps ? rankRoles(caps).findIndex((x) => x.key === r.secondary_type) + 1 : null,
    });
  }

  const quality = {};
  for (const [key, rows] of Object.entries(groups)) {
    const withCaps = rows.filter((x) => x.caps_match != null);
    const withNow = rows.filter((x) => x.now_match != null);
    const gaps = withCaps.map((x) => x.caps_gap).filter((v) => v != null).sort((a, b) => a - b);
    const nowGaps = withNow.map((x) => x.now_gap).filter((v) => v != null).sort((a, b) => a - b);
    const ranks = rows.map((x) => x.sec_caps_rank).filter((v) => v != null);
    quality[key] = {
      n: rows.length,
      caps_match: withCaps.filter((x) => x.caps_match).length,
      caps_match_pct: pct(withCaps.filter((x) => x.caps_match).length, withCaps.length),
      now_match: withNow.filter((x) => x.now_match).length,
      now_match_pct: pct(withNow.filter((x) => x.now_match).length, withNow.length),
      caps_gap_mean: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
      caps_gap_median: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
      now_gap_mean: nowGaps.length ? nowGaps.reduce((a, b) => a + b, 0) / nowGaps.length : null,
      sec_caps_rank_mean: ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null,
      sec_caps_rank_top3: pct(ranks.filter((v) => v <= 3).length, ranks.length),
    };
    console.log(`${key}: n=${rows.length} · sekundaer = bedste anden rolle paa LOFTER ${quality[key].caps_match_pct} · paa DAGENS EVNER ${quality[key].now_match_pct} · snit-gab paa lofter ${quality[key].caps_gap_mean?.toFixed(1)} point · sekundaerens gennemsnitlige loft-rang ${quality[key].sec_caps_rank_mean?.toFixed(2)}`);
  }

  // ── 2. Byg rolle-kort + vaegttabeller for C5a/C5b/C5c ──────────────────────
  mkdirSync(OUT_DIR, { recursive: true });
  const byId = new Map(riders.map((r) => [r.id, r]));
  const variants = {
    C5a: (r) => r.secondary_type,
    C5b: (r) => capsRole[r.id] ?? r.secondary_type,
    C5c: (r) => (drawn(r) ? r.secondary_type : (capsRole[r.id] ?? r.secondary_type)),
  };

  for (const [tag, pick] of Object.entries(variants)) {
    const table = { ...RECIPES };
    const map = {};
    const samples = [];
    let pairs = 0;
    let differsFromSecondary = 0;
    for (const s of art.samples) {
      const r = byId.get(s.rider_id);
      const primary = s.primary_type;
      const other = r ? pick(r) : null;
      let key = primary;
      if (other && other !== primary && RECIPES[other]) {
        key = `${primary}|${other}`;
        if (!table[key]) { table[key] = blendRecipes(primary, other, BLEND); pairs++; }
        if (r && other !== r.secondary_type) differsFromSecondary++;
      }
      map[s.rider_id] = key;
      samples.push({ ...s, value_role: key });
    }
    // Rolle-kortet skal daekke HELE populationen (ikke kun sim-samplet), fordi
    // baade fordelings-forankringen og toerkoerslen loeber over alle ryttere.
    for (const r of riders) {
      if (r.is_retired || map[r.id]) continue;
      const other = pick(r);
      if (other && other !== r.primary_type && RECIPES[other]) {
        const key = `${r.primary_type}|${other}`;
        if (!table[key]) { table[key] = blendRecipes(r.primary_type, other, BLEND); pairs++; }
        map[r.id] = key;
      } else map[r.id] = r.primary_type;
    }
    writeFileSync(join(OUT_DIR, `sample-${tag}.json`), JSON.stringify({ ...art, samples }), "utf8");
    writeFileSync(join(OUT_DIR, `weights-${tag}.json`), JSON.stringify(table, null, 2) + "\n", "utf8");
    writeFileSync(join(OUT_DIR, `role-map-${tag}.json`), JSON.stringify(map), "utf8");
    console.log(`${tag}: ${pairs} par-opskrifter · anden rolle afviger fra secondary_type for ${differsFromSecondary} i samplet.`);
  }

  // ── 3. Forklarbarhed: hviler prisen paa en rolle der ikke staar som badge? ──
  let hidden = 0;
  let hiddenHuman = 0;
  for (const r of riders) {
    if (r.is_retired) continue;
    const other = capsRole[r.id];
    if (other && other !== r.primary_type && other !== r.secondary_type) {
      hidden++;
      if (isHuman(r)) hiddenHuman++;
    }
  }
  console.log(`Forklarbarhed (C5b): ${hidden} ryttere (${hiddenHuman} paa menneskehold) ville faa 30 % af prisen paa en rolle der IKKE staar som badge.`);

  if (REPORT) {
    const L = [];
    L.push("# #5443 runde 4 — hvor god er sekundær-rollen?");
    L.push("");
    L.push(`Kohorte-skillet er målt, ikke antaget: \`created_at\` ≥ ${DRAWN_FROM} = trukket mod den jævne fordeling (#3800/#3631); før = klassifikatoren udfyldte feltet og #3593 frøs gættet i \`archetype_draw\`.`);
    L.push("");
    L.push("## 1. Kvalitet af `secondary_type` (menneskehold)");
    L.push("");
    L.push("| Gruppe | n | = bedste anden rolle på LOFTER | = bedste anden rolle på DAGENS EVNER | snit-gab på lofter (rating-point) | sekundærens gns. loft-rang (1-8) | i loft-top-3 |");
    L.push("|---|--:|--:|--:|--:|--:|--:|");
    for (const [k, q] of Object.entries(quality)) {
      L.push(`| ${k} | ${q.n} | ${q.caps_match_pct} | ${q.now_match_pct} | ${q.caps_gap_mean?.toFixed(1) ?? "—"} (median ${q.caps_gap_median?.toFixed(1) ?? "—"}) | ${q.sec_caps_rank_mean?.toFixed(2) ?? "—"} | ${q.sec_caps_rank_top3} |`);
    }
    L.push("");
    L.push("**Er lofterne formet af sekundæren?** `buildCapsForRider` (`backend/lib/riderProgression.js:746`) → `buildYouthCaps(potentiale, primaryType, secondaryType)`: sekundæren løfter sine egne evners lofter. Er den gennemsnitlige loft-rang klart bedre end 4,5 (midten af otte roller), er formningen reel — også for den gruppe hvor feltet oprindeligt var et klassifikator-gæt, fordi gættet blev frosset ned og derefter HAR formet lofterne.");
    L.push("");
    L.push("## 2. Forklarbarhed");
    L.push("");
    L.push(`Under C5b ville **${hidden} ryttere** (${hiddenHuman} på menneskehold) få 30 % af prisen på en rolle der hverken er deres primære eller deres sekundære — altså en rolle der ikke står nogen steder på rytterkortet.`);
    L.push("");
    L.push("## 3. Loft-stabilitet");
    L.push("");
    L.push("`buildCapsForRider` afhænger kun af potentiale, alder, primær og sekundær — **ikke** af dagens evner (`abilities` er med i signaturen, men bruges ikke; se kommentaren i `riderProgression.js:740-745`). Et loft flytter sig derfor kun ved aldring (sæsonskiftet) eller en regelændring, aldrig ved træning. En rolle valgt på lofter kan dermed ikke vippe fra uge til uge — modsat D-049's bedste-rolle-nu.");
    mkdirSync(dirname(resolve(REPORT)), { recursive: true });
    writeFileSync(resolve(REPORT), L.join("\n") + "\n", "utf8");
    console.log(`✅ Skrev rapport: ${resolve(REPORT)}`);
  }
  console.log("\nINTET er skrevet til databasen.");
}

main().catch((e) => {
  console.error("❌", e.message);
  console.error(e.stack);
  process.exit(1);
});
