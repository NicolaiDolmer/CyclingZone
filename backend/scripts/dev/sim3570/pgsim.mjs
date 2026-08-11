// sim/pgsim.mjs — SIKKER SIMULERINGS-TILSTAND for #3570-reparationsværktøjet.
//
// HVORFOR IKKE EN MOCK: blokker B1′ handlede om KOLONNENAVNE der drev fra hinanden
// mellem tre artefakter. En håndskrevet mock håndhæver kun de kolonnenavne dens
// forfatter huskede at skrive ned — den kan altså strukturelt ikke være uafhængig
// af den kode den tester. Derfor kører denne simulering en ÆGTE PostgreSQL
// (PGlite, PostgreSQL 18.3 i WASM, allerede i backend/node_modules) med det
// RIGTIGE prod-skema. Kolonne-navne, typer, NOT NULL, primærnøgler, FK med
// ON DELETE CASCADE og hele rollback.sql'ens `DO $$ … RAISE EXCEPTION`-porte
// håndhæves af Postgres selv.
//
// Prod-skemaet er hentet 2026-08-10 med ét read-only SELECT mod
// information_schema.columns (project ghwvkxzhsbbltzfnuhhz). Ingen prod-mutation.
//
// Data: docs/snapshots/3570/ (det daterede 10/8-snapshot der ligger i repoet), så
// den friske plan simuleringen bygger er identisk med værktøjets baseline-plan —
// enhver forskel i en kørsel er derfor noget SIMULERINGEN gjorde, ikke datadrift.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

// PGlite ligger i backend/node_modules. Simuleringen lå oprindeligt uden for repoet;
// den er flyttet ind, fordi en verifikation ingen kan gentage ikke er en verifikation.
// Stierne udledes af filens egen placering (backend/scripts/dev/sim3570/), så
// harnesset kører fra et hvilket som helst checkout eller worktree.
export const BACKEND = process.env.CZ_BACKEND
  || fileURLToPath(new URL("../../../", import.meta.url));
export const ROD = process.env.CZ_ROD
  || fileURLToPath(new URL("../../../../", import.meta.url));
export const SNAPSHOT_DIR = join(ROD, "docs/snapshots/3570");
export const D_PLAN = join(ROD, "docs/reparation-3570/skriveplan-D-2026-08-10.json.gz");
const req = createRequire(join(BACKEND, "package.json"));
const { PGlite } = await import(pathToFileURL(req.resolve("@electric-sql/pglite")).href);

