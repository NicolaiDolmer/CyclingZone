// #7801 svartid: maal Traening-fladens tal (fatigueOutlookForTeam) med kontakten tvunget tændt, kun
// laesning. Sporet koerer IKKE scriptet mod prod; ejeren eller hovedsessionen goer det uden for
// etape-vinduet (HH:57 til HH:03), foer tænd-kortet laves.
//
// Kun laesning, haandhaevet i processen: klientens fetch afviser alt andet end GET og HEAD, ogsaa fra
// moduler, der laver deres egen forespoergsel gennem klienten. Tæller blokerede skrivninger (skal vaere 0).
// Kontakten fatigue_now_7801 tvinges tændt kun i processen: den rigtige forespoergsel sendes stadig
// (tiden er med), men svaret skiftes til "on". app_config roeres ikke.
//
// Output er kun antal og tider (aggregater): ingen rytter-, hold- eller brugeroplysninger.
//
// Brug (credentials hentes af Infisical, aldrig vist):
//   infisical run --env=prod --silent -- node backend/scripts/dev/measure7801Svartid.mjs --team <team_id> [--runs 20] [--off]
//
// --off  maaler med kontakten som den staar (prod: slukket) i stedet for tvunget tændt.

import { createClient } from "@supabase/supabase-js";

import { fatigueOutlookForTeam } from "../../lib/riderFatigueNow.js";

const args = process.argv.slice(2);
const flag = (name) => args.indexOf(name);
const option = (name, fallback = null) => (flag(name) >= 0 ? args[flag(name) + 1] : fallback);
const teamId = option("--team");
const runs = Math.max(1, Number(option("--runs", 20)) || 20);
const forceOn = flag("--off") < 0;
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

if (!teamId || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("brug: infisical run --env=prod --silent -- node backend/scripts/dev/measure7801Svartid.mjs --team <team_id> [--runs 20] [--off]");
  process.exit(2);
}

const stats = { calls: 0, blocked: 0 };
const realFetch = globalThis.fetch;
const guardedFetch = async (input, init = {}) => {
  const method = String(init.method ?? (typeof input === "object" && input?.method) ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    stats.blocked += 1;
    throw new Error(`maaleren afviste ${method}: kun laesning`);
  }
  stats.calls += 1;
  const url = String(typeof input === "string" ? input : input?.url ?? input);
  const response = await realFetch(input, init);
  if (forceOn && url.includes("/rest/v1/app_config") && url.includes("key=eq.fatigue_now_7801")) {
    const accept = String(new Headers(init.headers ?? {}).get("accept") ?? "");
    const body = accept.includes("vnd.pgrst.object") ? { value: "on" } : [{ value: "on" }];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }
  return response;
};

const makeClient = () => createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, global: { fetch: guardedFetch } });

const setup = makeClient();
const get = async (query, label) => {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
};
const [team] = await get(setup.from("teams").select("id, league_division_id").eq("id", teamId).limit(1), "team");
if (!team) throw new Error("holdet findes ikke");
const [season] = await get(setup.from("seasons").select("id").eq("status", "active").limit(1), "saeson");
const riderIds = (await get(setup.from("riders").select("id").eq("team_id", teamId).eq("is_retired", false), "ryttere")).map((r) => r.id);
const conditions = await get(setup.from("rider_condition").select("*").in("rider_id", riderIds), "tilstande");
const abilities = await get(setup.from("rider_derived_abilities").select("*").in("rider_id", riderIds), "evner");
const abilityByRider = new Map(abilities.map((row) => [row.rider_id, row]));

const times = []; const calls = [];
for (let i = 0; i < runs; i += 1) {
  const before = stats.calls;
  const started = performance.now();
  await fatigueOutlookForTeam({ supabase: makeClient(), team, seasonId: season?.id ?? null, conditions, abilityByRider, now: new Date() });
  times.push(performance.now() - started);
  calls.push(stats.calls - before);
}
const sorted = [...times].sort((a, b) => a - b);
const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
console.log(JSON.stringify({
  kontakt: forceOn ? "tvunget tændt i processen" : "som den staar",
  ryttere: riderIds.length,
  gentagelser: runs,
  kald_pr_gentagelse: { min: Math.min(...calls), max: Math.max(...calls) },
  ms: { median: Math.round(pick(0.5)), p95: Math.round(pick(0.95)), vaerst: Math.round(sorted.at(-1)) },
  blokerede_skrivninger: stats.blocked,
}, null, 2));
