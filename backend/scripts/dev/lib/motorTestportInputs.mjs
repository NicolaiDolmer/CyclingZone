// #6909: motor-testportens input ud over prod's egne data.
//
//   --synthetic-field[=generator|bench]  loeb uden tilmeldinger faar et startfelt i
//       hukommelsen: tilmeldingsgeneratoren koert som dry-run paa de nuvaerende
//       trupper (intet skrives), eller det anonymiserede Giro-bench-felt.
//   --routes-from=<mappe>                foreslaaede ruter (race_stage_profiles-formen,
//       se ROUTES_FORMAT) i stedet for prod's nuvaerende etapeprofiler.
//
// Begge dele bygger loebets cache.json (tourDryRun-formen {race, profiles, entries,
// orders, teams, abilities}) i loebsmappen, som tourDryRun saa laeser. Prod laeses
// kun (SELECT): klienten til generatoren afviser enhver skrivning (readOnlyDb).
//
// Formatet for --routes-from staar i docs/MOTOR_TESTPORT.md ("Foreslaaede ruter").
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { raceBindingWindow } from "../../../lib/raceBinding.js";
import { ABILITY_KEYS } from "../../../lib/raceSimulator.js";

export const ROUTES_FORMAT = "cz-race-routes/v1";
export const SYNTHETIC_KINDS = Object.freeze(["generator", "bench"]);

/** Kolonnerne i race_stage_profiles; en rute-fil maa ikke have andre (stavefejl fanges). */
export const PROFILE_COLUMNS = Object.freeze([
  "id", "race_id", "stage_number", "profile_type", "finale_type", "demand_vector", "generator_version",
  "is_manual", "generated_at", "distance_km", "elevation_gain_m", "climbs", "sprints", "sectors",
  "segments", "weather", "elevation_profile",
]);
const PROFILE_COLUMN_SET = new Set(PROFILE_COLUMNS);

export const FIELD_NOTES = Object.freeze({
  generator: "tilmeldingsgeneratoren som dry-run i hukommelsen (intet skrevet): alle hold i puljen udtaget af assistenten, ligesom redningen ved etape 1; nuvaerende trupper og divisioner (foer op- og nedrykning); ingen holdordrer",
  bench: "det anonymiserede Giro-bench-felt (samme felt i alle loeb, ikke de rigtige puljer); ingen holdordrer",
});

/**
 * Valider én rute-fil (fail-closed). Returnerer etaperne sorteret paa stage_number,
 * stemplet med loebets id. `fileRaceId` er filnavnet uden .json.
 */
