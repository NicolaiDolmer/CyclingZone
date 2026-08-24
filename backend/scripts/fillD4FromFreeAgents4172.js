#!/usr/bin/env node
// #4172 · Fyld Division 4's AI-hold med EKSISTERENDE frie ryttere (ejer-krav 24/8).
//
// EJER-SPØRGSMÅL 24/8: "Hvorfor kan vi ikke bare bruge nogen af de hold og ryttere
// vi allerede havde i spillet?" — helt korrekt. Den normale AI-generator
// (createAiTeam → defaultAllocateSquadForTeam) SKABER altid nye ryttere. At fylde
// D4 til POOL_TARGET_SIZE=24 ville føde ~3.500 nye ryttere ind i en økonomi der
// samtidig har 3.291 frie ryttere uden hold. Det er både unødvendig inflation og
// mindre troværdigt som spil: ryttere skifter hold, de opstår ikke af ingenting.
//
// LØSNING: aiTeamGenerator's `deps.allocateSquadForTeam` er injicerbar. Vi sender
// en allokator ind der TILDELER frie ryttere i stedet for at generere nye. Selve
// AI-generatoren (holdnavne, determinisme, trim-politik #1688) er urørt.
//
// UDVÆLGELSE: kun frie seniorryttere med base_value < VALUE_CEILING. De 3.124 der
// opfylder det har gennemsnitsværdi ~7.500 og gennemsnitsalder 22 — præcis den
// svage profil tier 4 skal have (den normale tier 4-sti klemmer stats til 51-55).
// De ~90 frie ryttere over 500k holdes bevidst UDE: de ville gøre D4-hold stærkere
// end divisionen er kalibreret til.
//
// FORDELING: round-robin i værdiorden, så alle hold får et jævnt udsnit i stedet
// for at de første hold får de stærkeste. Deterministisk (stabil sortering på id).
//
// TRUPSTØRRELSE: SQUAD_SIZE=20, ikke AI_SQUAD.TOTAL_SIZE=24. 146 AI-hold à 24 =
// 3.504 ryttere, men der findes kun 3.124 brugbare frie. 20 pr. hold = 2.920 og
// efterlader ~200 på markedet. 20 er langt over MIN_RIDERS_FOR_RACE=8 og under
// senior-cap'en, så holdene er fuldt løbsdygtige.
//
// KONTRAKT: ejede ryttere SKAL have salary + contract_length + contract_end_season
// (GAME_INVARIANTS #1309). Sættes via contractSeed-kæden, samme som enhver anden
// erhvervelse. Ingen derive-kæde nødvendig — rytterne har allerede afledte data.
//
//   node scripts/fillD4FromFreeAgents4172.js           → dry-run
//   node scripts/fillD4FromFreeAgents4172.js --live    → tildel

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { reconcileAiTeamsForPool } from "../lib/aiTeamGenerator.js";
import { computeFrozenSalary, pickStarterContractLength, computeContractEndSeason } from "../lib/contractSeed.js";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const D4_TIER = 4;
const SQUAD_SIZE = 20;
const VALUE_CEILING = 100000;
const log = (...a) => console.log(...a);

/**
 * Byg en allokator der uddeler fra en FÆLLES kø af frie ryttere.
 * Køen deles på tværs af alle hold i kørslen, så to hold aldrig får samme rytter.
 */
export function makeFreeAgentAllocator({ freeRiders, seasonNumber, squadSize = SQUAD_SIZE, dryRun = false }) {
  // Round-robin i værdiorden: hold nr. k får index k, k+N, k+2N … af den
  // værdisorterede liste, så ingen hold får et sammenhængende styrke-bånd.
  const queue = [...freeRiders];
  let cursor = 0;
  const assigned = [];

  return {
    assigned,
    remaining: () => queue.length - cursor,
    allocate: async (supabase, teamId) => {
      const picks = [];
      for (let i = 0; i < squadSize && cursor < queue.length; i++) {
        picks.push(queue[cursor]);
        cursor += 1;
      }
      if (!picks.length) throw new Error(`ingen frie ryttere tilbage til hold ${teamId}`);
      assigned.push({ teamId, riderIds: picks.map((r) => r.id) });
      if (dryRun) return picks.map((r) => r.id);

      // Kontrakt pr. rytter (#1309): salary frosset ved erhvervelse.
      const rng = makeRng(Math.abs(hashId(teamId)) >>> 0);
      for (const r of picks) {
        const length = pickStarterContractLength(rng);
        const { error } = await supabase.from("riders").update({
          team_id: teamId,
          salary: computeFrozenSalary(r),
          contract_length: length,
          contract_end_season: computeContractEndSeason(seasonNumber, length),
          acquired_at: new Date().toISOString(),
        }).eq("id", r.id).is("team_id", null); // guard: kun hvis stadig fri
        if (error) throw new Error(`tildel rytter ${r.id} → ${teamId}: ${error.message}`);
      }
      return picks.map((r) => r.id);
    },
  };
}