// ── Prod-skemaet, ordret fra information_schema 10/8 ────────────────────────
// Formen er [navn, data_type, is_nullable]. Typerne er IKKE gættet.
const KATALOG = {
  app_config: [
    ["key", "text", "NO"], ["value", "jsonb", "NO"], ["description", "text", "YES"],
    ["updated_at", "timestamp with time zone", "NO"], ["updated_by", "uuid", "YES"],
  ],
  rider_derived_abilities: [
    ["rider_id", "uuid", "NO"], ["formula_version", "integer", "NO"],
    ["climbing", "smallint", "NO"], ["time_trial", "smallint", "NO"], ["sprint", "smallint", "NO"],
    ["punch", "smallint", "NO"], ["endurance", "smallint", "NO"], ["cobblestone", "smallint", "NO"],
    ["acceleration", "smallint", "NO"], ["recovery", "smallint", "NO"], ["tactics", "smallint", "NO"],
    ["positioning", "smallint", "NO"], ["generated_at", "timestamp with time zone", "NO"],
    ["prolog", "smallint", "YES"], ["flat", "smallint", "YES"], ["tempo", "smallint", "YES"],
    ["durability", "smallint", "YES"], ["descending", "smallint", "YES"], ["aggression", "smallint", "YES"],
    ["hidden_potential", "smallint", "YES"], ["ability_caps", "jsonb", "YES"], ["ability_progress", "jsonb", "YES"],
  ],
  riders: [
    ["id", "uuid", "NO"], ["pcm_id", "integer", "YES"], ["firstname", "text", "NO"], ["lastname", "text", "NO"],
    ["birthdate", "date", "YES"], ["nationality_code", "text", "YES"], ["height", "integer", "YES"],
    ["weight", "integer", "YES"], ["popularity", "integer", "YES"], ["uci_points", "integer", "YES"],
    ["team_id", "uuid", "YES"], ["ai_team_id", "uuid", "YES"],
    ["stat_fl", "integer", "YES"], ["stat_bj", "integer", "YES"], ["stat_kb", "integer", "YES"],
    ["stat_bk", "integer", "YES"], ["stat_tt", "integer", "YES"], ["stat_prl", "integer", "YES"],
    ["stat_bro", "integer", "YES"], ["stat_sp", "integer", "YES"], ["stat_acc", "integer", "YES"],
    ["stat_ned", "integer", "YES"], ["stat_udh", "integer", "YES"], ["stat_mod", "integer", "YES"],
    ["stat_res", "integer", "YES"], ["stat_ftr", "integer", "YES"],
    ["is_u25", "boolean", "YES"], ["created_at", "timestamp with time zone", "YES"],
    ["updated_at", "timestamp with time zone", "YES"], ["pending_team_id", "uuid", "YES"],
    ["prize_earnings_bonus", "integer", "NO"], ["potentiale", "numeric", "YES"],
    ["acquired_at", "timestamp with time zone", "YES"], ["is_retired", "boolean", "NO"],
    ["base_value", "integer", "YES"], ["primary_type", "text", "YES"], ["secondary_type", "text", "YES"],
    ["salary", "integer", "YES"], ["contract_length", "integer", "YES"], ["contract_end_season", "integer", "YES"],
    ["is_academy", "boolean", "NO"], ["owner_is_ai", "boolean", "NO"],
    ["peak_suggestions_dismissed_season_id", "uuid", "YES"], ["current_production_value", "integer", "YES"],
    ["market_value", "integer", "YES"], ["generation_tag", "text", "YES"], ["valuation_type", "text", "YES"],
    ["archetype_draw", "jsonb", "YES"],
  ],
  seasons: [
    ["id", "uuid", "NO"], ["number", "integer", "NO"], ["status", "text", "YES"],
    ["start_date", "date", "YES"], ["end_date", "date", "YES"], ["race_days_total", "integer", "YES"],
    ["race_days_completed", "integer", "YES"], ["created_at", "timestamp with time zone", "YES"],
  ],
  teams: [
    ["id", "uuid", "NO"], ["user_id", "uuid", "YES"], ["name", "text", "NO"], ["is_ai", "boolean", "YES"],
    ["ai_source_id", "integer", "YES"], ["division", "integer", "YES"], ["balance", "bigint", "YES"],
    ["sponsor_income", "bigint", "YES"], ["is_frozen", "boolean", "YES"],
    ["created_at", "timestamp with time zone", "YES"], ["manager_name", "text", "YES"],
    ["is_bank", "boolean", "YES"], ["consecutive_low_satisfaction_expirations", "integer", "NO"],
    ["team_dna_key", "text", "YES"], ["is_test_account", "boolean", "NO"],
    ["transfer_frozen", "boolean", "NO"], ["debt_breach_streak", "integer", "NO"],
    ["emergency_loan_streak", "integer", "NO"], ["league_division_id", "integer", "YES"],
  ],
  users: [
    ["id", "uuid", "NO"], ["email", "text", "NO"], ["username", "text", "NO"], ["role", "text", "NO"],
    ["created_at", "timestamp with time zone", "YES"], ["xp", "integer", "YES"], ["level", "integer", "YES"],
    ["discord_dm_enabled", "boolean", "NO"], ["language", "text", "NO"], ["is_beta_tester", "boolean", "NO"],
    ["discord_dm_prefs", "jsonb", "NO"], ["email_prefs", "jsonb", "NO"],
    ["discord_dm_failure_count", "integer", "NO"],
  ],
};

const PK = {
  riders: "id", rider_derived_abilities: "rider_id", teams: "id", users: "id",
  seasons: "id", app_config: "key",
};

const SQLTYPE = {
  text: "text", uuid: "uuid", jsonb: "jsonb", integer: "integer", smallint: "smallint",
  bigint: "bigint", numeric: "numeric", boolean: "boolean", date: "date",
  "timestamp with time zone": "timestamptz",
};