export function validateRouteDoc(doc, fileRaceId) {
  const where = `${fileRaceId}.json`;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error(`${where}: skal vaere et JSON-objekt`);
  if (doc.format !== ROUTES_FORMAT) throw new Error(`${where}: format skal vaere "${ROUTES_FORMAT}" (fik ${JSON.stringify(doc.format)})`);
  if (doc.race_id !== fileRaceId) throw new Error(`${where}: race_id (${doc.race_id}) skal vaere lig filnavnet`);
  if (!Array.isArray(doc.profiles) || doc.profiles.length === 0) throw new Error(`${where}: profiles skal vaere en ikke-tom liste`);
  if (!Number.isInteger(doc.stages) || doc.stages !== doc.profiles.length) throw new Error(`${where}: stages (${doc.stages}) skal vaere antallet af profiles (${doc.profiles.length})`);
  const profiles = doc.profiles.map((p, i) => {
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error(`${where}: profiles[${i}] skal vaere et objekt`);
    const unknown = Object.keys(p).filter((k) => !PROFILE_COLUMN_SET.has(k));
    if (unknown.length) throw new Error(`${where}: profiles[${i}] har ukendte kolonner: ${unknown.join(", ")}`);
    if (p.race_id !== undefined && p.race_id !== fileRaceId) throw new Error(`${where}: profiles[${i}].race_id passer ikke til filen`);
    if (typeof p.profile_type !== "string" || !p.profile_type) throw new Error(`${where}: profiles[${i}].profile_type mangler`);
    // #6909 (Codex P2): generatoren udtager feltet efter etapens krav (demand_vector); uden
    // dem bliver alle egnetheder 0, og feltet vaelges reelt efter rytter-id.
    const dv = p.demand_vector;
    if (!dv || typeof dv !== "object" || Array.isArray(dv)) throw new Error(`${where}: profiles[${i}].demand_vector mangler`);
    // #6909 (Codex P2): kun kendte evner (+ randomness); en stavefejl giver ellers stille 0-egnethed.
    const unknownDims = Object.keys(dv).filter((k) => k !== "randomness" && !ABILITY_KEYS.includes(k));
    if (unknownDims.length) throw new Error(`${where}: profiles[${i}].demand_vector har ukendte evner: ${unknownDims.join(", ")}`);
    if (Object.values(dv).some((v) => !Number.isFinite(v) || v < 0)) throw new Error(`${where}: profiles[${i}].demand_vector skal vaere ikke-negative tal`);
    if (!Object.entries(dv).some(([k, v]) => k !== "randomness" && v > 0)) throw new Error(`${where}: profiles[${i}].demand_vector skal have mindst én evne > 0`);
    return { ...p, race_id: fileRaceId };
  }).sort((a, b) => a.stage_number - b.stage_number);
  profiles.forEach((p, i) => {
    if (p.stage_number !== i + 1) throw new Error(`${where}: stage_number skal vaere 1..${profiles.length} uden huller eller dubletter`);
  });
  return profiles;
}

/**
 * En rute-mappe: én <race_id>.json pr. loeb + valgfri manifest.json. Hele mappen
 * valideres foer noget koeres; én fejl stopper koerslen.
 */
export function loadRoutesDir(dir) {
  if (!existsSync(dir)) throw new Error(`--routes-from: ${dir} findes ikke`);
  const manifestFile = path.join(dir, "manifest.json");
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : null;
  if (manifest && manifest.format !== ROUTES_FORMAT) throw new Error(`manifest.json: format skal vaere "${ROUTES_FORMAT}"`);
  const byRace = new Map();
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "manifest.json").sort();
  for (const file of files) {
    const raceId = file.slice(0, -".json".length);
    byRace.set(raceId, validateRouteDoc(JSON.parse(readFileSync(path.join(dir, file), "utf8")), raceId));
  }
  if (!byRace.size) throw new Error(`--routes-from: ${dir} har ingen <race_id>.json`);
  return { dir, label: manifest?.label ?? null, manifest, byRace, signature: routesSignature(dir, files, manifestFile) };
}

/**
 * #6909 (Codex P2): indholds-fingeraftryk af rute-mappen (manifest + alle <race_id>.json),
 * saa en genoptaget koersel aldrig stille bruger ruter der er aendret siden.
 */
export function routesSignature(dir, files, manifestFile = path.join(dir, "manifest.json")) {
  const h = createHash("sha256");
  if (existsSync(manifestFile)) h.update(`manifest\0`).update(readFileSync(manifestFile));
  for (const f of [...files].sort()) h.update(`\0${f}\0`).update(readFileSync(path.join(dir, f)));
  return h.digest("hex").slice(0, 16);
}

/** Hvert loeb i udvaelgelsen skal have en rute-fil (fail-closed, aldrig stille prod-ruter). */
export function assertRoutesCover(raceIds, routes) {
  const missing = raceIds.filter((id) => !routes.byRace.has(id));
  if (missing.length) throw new Error(`--routes-from mangler rute for ${missing.length} loeb: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " ..." : ""}`);
}