function hashId(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h;
}

async function main() {
  const dryRun = !process.argv.includes("--live");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: season, error: sErr } = await supabase
    .from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (sErr) throw new Error(`seasons: ${sErr.message}`);

  const { data: pools, error: pErr } = await supabase
    .from("league_divisions").select("id, tier, pool_index, label").eq("tier", D4_TIER);
  if (pErr) throw new Error(`league_divisions: ${pErr.message}`);
  const poolIds = (pools || []).sort((a, b) => a.pool_index - b.pool_index).map((p) => p.id);
  const labelByPool = new Map((pools || []).map((p) => [p.id, p.label]));

  // Frie, ikke-pensionerede seniorryttere under værdiloftet, i værdiorden.
  const free = await fetchAllRows(() => supabase
    .from("riders")
    .select("id, base_value, current_production_value")
    .is("team_id", null).eq("is_academy", false)
    .lt("base_value", VALUE_CEILING)
    .order("base_value").order("id"));
  const usable = (free || []).filter((r) => Number(r.current_production_value) > 0);

  const { data: teamRows, error: tErr } = await supabase
    .from("teams").select("id, is_ai, is_bank, league_division_id").in("league_division_id", poolIds);
  if (tErr) throw new Error(`teams: ${tErr.message}`);
  const inD4 = (teamRows || []).filter((t) => !t.is_bank);
  const realPerPool = new Map();
  for (const t of inD4) if (!t.is_ai) realPerPool.set(t.league_division_id, (realPerPool.get(t.league_division_id) || 0) + 1);
  const aiNow = inD4.filter((t) => t.is_ai).length;
  const aiTarget = poolIds.reduce((s, pid) => s + Math.max(0, 24 - (realPerPool.get(pid) || 0)), 0);
  const aiToCreate = Math.max(0, aiTarget - aiNow);

  log(`\n── #4172 · fyld D4 med FRIE ryttere · sæson ${season.number} ──`);
  log(`frie ryttere under ${VALUE_CEILING.toLocaleString("da-DK")}: ${usable.length}`);
  log(`AI-hold nu: ${aiNow} · target: ${aiTarget} · oprettes: ${aiToCreate}`);
  log(`ryttere der skal bruges: ${aiToCreate * SQUAD_SIZE} (${SQUAD_SIZE} pr. hold)`);
  log(`dækning: ${usable.length >= aiToCreate * SQUAD_SIZE ? "✓ nok" : "❌ FOR FÅ"}\n`);
  if (usable.length < aiToCreate * SQUAD_SIZE) {
    throw new Error(`for få frie ryttere: ${usable.length} < ${aiToCreate * SQUAD_SIZE}`);
  }

  const alloc = makeFreeAgentAllocator({ freeRiders: usable, seasonNumber: season.number, dryRun });

  if (dryRun) {
    log("DRY-RUN — intet skrevet. Kør med --live efter ejer-GO.\n");
    return { dryRun: true, aiToCreate, ridersNeeded: aiToCreate * SQUAD_SIZE, freeAvailable: usable.length };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(__dirname, "..", "..", "docs", "snapshots", "4172");
  mkdirSync(dir, { recursive: true });

  let created = 0;
  for (const pid of poolIds) {
    const res = await reconcileAiTeamsForPool({
      supabase, poolId: pid,
      deps: { allocateSquadForTeam: (sb, teamId) => alloc.allocate(sb, teamId) },
    });
    created += res.created;
    log(`  ${String(labelByPool.get(pid)).padEnd(18)} AI +${res.created} / -${res.removed} · frie tilbage: ${alloc.remaining()}`);
  }

  writeFileSync(join(dir, `d4-freeagent-fill-${stamp}.json`), JSON.stringify({
    takenAt: new Date().toISOString(), seasonId: season.id, squadSize: SQUAD_SIZE,
    valueCeiling: VALUE_CEILING, assignments: alloc.assigned,
  }, null, 2));

  log(`\noprettede ${created} AI-hold · tildelte ${alloc.assigned.length * SQUAD_SIZE} eksisterende ryttere`);
  log(`frie ryttere tilbage på markedet: ${alloc.remaining()}`);
  log(`INGEN nye ryttere skabt.\n`);
  return { dryRun: false, created, assigned: alloc.assigned.length };
}

main().then((r) => log("færdig:", JSON.stringify(r)))
  .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