// Default-værdier for NOT NULL-kolonner vi ikke seeder — så tabellen kan modtage
// snapshottets rækker uden at vi opfinder data der påvirker planen.
const DEFAULTS = {
  "riders.prize_earnings_bonus": "0", "riders.is_retired": "false", "riders.is_academy": "false",
  "riders.owner_is_ai": "false",
  "rider_derived_abilities.formula_version": "1", "rider_derived_abilities.generated_at": "now()",
  "rider_derived_abilities.climbing": "0", "rider_derived_abilities.time_trial": "0",
  "rider_derived_abilities.sprint": "0", "rider_derived_abilities.punch": "0",
  "rider_derived_abilities.endurance": "0", "rider_derived_abilities.cobblestone": "0",
  "rider_derived_abilities.acceleration": "0", "rider_derived_abilities.recovery": "0",
  "rider_derived_abilities.tactics": "0", "rider_derived_abilities.positioning": "0",
  "teams.consecutive_low_satisfaction_expirations": "0", "teams.is_test_account": "false",
  "teams.transfer_frozen": "false", "teams.debt_breach_streak": "0", "teams.emergency_loan_streak": "0",
  "users.email": "''", "users.role": "'user'", "users.discord_dm_enabled": "false",
  "users.language": "'en'", "users.is_beta_tester": "false", "users.discord_dm_prefs": "'{}'::jsonb",
  "users.email_prefs": "'{}'::jsonb", "users.discord_dm_failure_count": "0",
  "app_config.updated_at": "now()",
};

export function ddl() {
  const ud = [];
  for (const [t, cols] of Object.entries(KATALOG)) {
    const linjer = cols.map(([n, ty, nul]) => {
      const d = DEFAULTS[`${t}.${n}`];
      return `  ${n} ${SQLTYPE[ty]}${n === PK[t] ? " PRIMARY KEY" : ""}`
        + (d ? ` DEFAULT ${d}` : "") + (nul === "NO" && n !== PK[t] ? " NOT NULL" : "");
    });
    ud.push(`CREATE TABLE public.${t} (\n${linjer.join(",\n")}\n);`);
  }
  // FK'en er load-bearing for B5: post-verify begrunder "rytteren lever, men
  // abilities-rækken er væk ⇒ hård fejl" med at CASCADE gør det umuligt.
  ud.push(`ALTER TABLE public.rider_derived_abilities
  ADD CONSTRAINT rider_derived_abilities_rider_id_fkey
  FOREIGN KEY (rider_id) REFERENCES public.riders(id) ON DELETE CASCADE;`);
  return ud.join("\n\n");
}

const kolType = (t, c) => KATALOG[t]?.find(([n]) => n === c)?.[1] ?? null;

/** JS-værdi → parameter + cast, efter kolonnens ÆGTE type. */
function param(t, c, v) {
  const ty = kolType(t, c);
  if (ty === "jsonb") return { v: v == null ? null : JSON.stringify(v), cast: "::jsonb" };
  if (ty === "uuid") return { v: v ?? null, cast: "::uuid" };
  if (ty === "date") return { v: v ?? null, cast: "::date" };
  if (ty === "timestamp with time zone") return { v: v ?? null, cast: "::timestamptz" };
  if (ty === "numeric") return { v: v ?? null, cast: "::numeric" };
  if (ty === "smallint" || ty === "integer") return { v: v ?? null, cast: `::${SQLTYPE[ty]}` };
  if (ty === "bigint") return { v: v ?? null, cast: "::bigint" };
  if (ty === "boolean") return { v: v ?? null, cast: "::boolean" };
  return { v: v ?? null, cast: "" };
}

/**
 * Supabase-formet klient oven på ægte Postgres.
 * Understøtter præcis det værktøjet bruger: select().range/.in/.eq,
 * update().in/.eq, insert(). Fejl returneres som {data, error} — aldrig kastet —
 * ligesom supabase-js, så værktøjets {data,error}-tjek testes for alvor.
 */