/** Loebets data med de foreslaaede etaper. Antallet skal passe med loebets stages. */
export function applyRoutes(data, profiles) {
  const stages = data.race?.stages;
  if (Number.isInteger(stages) && stages !== profiles.length) {
    throw new Error(`${data.race.id}: rute har ${profiles.length} etaper, loebet har ${stages}`);
  }
  return { ...data, profiles: profiles.map((p) => ({ ...p })) };
}

/**
 * Generatorens dry-run-tildeling (`staged`) som startlister pr. loeb. Foerste
 * forekomst af en rytter i et loeb vinder (samme dedup som skrivelaget).
 */
export function entriesFromStaged(staged = []) {
  const byRace = new Map();
  const seen = new Map();
  for (const unit of staged) {
    if (!byRace.has(unit.race_id)) { byRace.set(unit.race_id, []); seen.set(unit.race_id, new Set()); }
    const ids = seen.get(unit.race_id);
    for (const p of unit.picks ?? []) {
      if (ids.has(p.rider_id)) continue;
      ids.add(p.rider_id);
      byRace.get(unit.race_id).push({ rider_id: p.rider_id, team_id: unit.team_id, race_role: p.race_role ?? null });
    }
  }
  for (const [id, list] of byRace) if (!list.length) byRace.delete(id);
  return byRace;
}

/** Loebet med et (syntetisk) felt: startliste, hold og evner fra `field`, ingen holdordrer. */
export function withField(data, field) {
  return { ...data, entries: field.entries, teams: field.teams, abilities: field.abilities, orders: [] };
}

