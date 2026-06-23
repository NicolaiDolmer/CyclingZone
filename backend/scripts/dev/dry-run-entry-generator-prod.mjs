// Read-only verifikation af Race Hub Fase 0b (#1810): kør den proaktive entry-generator
// (runRaceEntryGenerator) mod den AKTIVE prod-sæson og bekræft empirisk de tre påstande
// — pulje-respekt, binding (én rytter pr. tidsvindue), og at manuelle entries ALDRIG røres.
//
// Sikkerhed: en "capture"-klient wrapper service-role-klienten. READS passerer uændret til
// prod; ENHVER write (insert/delete/update/upsert/rpc) er en no-op der KUN logges. Vi kan
// derfor køre generatoren med dryRun=false for at fange de FAKTISKE staged-rows den ville
// skrive — uden at røre prod. (dryRun=true springer writes helt over → vi ser ikke rows.)
//
// Kør: infisical run --env=prod -- node backend/scripts/dev/dry-run-entry-generator-prod.mjs
import { createClient } from "@supabase/supabase-js";
import { runRaceEntryGenerator } from "../../lib/raceEntryGenerator.js";
import { raceTimeWindow, windowsOverlap } from "../../lib/raceBinding.js";
import { selectionSizeForRace } from "../../lib/raceAutopick.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (kør via infisical run --env=prod)");
  process.exit(1);
}
const real = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Capture-klient: read pass-through, write no-op (+ log inserts) ───────────────
const captured = { inserts: [], blockedWrites: [] };
function noopChain(table, kind) {
  const chain = {
    eq: () => chain, in: () => chain, neq: () => chain, or: () => chain, match: () => chain,
    then: (resolve) => { captured.blockedWrites.push({ table, kind }); return resolve({ data: null, error: null }); },
  };
  return chain;
}
const captureClient = {
  from(table) {
    const realBuilder = real.from(table);
    return new Proxy(realBuilder, {
      get(t, prop) {
        if (prop === "insert") return (rows) => {
          const arr = Array.isArray(rows) ? rows : [rows];
          captured.inserts.push(...arr);
          captured.blockedWrites.push({ table, kind: "insert", rows: arr.length });
          return Promise.resolve({ data: null, error: null });
        };
        if (prop === "delete") return () => noopChain(table, "delete");
        if (prop === "update") return () => noopChain(table, "update");
        if (prop === "upsert") return () => { captured.blockedWrites.push({ table, kind: "upsert" }); return Promise.resolve({ data: null, error: null }); };
        const v = t[prop];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  },
  rpc: () => { captured.blockedWrites.push({ table: "(rpc)", kind: "rpc" }); return Promise.resolve({ data: null, error: null }); },
};

// ── 1. Aktiv sæson ──────────────────────────────────────────────────────────────
const { data: season, error: sErr } = await real
  .from("seasons").select("id, number, status, start_date").eq("status", "active").maybeSingle();
if (sErr) { console.error("seasons:", sErr.message); process.exit(1); }
if (!season) { console.error("ingen aktiv sæson"); process.exit(1); }
console.log(`Aktiv sæson: #${season.number} (${season.id}) start=${season.start_date}\n`);

// ── 2. Kør generatoren med dryRun=false MOD CAPTURE-KLIENTEN (intet skrives) ──────
const res = await runRaceEntryGenerator({ supabase: captureClient, seasonId: season.id, dryRun: false });
console.log("=== GENERATOR-RESULTAT (officielle aggregater) ===");
console.log(JSON.stringify({ races: res.races, teams: res.teams, generated: res.generated, skipped: res.skipped }, null, 2));

// Hård sikkerheds-gate: kun race_entries må overhovedet have fået write-forsøg, og alle blev fanget.
const writeTables = [...new Set(captured.blockedWrites.map((w) => w.table))];
console.log(`\nFangede write-forsøg (alle no-op, intet skrevet): ${captured.blockedWrites.length} på tabeller [${writeTables.join(", ")}]`);
if (writeTables.some((tbl) => tbl !== "race_entries")) {
  console.error(`⚠️  Uventet write-mål: ${writeTables.join(", ")} — generatoren rører kun race_entries. STOP.`);
  process.exit(1);
}

// Sanity: returneret generated-tal == antal fangede insert-rows.
const insertedRows = captured.inserts;
const sanityOk = insertedRows.length === res.generated;
console.log(`Sanity: fangede insert-rows (${insertedRows.length}) === res.generated (${res.generated}) → ${sanityOk ? "OK" : "MISMATCH"}`);

// ── 3. Læs prod-kontekst til uafhængig krydstjek ────────────────────────────────
const { data: races } = await real
  .from("races").select("id, race_class, league_division_id").eq("season_id", season.id);
const raceById = new Map(races.map((r) => [r.id, r]));
const raceIds = races.map((r) => r.id);

async function readAllIn(table, columns, inColumn, ids) {
  const out = []; const CH = 200;
  for (let i = 0; i < ids.length; i += CH) {
    const { data, error } = await real.from(table).select(columns).in(inColumn, ids.slice(i, i + CH));
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}
const schedRows = await readAllIn("race_stage_schedule", "race_id, scheduled_at", "race_id", raceIds);
const schedByRace = new Map();
for (const s of schedRows) { if (!schedByRace.has(s.race_id)) schedByRace.set(s.race_id, []); schedByRace.get(s.race_id).push(s); }
const windowByRace = new Map(raceIds.map((id) => [id, raceTimeWindow(schedByRace.get(id))]));

// Eligible teams (samme filter som generatoren) → pulje-lookup.
const { data: allTeams } = await real
  .from("teams").select("id, is_test_account, is_frozen, league_division_id").or("is_test_account.is.null,is_test_account.eq.false");
const eligibleTeams = (allTeams || []).filter((t) => !t.is_frozen);
const teamDivision = new Map(eligibleTeams.map((t) => [t.id, t.league_division_id ?? null]));

// Manuelle entries (is_auto_filled=false) → (race,team)-sæt.
const entryRows = await readAllIn("race_entries", "race_id, team_id, is_auto_filled", "race_id", raceIds);
const manualRaceTeam = new Set();
for (const e of entryRows) if (e.is_auto_filled === false) manualRaceTeam.add(`${e.race_id}|${e.team_id}`);

// Afmeldinger → (race,team)-sæt.
const wRows = await readAllIn("race_withdrawals", "race_id, team_id", "race_id", raceIds);
const withdrawnRaceTeam = new Set(wRows.map((w) => `${w.race_id}|${w.team_id}`));

// ── 4. Verifikation på de FAKTISKE staged-rows ──────────────────────────────────
let poolViolations = 0, manualViolations = 0, bindingViolations = 0;
const bindingByTeam = new Map(); // team_id → [{rider_id, window}]
for (const row of insertedRows) {
  const race = raceById.get(row.race_id);
  // (a) Pulje-respekt: holdets pulje == løbets pulje.
  if ((teamDivision.get(row.team_id) ?? null) !== (race?.league_division_id ?? null)) poolViolations++;
  // (c) Manuel-respekt: en staged (race,team) må ALDRIG være et manuelt par.
  if (manualRaceTeam.has(`${row.race_id}|${row.team_id}`)) manualViolations++;
  // (b) Binding-data: saml rytter+vindue pr. hold.
  if (!bindingByTeam.has(row.team_id)) bindingByTeam.set(row.team_id, []);
  bindingByTeam.get(row.team_id).push({ rider_id: row.rider_id, window: windowByRace.get(row.race_id) });
}
// (b) Binding-tjek: samme rytter må ikke optræde i to overlappende vinduer (samme hold).
for (const [, picks] of bindingByTeam) {
  const byRider = new Map();
  for (const p of picks) { if (!byRider.has(p.rider_id)) byRider.set(p.rider_id, []); byRider.get(p.rider_id).push(p.window); }
  for (const [, windows] of byRider) {
    for (let i = 0; i < windows.length; i++)
      for (let j = i + 1; j < windows.length; j++)
        if (windowsOverlap(windows[i], windows[j])) bindingViolations++;
  }
}

// Krydstjek af skipped: forventede skips = (manuelle + afmeldte) (race,team)-par der ligger i
// et puljeløb MED vindue, et eligible hold, OG hvor holdets pulje == løbets pulje (kun dem
// generatoren faktisk vurderer — den ser kun et holds egne pulje-løb). Cross-pool manuelle par
// (fx hold der flyttede pulje via op/nedrykning efter en udtagelse) tælles IKKE — generatoren
// rører dem heller ikke, men flagges separat som datakvalitets-note.
const usableRaceIds = new Set(raceIds.filter((id) => windowByRace.get(id)));
function relevantSkips(set) {
  let n = 0;
  for (const key of set) {
    const [rid, tid] = key.split("|");
    if (!usableRaceIds.has(rid) || !teamDivision.has(tid)) continue;
    if ((teamDivision.get(tid) ?? null) === (raceById.get(rid)?.league_division_id ?? null)) n++;
  }
  return n;
}
const expectedSkips = relevantSkips(manualRaceTeam) + relevantSkips(withdrawnRaceTeam);
// Cross-pool manuelle par: usable race + eligible team, men pulje matcher ikke.
const crossPoolManual = [];
for (const key of manualRaceTeam) {
  const [rid, tid] = key.split("|");
  if (!usableRaceIds.has(rid) || !teamDivision.has(tid)) continue;
  if ((teamDivision.get(tid) ?? null) !== (raceById.get(rid)?.league_division_id ?? null)) crossPoolManual.push(key);
}

// ── 5. Felt-fyldnings-preview (motiverer 0c) ────────────────────────────────────
const teamsByPool = new Map();
for (const t of eligibleTeams) { const k = t.league_division_id ?? null; teamsByPool.set(k, (teamsByPool.get(k) || 0) + 1); }
const picksPerRaceTeam = new Map();
for (const r of insertedRows) picksPerRaceTeam.set(`${r.race_id}|${r.team_id}`, (picksPerRaceTeam.get(`${r.race_id}|${r.team_id}`) || 0) + 1);
// Pr. løb: hold der stillede ≥1 rytter vs. fuldt hold (kategoriens min-størrelse), ud af
// puljens eligible hold. "Fuldt" er den reelle knaphed bund-ryttere skal afhjælpe.
let slotsExpected = 0, slotsAny = 0, slotsFull = 0;
for (const r of races) {
  if (!usableRaceIds.has(r.id)) continue;
  const poolTeams = teamsByPool.get(r.league_division_id ?? null) || 0;
  const minSize = selectionSizeForRace(r)?.min ?? 6;
  let any = 0, full = 0;
  for (const [key, n] of picksPerRaceTeam) {
    if (!key.startsWith(`${r.id}|`)) continue;
    any++; if (n >= minSize) full++;
  }
  slotsExpected += poolTeams; slotsAny += any; slotsFull += full;
}
const pct = (n) => slotsExpected ? Math.round(100 * n / slotsExpected) : 0;

// ── 6. Verdict ──────────────────────────────────────────────────────────────────
console.log("\n=== UAFHÆNGIG KRYDSTJEK (på faktiske staged-rows) ===");
console.log(`Pulje-respekt:   ${poolViolations} brud (hold↔løb i forskellig pulje)`);
console.log(`Binding:         ${bindingViolations} brud (samme rytter i to overlappende løb)`);
console.log(`Manuel-respekt:  ${manualViolations} brud (auto-row på et manuelt (race,team))`);
console.log(`Skipped-match:   res.skipped=${res.skipped} vs forventet=${expectedSkips} → ${res.skipped === expectedSkips ? "OK" : "AFVIGER"}`);
console.log(`  (pulje-matchede manuelle=${relevantSkips(manualRaceTeam)}, afmeldte=${relevantSkips(withdrawnRaceTeam)}; cross-pool manuelle (urørt, ej skip)=${crossPoolManual.length})`);

console.log("\n=== FELT-FYLDNING (preview — uden bund-ryttere) ===");
console.log(`Hold-slots på tværs af alle puljeløb (ud af ${slotsExpected} eligible hold×løb):`);
console.log(`  ≥1 rytter:   ${slotsAny}/${slotsExpected} (${pct(slotsAny)}%)`);
console.log(`  FULDT hold:  ${slotsFull}/${slotsExpected} (${pct(slotsFull)}%)  ← reel knaphed bund-ryttere skal løfte`);
console.log("(Manglende fuldt-hold = binding tager rytterne / for få ryttere → motiverer 0c.)");

const allPass = poolViolations === 0 && bindingViolations === 0 && manualViolations === 0 && sanityOk && res.skipped === expectedSkips;
console.log(`\n${allPass ? "✅ 0b VERIFICERET" : "❌ 0b-VERIFIKATION FEJLEDE"} — intet skrevet til prod (alle writes fanget no-op).`);
process.exit(allPass ? 0 : 1);