export function lavSupabase(db, ctl = {}) {
  const fejl = (e) => ({ data: null, error: { message: String(e?.message ?? e) } });

  const kør = async (sql, params) => {
    try { return { res: await db.query(sql, params) }; } catch (e) { return { err: e }; }
  };

  function from(table) {
    // PostgREST tilføjer INGEN ORDER BY når kaldet ikke har .order(). At sortere
    // efter "primærnøglen" ville kræve at simuleringen KENDER hver tabels nøgle —
    // altså præcis den antagelse B1′ handlede om. `ctid` findes på enhver tabel og
    // følger den fysiske rækkefølge, som er den Postgres ellers ville levere.
    const pk = "ctid";
    return {
      select(cols) {
        const liste = cols == null || String(cols).trim() === "*" ? "*"
          : String(cols).split(",").map((s) => s.trim()).filter(Boolean).join(", ");
        const base = `SELECT ${liste} FROM public.${table}`;
        return {
          async range(a, b) {
            ctl.log?.({ op: "select", table });
            const { res, err } = await kør(`${base} ORDER BY ${pk} LIMIT $1 OFFSET $2`, [b - a + 1, a]);
            return err ? fejl(err) : { data: res.rows, error: null };
          },
          async in(col, ids) {
            ctl.log?.({ op: "select", table, n: ids.length });
            const { res, err } = await kør(`${base} WHERE ${col}::text = ANY($1::text[]) ORDER BY ${pk}`, [ids]);
            if (err) return fejl(err);
            // Læsefejl-injektion: rækker der findes, men som det BREDE opslag ikke
            // returnerer. Post-verify skal skelne dem fra ægte sletninger via sit
            // selvstændige eksistens-opslag — derfor rammer skjulet kun det brede.
            if (ctl.skjulFraBredtOpslag?.size && table === "riders" && liste.includes("archetype_draw")) {
              return { data: res.rows.filter((r) => !ctl.skjulFraBredtOpslag.has(r.id)), error: null };
            }
            return { data: res.rows, error: null };
          },
          async eq(col, v) {
            const { res, err } = await kør(`${base} WHERE ${col}::text = $1 ORDER BY ${pk}`, [String(v)]);
            return err ? fejl(err) : { data: res.rows, error: null };
          },
        };
      },
      update(patch) {
        const cols = Object.keys(patch);
        const ps = cols.map((c) => param(table, c, patch[c]));
        const sets = cols.map((c, i) => `${c} = $${i + 1}${ps[i].cast}`).join(", ");
        const vals = ps.map((p) => p.v);
        const skriv = async (hvor, ekstra) => {
          // Krogen kører FØR skrivningen: her injiceres afbrud og sletninger midt
          // i kørslen, præcis som virkeligheden ville gøre det.
          const h = await ctl.foerSkrivning?.({ table, patch, hvor, ekstra });
          if (h?.fejl) return { error: { message: h.fejl } };
          // "Skrivningen fejlede TAVST": klienten får {error: null}, men intet
          // blev skrevet. Det er den situation post-verify skal fange — og den
          // rytter må ALDRIG kunne gemme sig i kategorien "slettet undervejs".
          if (h?.spring) return { data: null, error: null, count: 0 };
          const { res, err } = await kør(
            `UPDATE public.${table} SET ${sets} WHERE ${hvor}`, [...vals, ...ekstra],
          );
          if (err) return fejl(err);
          ctl.efterSkrivning?.({ table, n: res.affectedRows ?? 0 });
          return { data: null, error: null, count: res.affectedRows ?? 0 };
        };
        return {
          in: (col, ids) => skriv(`${col}::text = ANY($${cols.length + 1}::text[])`, [ids]),
          eq: (col, v) => skriv(`${col}::text = $${cols.length + 1}`, [String(v)]),
        };
      },
      async insert(rows) {
        const liste = Array.isArray(rows) ? rows : [rows];
        if (!liste.length) return { data: null, error: null };
        const cols = Object.keys(liste[0]);
        const vals = [];
        const grupper = liste.map((r) => "(" + cols.map((c) => {
          const p = param(table, c, r[c]);
          vals.push(p.v);
          return `$${vals.length}${p.cast}`;
        }).join(", ") + ")");
        const { err } = await kør(
          `INSERT INTO public.${table} (${cols.join(", ")}) VALUES ${grupper.join(", ")}`, vals,
        );
        return err ? fejl(err) : { data: null, error: null };
      },
    };
  }
  return { from };
}

// ── Seeding fra det daterede snapshot i repoet ──────────────────────────────
const uuidFra = (n, pre) => {
  const h = String(n).padStart(12, "0");
  return `${pre}-0000-4000-8000-${h}`;
};