/** Prod-klient der kun kan laese: insert/update/upsert/delete og rpc kaster. */
export function readOnlyDb(db, { overlay = null, overlays = [] } = {}) {
  const WRITES = new Set(["insert", "update", "upsert", "delete"]);
  // #6909 (Codex P2): lag oven paa prod's raekker, kun i hukommelsen.
  //  - { table, key, rowsByKey: Map }: prod-raekkerne for de noegler erstattes af de
  //    foreslaaede (én gang pr. noegle, ogsaa hvis et loeb deles over flere sider).
  //  - { table, key, excludeKeys: Set }: raekker med de noegler skjules (fx ryttere der
  //    allerede er bundet i et overlappende loeb), saa generatoren udtager andre.
  //  - { table, key, keepKeys: Set }: kun raekker med de noegler beholdes, resten fjernes helt.
  //    Samme forbehold som dropKeys.
  //  - { table, key, dropKeys: Set }: raekker fjernes helt. KUN til ikke-paginerede laesninger
  //    (generatorens races-select er én .eq("season_id")); en afkortet side stopper en pagineret laeser.
  const layers = [...(overlay ? [overlay] : []), ...overlays.filter(Boolean)];
  const injected = new Map(layers.map((l) => [l, new Set()]));
  const swapFor = (table, state) => {
    const mine = layers.filter((l) => l.table === table);
    if (!mine.length) return null;
    return (rows) => {
      if (!Array.isArray(rows)) return rows;
      let cur = rows;
      for (const l of mine) {
        const out = [];
        const prodCount = cur.length;
        for (const r of cur) {
          const k = r?.[l.key];
          if (l.dropKeys) { if (!l.dropKeys.has(k)) out.push(r); continue; }
          if (l.keepKeys) { if (l.keepKeys.has(k)) out.push(r); continue; }
          // #6909 (Codex P2): en skjult raekke fjernes IKKE (det ville afkorte siden og faa en
          // pagineret laeser til at stoppe for tidligt); den beholdes, men "frakobles" via nullField
          // (fx team_id = null), saa generatoren ikke kan udtage rytteren.
          if (l.excludeKeys) {
            if (!l.excludeKeys.has(k)) out.push(r);
            else if (l.nullField) out.push({ ...r, [l.nullField]: null });
            continue;
          }
          if (!l.rowsByKey.has(k)) { out.push(r); continue; }
          const done = injected.get(l);
          if (done.has(k)) continue;
          done.add(k);
          out.push(...l.rowsByKey.get(k));
        }
        // #6909 (Codex P2): et loeb uden prod-raekker (fx et S5-loeb foer etaperne er skrevet)
        // faar ogsaa de foreslaaede raekker, naar laeseren eksplicit bad om noeglen (.in/.eq paa
        // key). Pagineret: kun paa sidste side (faerre prod-raekker end siden), saa intet dubleres.
        if (l.rowsByKey) {
          const asked = state.keys.get(l.key);
          const lastPage = !state.range || prodCount < state.range.to - state.range.from + 1;
          if (asked && lastPage) {
            const done = injected.get(l);
            for (const k of asked) {
              if (done.has(k) || !l.rowsByKey.has(k)) continue;
              done.add(k);
              out.push(...l.rowsByKey.get(k));
            }
          }
        }
        cur = out;
      }
      return cur;
    };
  };
  // Kaedens filtre paa noeglekolonner (.in/.eq) og .range() huskes, saa et lag ved hvilke noegler
  // laeseren bad om. Én tilstand pr. db.from(...)-kaede.
  const track = (state, p, args) => {
    if (p === "in" && Array.isArray(args[1])) state.keys.set(args[0], new Set(args[1]));
    else if (p === "eq") state.keys.set(args[0], new Set([args[1]]));
    else if (p === "range") state.range = { from: args[0], to: args[1] };
  };
  const wrap = (builder, table, state = { keys: new Map(), range: null }) => new Proxy(builder, {
    get(b, p) {
      if (WRITES.has(p)) return () => { throw new Error(`read-only (#6909): ${String(p)} paa ${table} afvist`); };
      const swap = p === "then" ? swapFor(table, state) : null;
      if (swap) {
        return (resolve, reject) => b.then((res) => resolve(res && !res.error ? { ...res, data: swap(res.data) } : res), reject);
      }
      const v = b[p];
      if (typeof v !== "function") return v;
      // #6909 (Codex P2): supabase-js returnerer et NYT builder-objekt fra fx .select(), saa
      // alt der er en builder (har .then), pakkes ind igen; ellers naar laget aldrig frem.
      return (...args) => {
        track(state, p, args);
        const r = v.apply(b, args);
        return r && typeof r === "object" && typeof r.then === "function" ? wrap(r, table, state) : r;
      };
    },
  });
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "rpc") return (fn) => { throw new Error(`read-only (#6909): rpc ${fn} afvist`); };
      if (prop === "from") return (table) => wrap(target.from(table), table);
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/**
 * Byg cache.json for de loeb der skal have andre input end prod's egne
 * (foreslaaede ruter og/eller syntetisk felt). Ren orkestrering; al I/O mod
 * prod gaar gennem `source` (injiceres i test):
 *   source.withField(ids)          -> Set af loeb med tilmeldinger
 *   source.raceData(ids)           -> Map id -> {race, profiles, entries, orders, teams, abilities}
 *   source.generatorField(ids)     -> Map id -> {entries, teams, abilities}  (kind=generator)
 *   source.benchField()            -> {entries, teams, abilities}            (kind=bench)
 * Med `fromDir` laeses loebets data fra eksportens cache.json i stedet for raceData.
 *
 * Returnerer {prebuilt: Set, ids (uden de loeb der ikke fik felt), field, routes}.
 * En eksisterende cache.json i loebsmappen genbruges (genoptagelse).
 */
export async function prepareInputs({ raceIds, outDir, fromDir = null, routes = null, synthetic = null, source = null }) {
  const cacheFile = (id) => path.join(outDir, "races", id, "cache.json");
  const exportFile = (id) => (fromDir ? path.join(fromDir, id, "cache.json") : null);
  const readExport = (id) => {
    const f = exportFile(id);
    return f && existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
  };
  const field = { kind: synthetic, note: synthetic ? FIELD_NOTES[synthetic] : null, prod: 0, synthetic: 0, skippedNoField: 0, skippedIds: [] };
  const routesMeta = routes ? { dir: path.basename(routes.dir), label: routes.label, races: 0 } : null;
  const prebuilt = new Set();
  if (!routes && !synthetic) return { prebuilt, ids: raceIds, field: null, routes: null };

  const fresh = raceIds.filter((id) => !existsSync(cacheFile(id)));
  const resumedAll = raceIds.filter((id) => existsSync(cacheFile(id)));
  const resumed = resumedAll;
  // #6909 (Codex P2): en cache skrevet med andre ruter (fx efter en afbrudt koersel, foer
  // meta-filen fandtes) genbruges aldrig; den bygges forfra.
  const staleIds = new Set(resumed.filter((id) => {
    const c = JSON.parse(readFileSync(cacheFile(id), "utf8"));
    // #6909 (Codex P2): samme ruter, men et andet syntetisk felt, er ogsaa en anden koersel.
    const fieldOk = c.fieldSource === "prod" || c.fieldSource === (synthetic ?? null);
    return (c.routesSignature ?? null) !== (routes?.signature ?? null) || !fieldOk;
  }));
  for (const id of resumed) {
    if (staleIds.has(id)) continue;
    prebuilt.add(id);
    const kind = JSON.parse(readFileSync(cacheFile(id), "utf8")).fieldSource ?? "prod";
    if (kind === "prod") field.prod += 1; else field.synthetic += 1;
  }
  fresh.push(...staleIds);

  // Hvilke loeb har allerede et felt (prod-tilmeldinger eller eksportens startliste)?
  let hasField;
  if (fromDir) hasField = new Set(fresh.filter((id) => (readExport(id)?.entries ?? []).length > 0));
  else hasField = fresh.length ? await source.withField(fresh) : new Set();

  // Loeb der skal bygges: alle med foreslaaede ruter, ellers kun dem der mangler felt.
  const build = routes ? fresh : fresh.filter((id) => !hasField.has(id));
  const passthrough = fresh.filter((id) => !build.includes(id)); // tourDryRun henter dem selv
  const needSynthetic = build.filter((id) => !hasField.has(id));

  let synthField = new Map();
  if (synthetic && needSynthetic.length) {
    if (synthetic === "bench") {
      const bench = await source.benchField();
      synthField = new Map(needSynthetic.map((id) => [id, bench]));
    } else {
      synthField = await source.generatorField(needSynthetic, { routesByRace: routes?.byRace ?? null });
    }
  }
  const dataById = fromDir
    ? new Map(build.map((id) => [id, readExport(id)]).filter(([, d]) => d))
    : (build.length ? await source.raceData(build) : new Map());

  const ids = [];
  for (const id of raceIds) {
    if (prebuilt.has(id) || passthrough.includes(id)) {
      ids.push(id);
      if (passthrough.includes(id) && hasField.has(id)) field.prod += 1;
      continue;
    }
    let data = dataById.get(id);
    if (!data) throw new Error(`${id}: loebet findes ikke (${fromDir ? "ingen cache.json i eksporten" : "prod"})`);
    let fieldSource = "prod";
    if (!hasField.has(id)) {
      const f = synthField.get(id);
      if (!f || !f.entries?.length) { field.skippedNoField += 1; field.skippedIds.push(id); continue; }
      data = withField(data, f);
      fieldSource = synthetic;
    }
    if (routes) data = applyRoutes(data, routes.byRace.get(id));
    mkdirSync(path.dirname(cacheFile(id)), { recursive: true });
    writeFileSync(cacheFile(id), JSON.stringify({ ...data, fieldSource, routesFrom: routesMeta?.dir ?? null, routesSignature: routes?.signature ?? null }));
    prebuilt.add(id);
    ids.push(id);
    if (fieldSource === "prod") field.prod += 1; else field.synthetic += 1;
  }
  if (routesMeta) routesMeta.races = ids.length;
  return { prebuilt, ids, field: synthetic ? field : { ...field, kind: null, note: null }, routes: routesMeta };
}