export async function byg({ snapshotDir, antalPensionerede = 35 }) {
  const gz = (f) => JSON.parse(gunzipSync(readFileSync(join(snapshotDir, f))).toString("utf8"));
  const rf = gz("riders_full-2026-08-10.json.gz");
  const bs = gz("birthstats-2026-08-10.json.gz");
  const meta = JSON.parse(readFileSync(join(snapshotDir, "meta-2026-08-10.json"), "utf8"));
  const bById = new Map(bs.map((b) => [b.id, b]));

  const db = new PGlite();
  await db.exec(ddl());

  // seasons
  for (const s of meta.seasons) {
    await db.query(
      `INSERT INTO public.seasons (id, number, status, start_date, end_date, race_days_total, race_days_completed)
       VALUES ($1::uuid,$2,$3,$4::date,$5::date,$6,$7)`,
      [uuidFra(s.number, "5ea50000"), s.number, s.status, s.start_date, s.end_date, s.race_days_total, s.race_days_completed],
    );
  }
  // app_config
  for (const [k, v] of Object.entries(meta.appConfig)) {
    await db.query(`INSERT INTO public.app_config (key, value) VALUES ($1,$2::jsonb)`, [k, JSON.stringify(v)]);
  }
  // users + teams udledt af snapshottets rytter-rækker
  const users = new Map(), teams = new Map();
  for (const r of rf) {
    if (r.manager_user_id && !users.has(r.manager_user_id)) {
      users.set(r.manager_user_id, { id: r.manager_user_id, username: r.manager_display_name ?? "ukendt" });
    }
    if (r.team_id && !teams.has(r.team_id)) {
      teams.set(r.team_id, {
        id: r.team_id, user_id: r.manager_user_id ?? null,
        name: r.manager_display_name ?? `hold-${teams.size}`,
        is_ai: r.owner_kind === "ai", division: r.division ?? null,
        is_test_account: !!r.is_test_account, is_frozen: false,
      });
    }
  }
  for (const u of users.values()) {
    await db.query(
      `INSERT INTO public.users (id, email, username, role) VALUES ($1::uuid,$2,$3,'user')`,
      [u.id, `${u.username}@example.invalid`, u.username],
    );
  }
  for (const t of teams.values()) {
    await db.query(
      `INSERT INTO public.teams (id, user_id, name, is_ai, division, is_test_account, is_frozen)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7)`,
      [t.id, t.user_id, t.name, t.is_ai, t.division, t.is_test_account, t.is_frozen],
    );
  }

  // riders + rider_derived_abilities
  const rKols = ["id", "firstname", "lastname", "birthdate", "height", "weight", "potentiale",
    "archetype_draw", "team_id", "primary_type", "secondary_type", "valuation_type",
    "base_value", "market_value", "current_production_value", "salary", "is_academy", "is_retired",
    "stat_bj", "stat_kb", "stat_bk", "stat_tt", "stat_prl", "stat_fl", "stat_bro", "stat_sp",
    "stat_acc", "stat_ned", "stat_udh", "stat_mod", "stat_res", "stat_ftr"];
  const aKols = ["rider_id", "ability_caps", "ability_progress", "climbing", "time_trial", "flat",
    "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability",
    "descending", "cobblestone", "positioning", "aggression", "tactics"];

  const indsæt = async (tabel, kols, rækker) => {
    for (let i = 0; i < rækker.length; i += 300) {
      const del = rækker.slice(i, i + 300);
      const vals = [];
      const g = del.map((r) => "(" + kols.map((c) => {
        const p = param(tabel, c, r[c]);
        vals.push(p.v);
        return `$${vals.length}${p.cast}`;
      }).join(",") + ")");
      await db.query(`INSERT INTO public.${tabel} (${kols.join(",")}) VALUES ${g.join(",")}`, vals);
    }
  };

  const rRows = [], aRows = [];
  const læg = (r, b, retired) => {
    rRows.push({
      id: r.rider_id, firstname: r.firstname, lastname: r.lastname, birthdate: r.birthdate,
      height: b?.height ?? null, weight: b?.weight ?? null, potentiale: r.potentiale,
      archetype_draw: r.archetype_draw ?? null, team_id: r.team_id ?? null,
      primary_type: r.primary_type, secondary_type: r.secondary_type, valuation_type: r.valuation_type,
      base_value: r.base_value, market_value: r.market_value,
      current_production_value: r.current_production_value, salary: r.salary,
      is_academy: !!r.is_academy, is_retired: retired,
      stat_bj: b?.stat_bj ?? null, stat_kb: b?.stat_kb ?? null, stat_bk: b?.stat_bk ?? null,
      stat_tt: b?.stat_tt ?? null, stat_prl: b?.stat_prl ?? null, stat_fl: b?.stat_fl ?? null,
      stat_bro: b?.stat_bro ?? null, stat_sp: b?.stat_sp ?? null, stat_acc: b?.stat_acc ?? null,
      stat_ned: b?.stat_ned ?? null, stat_udh: b?.stat_udh ?? null, stat_mod: b?.stat_mod ?? null,
      stat_res: b?.stat_res ?? null, stat_ftr: b?.stat_ftr ?? null,
    });
    const a = { rider_id: r.rider_id, ability_caps: r.ability_caps ?? null, ability_progress: r.ability_progress ?? null };
    for (const k of ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
      "endurance", "recovery", "durability", "descending", "cobblestone", "positioning",
      "aggression", "tactics"]) a[k] = r.abilities?.[k] ?? 0;
    aRows.push(a);
  };

  for (const r of rf) læg(r, bById.get(r.rider_id), false);

  // De 35 pensionerede står IKKE i snapshottet (det er kun levende ryttere), men
  // de findes i prod, de har en abilities-række, og PART A kopierer dem med.
  // Uden dem ville backup-tallene i simuleringen være 8.199 og ikke 8.234, og
  // is_retired-kanten ville aldrig blive kørt. De er klonet fra levende ryttere
  // med nyt id — de er filtreret fra af `!r.is_retired` og kan ikke påvirke planen.
  for (let i = 0; i < antalPensionerede; i++) {
    const kilde = rf[i * 37 % rf.length];
    const klon = { ...kilde, rider_id: uuidFra(i, "0e751000"), team_id: null };
    læg(klon, bById.get(kilde.rider_id), true);
  }

  await indsæt("riders", rKols, rRows);
  await indsæt("rider_derived_abilities", aKols, aRows);

  return { db, meta, antalLevende: rf.length, antalPensionerede };
}

/** Feltvis øjebliksbillede af præcis det reparationen og rollbacken rører ved. */
export async function billede(db) {
  const r = await db.query(
    `SELECT id, archetype_draw, primary_type, secondary_type, valuation_type,
            base_value, market_value, is_retired
       FROM public.riders ORDER BY id`);
  const a = await db.query(
    `SELECT rider_id, ability_caps, ability_progress FROM public.rider_derived_abilities ORDER BY rider_id`);
  return { riders: r.rows, abilities: a.rows };
}

/** Sammenligner to billeder felt for felt. Returnerer hver eneste forskel. */
export function sammenlign(foer, efter) {
  const ud = { kunIFoer: [], kunIEfter: [], felter: {}, raekker: 0 };
  const cmp = (navn, A, B, noegle, felter) => {
    const mA = new Map(A.map((x) => [x[noegle], x]));
    const mB = new Map(B.map((x) => [x[noegle], x]));
    for (const k of mA.keys()) if (!mB.has(k)) ud.kunIFoer.push(`${navn}:${k}`);
    for (const k of mB.keys()) if (!mA.has(k)) ud.kunIEfter.push(`${navn}:${k}`);
    for (const [k, va] of mA) {
      const vb = mB.get(k);
      if (!vb) continue;
      ud.raekker++;
      for (const f of felter) {
        if (JSON.stringify(va[f] ?? null) !== JSON.stringify(vb[f] ?? null)) {
          const n = `${navn}.${f}`;
          (ud.felter[n] ||= { antal: 0, eksempler: [] }).antal++;
          if (ud.felter[n].eksempler.length < 3) {
            ud.felter[n].eksempler.push({ noegle: k, foer: va[f], efter: vb[f] });
          }
        }
      }
    }
  };
  cmp("riders", foer.riders, efter.riders, "id",
    ["archetype_draw", "primary_type", "secondary_type", "valuation_type", "base_value", "market_value", "is_retired"]);
  cmp("abilities", foer.abilities, efter.abilities, "rider_id", ["ability_caps", "ability_progress"]);
  ud.identisk = !ud.kunIFoer.length && !ud.kunIEfter.length && !Object.keys(ud.felter).length;
  return ud;
}