const CHUNK = 200;
const PAGE = 1000;

/** Alle raekker for `ids` i chunks af CHUNK, pagineret med .range() i sider af PAGE. */
async function selectByIds(db, table, columns, column, ids, orderBy) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    // pagination-safe: .range() i sider af PAGE med stabil ORDER BY
    for (let from = 0; ; from += PAGE) {
      let q = db.from(table).select(columns).in(column, chunk);
      for (const col of orderBy) q = q.order(col, { ascending: true });
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
  }
  return out;
}

const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); }
  return m;
};

/**
 * Prod-kilden til prepareInputs (READ-ONLY: kun SELECT; generatoren faar readOnlyDb).
 * `generatorRunner` kan injiceres (default: runRaceEntryGenerator).
 */
export function createProdSource(db, { generatorRunner = null, log = console.log } = {}) {
  const abilitiesFor = async (riderIds) => {
    const { ABILITY_KEYS } = await import("../../../lib/raceSimulator.js");
    return selectByIds(db, "rider_derived_abilities", ["rider_id", ...ABILITY_KEYS].join(", "), "rider_id", [...new Set(riderIds)], ["rider_id"]);
  };
  const teamsFor = async (teamIds) => selectByIds(db, "teams", "id, is_ai", "id", [...new Set(teamIds)].filter(Boolean), ["id"]);
  return {
    async withField(ids) {
      const rows = await selectByIds(db, "race_entries", "race_id, rider_id", "race_id", ids, ["race_id", "rider_id"]);
      return new Set(rows.map((r) => r.race_id));
    },
    async raceData(ids) {
      const races = await selectByIds(db, "races", "id, name, stages, squad, race_class, status, league_division_id", "id", ids, ["id"]);
      const profiles = groupBy(await selectByIds(db, "race_stage_profiles", "*", "race_id", ids, ["race_id", "stage_number"]), "race_id");
      const entries = groupBy(await selectByIds(db, "race_entries", "race_id, rider_id, team_id, race_role", "race_id", ids, ["race_id", "rider_id"]), "race_id");
      const orders = groupBy(await selectByIds(db, "race_team_orders", "team_id, race_id, stage_number, breakaway_stance, riders", "race_id", ids, ["race_id", "team_id", "stage_number"]), "race_id");
      const allEntries = [...entries.values()].flat();
      const teams = new Map((await teamsFor(allEntries.map((e) => e.team_id))).map((t) => [t.id, t]));
      const abilities = new Map((await abilitiesFor(allEntries.map((e) => e.rider_id))).map((a) => [a.rider_id, a]));
      const out = new Map();
      for (const race of races) {
        const es = (entries.get(race.id) ?? []).map(({ race_id: _r, ...e }) => e);
        out.set(race.id, {
          race,
          profiles: profiles.get(race.id) ?? [],
          entries: es,
          orders: orders.get(race.id) ?? [],
          teams: [...new Set(es.map((e) => e.team_id))].map((id) => teams.get(id)).filter(Boolean),
          abilities: es.map((e) => abilities.get(e.rider_id)).filter(Boolean),
        });
      }
      return out;
    },
    async generatorField(ids, { routesByRace = null } = {}) {
      const run = generatorRunner ?? (await import("../../../lib/raceEntryGenerator.js")).runRaceEntryGenerator;
      const races = await selectByIds(db, "races", "id, season_id", "id", ids, ["id"]);
      const out = new Map();
      for (const seasonId of [...new Set(races.map((r) => r.season_id))]) {
        // Alle saesonens loeb er "naere" (late_fill): nu = saesonens sidste planlagte start,
        // saa assistenten udtager alle hold i puljen, ligesom redningen ved etape 1.
        const seasonRaceIds = [];
        // pagination-safe: .range() i sider af PAGE
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await db.from("races").select("id").eq("season_id", seasonId).order("id", { ascending: true }).range(from, from + PAGE - 1);
          if (error) throw new Error(`races: ${error.message}`);
          seasonRaceIds.push(...(data ?? []).map((r) => r.id));
          if (!data || data.length < PAGE) break;
        }
        const sched = await selectByIds(db, "race_stage_schedule", "race_id, stage_number, scheduled_at, game_day", "race_id", seasonRaceIds, ["race_id", "stage_number"]);
        // #6909 (Codex P2): hvert loeb udtages paa SIN egen startdato (etape 1), ikke saesonens
        // sidste: skader og Train now-laase vurderes som ved redningen ved etape 1. Loeb med
        // samme start koeres sammen (samme dags-konflikter haandteres af generatoren).
        const firstStart = new Map();
        for (const st of sched) {
          const ms = Date.parse(st.scheduled_at);
          if (!Number.isFinite(ms)) continue;
          firstStart.set(st.race_id, Math.min(firstStart.get(st.race_id) ?? Infinity, ms));
        }
        const wantedHere = ids.filter((id) => races.some((r) => r.id === id && r.season_id === seasonId));
        const noStart = wantedHere.filter((id) => !Number.isFinite(firstStart.get(id)));
        // #6909 (Codex P1): aldrig vaeguret - samme input skal give samme felt.
        if (noStart.length) throw new Error(`syntetisk felt: saeson ${seasonId}: ${noStart.length} loeb uden planlagt start (race_stage_schedule.scheduled_at); kan ikke vaelge et deterministisk tidspunkt`);
        const overlay = routesByRace ? {
          table: "race_stage_profiles", key: "race_id",
          rowsByKey: new Map([...routesByRace].map(([raceId, profiles]) => [raceId, profiles.map((p) => ({ ...p, race_id: raceId }))])),
        } : null;
        // #6909 (Codex P2 x2): hvert loeb udtages paa SIN egen start (egen skade-/Train now-/late-fill-
        // vurdering). Bindingen haandhaeves bagefter med generatorens egen kanon, raceBindingWindow
        // (game_day-spaend): i start-orden droppes en rytter fra et loeb, hvis han allerede er
        // udtaget til et loeb hvis binding-vindue overlapper (sikkerhedsnet; skjulningen ovenfor
        // goer det normalt til 0). Antallet logges paa kortet.
        const byStart = new Map();
        for (const id of wantedHere) { const t = firstStart.get(id); if (!byStart.has(t)) byStart.set(t, []); byStart.get(t).push(id); }
        const schedByRace = new Map();
        for (const st of sched) { if (!schedByRace.has(st.race_id)) schedByRace.set(st.race_id, []); schedByRace.get(st.race_id).push(st); }
        const windowOf = (id) => raceBindingWindow(schedByRace.get(id) ?? []);
        const byRace = new Map();
        const bookedEarly = new Map(); // rider_id -> [{start,end}] fra tidligere koersler
        const overlapsAny = (wins, w) => w && wins.some((p) => p.start <= w.end && w.start <= p.end);
        // Skjulte ryttere for ét loeb: dem der allerede er udtaget til et loeb hvis binding-vindue
        // overlapper netop DETTE loebs vindue.
        const excludedFor = (id) => {
          const w = windowOf(id);
          return w ? [...bookedEarly].filter(([, wins]) => overlapsAny(wins, w)).map(([rid]) => rid).sort() : [];
        };
        for (const [startMs, startGroup] of [...byStart].sort((a, b) => a[0] - b[0])) {
          // #6909 (Codex P2 x2): ryttere der allerede er bundet i et overlappende loeb skjules for
          // generatoren, saa den selv udtager erstatninger og kaptajner (intet underbemandet felt).
          // Skjulningen gaelder pr. loeb: loeb med samme start men forskellige skjulte ryttere (fx
          // ikke-overlappende game_day-vinduer) koeres hver for sig, saa en rytter kun mangler i
          // de loeb han faktisk er bundet imod. Skjulningen genberegnes efter hver delkoersel.
          let queue = [...startGroup].sort();
          while (queue.length) {
            const keyOf = (id) => excludedFor(id).join("|");
            const k0 = keyOf(queue[0]);
            const group = queue.filter((id) => keyOf(id) === k0);
            queue = queue.filter((id) => !group.includes(id));
            const excludeKeys = new Set(excludedFor(group[0]));
            // #6909 (Codex P2 x2): koerslen ser KUN sin egen gruppe. Alle andre saesonens loeb
            // (andre valgte grupper og ikke-valgte loeb) fjernes fra races, saa intet loeb uden for
            // gruppen kan forbruge ryttere. Bindinger til loeb med rigtige tilmeldinger tabes ikke:
            // generatoren laeser dem fra race_entries (rider_id + saeson), ikke fra races-listen.
            const res = await run({
              supabase: readOnlyDb(db, { overlay, overlays: [
                excludeKeys.size ? { table: "riders", key: "id", excludeKeys, nullField: "team_id" } : null,
                { table: "races", key: "id", keepKeys: new Set(group) },
              ] }), seasonId, dryRun: true, mode: "late_fill",
              now: startMs, includeStaged: true, notify: async () => {},
            });
            log(`syntetisk felt (generator, dry-run): saeson ${seasonId}, start ${new Date(startMs).toISOString().slice(0, 16)}: ${group.length} loeb, ${res.generated} pladser`);
            const groupSet = new Set(group);
            for (const [raceId, list] of entriesFromStaged(res.staged ?? [])) {
              if (!groupSet.has(raceId)) continue;
              byRace.set(raceId, list);
              const w = windowOf(raceId);
              if (w) for (const e of list) bookedEarly.set(e.rider_id, [...(bookedEarly.get(e.rider_id) ?? []), { start: w.start, end: w.end }]);
            }
          }
        }
        const booked = new Map(); // rider_id -> [{start,end}]
        let dropped = 0;
        for (const id of [...byRace.keys()].sort((x, y) => (firstStart.get(x) - firstStart.get(y)) || (x < y ? -1 : 1))) {
          const w = windowOf(id);
          const kept = [];
          for (const e of byRace.get(id)) {
            const prev = booked.get(e.rider_id) ?? [];
            if (w && prev.some((p) => p.start <= w.end && w.start <= p.end)) { dropped += 1; continue; }
            kept.push(e);
            if (w) booked.set(e.rider_id, [...prev, { start: w.start, end: w.end }]);
          }
          byRace.set(id, kept);
        }
        if (dropped) log(`syntetisk felt: ${dropped} dobbeltbookinger fjernet (overlappende binding-vinduer, game_day)`);
        const wanted = new Set(ids);
        const riderIds = [];
        const teamIds = [];
        for (const [raceId, list] of byRace) {
          if (!wanted.has(raceId)) continue;
          for (const e of list) { riderIds.push(e.rider_id); teamIds.push(e.team_id); }
        }
        const teams = new Map((await teamsFor(teamIds)).map((t) => [t.id, t]));
        const abilities = new Map((await abilitiesFor(riderIds)).map((a) => [a.rider_id, a]));
        for (const [raceId, entries] of byRace) {
          if (!wanted.has(raceId)) continue;
          out.set(raceId, {
            entries,
            teams: [...new Set(entries.map((e) => e.team_id))].map((id) => teams.get(id)).filter(Boolean),
            abilities: entries.map((e) => abilities.get(e.rider_id)).filter(Boolean),
          });
        }
      }
      return out;
    },
    async benchField() {
      const { loadBenchField } = await import("../s5MotorBench.mjs");
      const f = loadBenchField();
      return { entries: f.entries, teams: f.teams, abilities: f.abilities };
    },
  };
}
