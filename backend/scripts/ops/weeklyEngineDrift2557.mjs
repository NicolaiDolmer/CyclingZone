#!/usr/bin/env node
/**
 * Ugentlig motor-drift-rapport (#2557, S14)
 * =========================================
 * Hver mandag maaler dette script ugens RIGTIGE afviklede etaper i prod pr.
 * loebsgruppe (korte etapeloeb, Grand Tours, endagsloeb, monumenter, U23/junior)
 * og sammenligner dem med graenserne i env ENGINE_GATE_THRESHOLDS_JSON (en
 * GitHub-secret, samme JSON som den private taerskelfil). Rapporten er privat og
 * gaar kun til Discord-ops-webhooken; i Actions-loggen staar kun
 * "N gates OK / M afvigelser". Repoet har definitionerne, aldrig tallene
 * (hard rule 17).
 *
 * READ-ONLY mod prod: klienten kan kun SELECT (se makeReadOnlyClient). Ingen
 * skrivning nogen steder; raekkerne hentes med fetchAllRows-paginering.
 *
 * Maal pr. gruppe (alle andele 0-1; alle paa vejetaper, tidskoersler tages ikke med):
 *   breakawayWinShare          andel etaper hvor vinderen kom fra udbruddet
 *   favoriteWinShare           andel etaper hvor feltets favorit vandt (samme favorit-definition
 *                              som drift-vagten, observeStageV4)
 *   topRiderWinShare           den mest vindende rytters andel af gruppens etapesejre
 *   favoriteInBreakawayShare   andel etaper hvor favoritten var i udbruddet
 *   gcWinnerFromBreakawayShare andel afsluttede etapeloeb hvor klassementsvinderen vandt en etape
 *                              fra udbrud (kun etapeloeb)
 *   abandonShare               andel startere der udgik (alle aarsager)
 *   crashShare / illnessShare / fatigueShare
 *                              udgaaede opdelt: styrt, sygdom/skade, traethed (tidsgraensen).
 *                              Mekaniske udgaaelser taelles i abandonShare, ikke i en egen raekke.
 *
 * Env (paakraevet; mangler en, stopper scriptet med exit 2 UDEN at sende noget):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY   (findes som GitHub-secrets; kun SELECT bruges)
 *   ENGINE_GATE_THRESHOLDS_JSON          den private taerskelfil som JSON
 *   DISCORD_OPS_WEBHOOK_URL              ops-kanalens webhook
 * Env (valgfri):
 *   DISCORD_OPS_MENTION                  @mention (se backend/lib/opsWebhook.js)
 *   WEEKLY_DRIFT_DAYS                    vindue i dage, default 7
 *   WEEKLY_DRIFT_UNTIL                   ISO-tidspunkt for vinduets slutning, default nu
 *   WEEKLY_DRIFT_DRY_RUN=1               send ikke til Discord; skriv kun resumeet
 *   WEEKLY_DRIFT_OUT                     skriv rapporten til denne fil (lokal brug; skal ligge
 *                                        under en balance-internals/-mappe)
 *
 * Taerskelfilen (nogle noegler er nye for dette script), sektionen `weeklyEngineDrift`:
 *   { "minStages": <tal>,                                  etaper der skal til for at dømme en gruppe
 *     "groups": { "<gruppe>": { "minStages"?: <tal>,
 *                               "<maal>": { "min"?: <tal>, "max"?: <tal> } } } }
 * Grupper: short_stage_race (2-8 etaper), other_stage_race (9-14), gt (15+), one_day,
 * monument, u23_junior. Et maal uden baand vises som information og dommes ikke.
 *
 * Exit: 0 = alt inden for graenserne (eller for lidt data) · 1 = mindst en afvigelse ·
 *       2 = konfigurationsfejl · 3 = data- eller leveringsfejl.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRows, fetchAllRowsChunkedIn, fetchAllRowsKeyset } from "../../lib/supabasePagination.js";
import { getOpsMention, withOpsMention } from "../../lib/opsWebhook.js";
import { clampEmbed } from "../../lib/discordEmbedLimits.js";

// ── Definitioner ─────────────────────────────────────────────────────────────

export const GROUPS = Object.freeze(["short_stage_race", "other_stage_race", "gt", "one_day", "monument", "u23_junior"]);

export const GROUP_LABELS = Object.freeze({
  short_stage_race: "Korte etapeloeb (2-8 etaper)",
  other_stage_race: "Lange etapeloeb (9-14 etaper)",
  gt: "Grand Tours",
  one_day: "Endagsloeb",
  monument: "Monumenter",
  u23_junior: "U23 og junior",
});

export const MEASURES = Object.freeze([
  { key: "breakawayWinShare", label: "udbrudssejre" },
  { key: "favoriteWinShare", label: "favoritsejre" },
  { key: "topRiderWinShare", label: "bedste rytters sejrsandel" },
  { key: "favoriteInBreakawayShare", label: "favoritter i udbrud" },
  { key: "gcWinnerFromBreakawayShare", label: "GC-vinder fra udbrud" },
  { key: "abandonShare", label: "udgaaede i alt" },
  { key: "crashShare", label: "udgaaede: styrt" },
  { key: "illnessShare", label: "udgaaede: sygdom/skade" },
  { key: "fatigueShare", label: "udgaaede: traethed" },
]);

const TIME_TRIAL_PROFILES = new Set(["itt", "itt_hilly", "ttt"]);
const MONUMENT_CLASSES = new Set(["Monuments"]);
const GC_RACE_GROUPS = new Set(["short_stage_race", "other_stage_race", "gt", "u23_junior"]);
const IN_CHUNK = 100;

/** Loebsgruppen for et loeb: U23/junior foerst, saa monumenter, ellers efter etapeantal. */
export function raceGroupOfRace(race) {
  const squad = String(race?.squad ?? "senior").toLowerCase();
  if (squad === "u23" || squad === "junior") return "u23_junior";
  if (MONUMENT_CLASSES.has(race?.race_class)) return "monument";
  const n = Number(race?.stages) || 1;
  if (n <= 1) return "one_day";
  if (n >= 15) return "gt";
  return n <= 8 ? "short_stage_race" : "other_stage_race";
}

/** Udgaaelsens aarsag: styrt, sygdom/skade, traethed (tidsgraensen) eller mekanisk. */
export function abandonCategory(kind) {
  if (kind === "crash") return "crash";
  if (kind === "injury" || kind === "illness") return "illness";
  if (kind === "time_limit") return "fatigue";
  return "mechanical";
}

const share = (hits, n) => (n > 0 ? hits / n : null);
const stageKey = (raceId, stageNumber) => `${raceId}:${stageNumber || 1}`;
const finite = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));

// ── Taerskler ────────────────────────────────────────────────────────────────

/**
 * Parser og validerer ENGINE_GATE_THRESHOLDS_JSON. Fail closed: mangler sektionen eller
 * stikproevegraensen, kastes en fejl, der aldrig indeholder vaerdier fra filen.
 */
export function parseThresholds(raw) {
  let json;
  try {
    json = JSON.parse(String(raw ?? ""));
  } catch {
    throw new Error("ENGINE_GATE_THRESHOLDS_JSON er ikke gyldig JSON");
  }
  const section = json?.weeklyEngineDrift;
  if (!section || typeof section !== "object") throw new Error("ENGINE_GATE_THRESHOLDS_JSON mangler sektionen weeklyEngineDrift");
  if (!finite(section.minStages) || Number(section.minStages) < 0) throw new Error("weeklyEngineDrift.minStages mangler eller er ikke et tal >= 0");
  const knownMeasures = new Set(MEASURES.map((m) => m.key));
  const groups = {};
  for (const [group, cfg] of Object.entries(section.groups ?? {})) {
    if (!GROUPS.includes(group)) throw new Error("weeklyEngineDrift.groups indeholder en ukendt loebsgruppe");
    const out = { bands: {} };
    if (cfg?.minStages !== undefined) {
      if (!finite(cfg.minStages) || Number(cfg.minStages) < 0) throw new Error("weeklyEngineDrift: en gruppes minStages er ikke et tal >= 0");
      out.minStages = Number(cfg.minStages);
    }
    for (const [measure, band] of Object.entries(cfg ?? {})) {
      if (measure === "minStages") continue;
      if (!knownMeasures.has(measure)) throw new Error("weeklyEngineDrift: en gruppe indeholder et ukendt maal");
      const min = band?.min;
      const max = band?.max;
      if (min === undefined && max === undefined) throw new Error("weeklyEngineDrift: et baand mangler baade min og max");
      if ((min !== undefined && !finite(min)) || (max !== undefined && !finite(max))) throw new Error("weeklyEngineDrift: et baand har en graense der ikke er et tal");
      out.bands[measure] = { ...(min !== undefined ? { min: Number(min) } : {}), ...(max !== undefined ? { max: Number(max) } : {}) };
    }
    groups[group] = out;
  }
  return { minStages: Number(section.minStages), groups };
}

// ── Fakta pr. etape (REN) ────────────────────────────────────────────────────

/**
 * Raa raekker -> fakta pr. afviklet etape og pr. afsluttet etapeloeb.
 *
 * raw: { schedule:[{race_id,stage_number}], races:[...], results:[stage/gc-raekker],
 *        incidents:[abandon-raekker], profiles:[...] }
 * observe({ raceId, profile, results, teamByRider }) -> { favoriteId } | null  (favorit-definitionen)
 *
 * Startfeltet pr. etape er etapens resultatraekker + de der udgik paa etapen (som drift-vagten:
 * en favorit der styrtede ud er stadig favorit). Tidsgraense-ryttere staar foer de udgaaede.
 */
export function buildFacts(raw, { observe = () => null } = {}) {
  const raceById = new Map((raw.races ?? []).map((r) => [r.id, r]));
  const profileByStage = new Map((raw.profiles ?? []).map((p) => [stageKey(p.race_id, p.stage_number), p]));
  const stageRowsByStage = new Map();
  const stageRowsByRace = new Map();
  const gcRowsByRace = new Map();
  for (const r of raw.results ?? []) {
    if (r.rider_id == null) continue;
    if (r.result_type === "stage") {
      const key = stageKey(r.race_id, r.stage_number);
      if (!stageRowsByStage.has(key)) stageRowsByStage.set(key, []);
      stageRowsByStage.get(key).push(r);
      if (!stageRowsByRace.has(r.race_id)) stageRowsByRace.set(r.race_id, []);
      stageRowsByRace.get(r.race_id).push(r);
    } else if (r.result_type === "gc") {
      if (!gcRowsByRace.has(r.race_id)) gcRowsByRace.set(r.race_id, []);
      gcRowsByRace.get(r.race_id).push(r);
    }
  }
  // Endagsloeb (ogsaa monumenter og U23/junior-endagsloeb) gemmes KUN som gc-raekker, aldrig
  // 'stage' (raceRunner: ingen dobbelttaelling). Gc-raekkerne ER etapens finish-order, saa de
  // bruges som etaperesultat, naar loebet ikke har stage-raekker for etape 1.
  for (const [raceId, gcRows] of gcRowsByRace) {
    if ((Number(raceById.get(raceId)?.stages) || 1) > 1) continue;
    const key = stageKey(raceId, 1);
    if (stageRowsByStage.has(key)) continue;
    stageRowsByStage.set(key, gcRows.filter((r) => (Number(r.stage_number) || 1) === 1));
  }
  const abandonsByStage = new Map();
  for (const i of raw.incidents ?? []) {
    if (i.outcome !== "abandon" || i.rider_id == null) continue;
    const key = stageKey(i.race_id, i.stage_number);
    if (!abandonsByStage.has(key)) abandonsByStage.set(key, []);
    abandonsByStage.get(key).push(i);
  }

  const stages = [];
  const seen = new Set();
  const windowStagesByRace = new Map();
  for (const s of raw.schedule ?? []) {
    const key = stageKey(s.race_id, s.stage_number);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!windowStagesByRace.has(s.race_id)) windowStagesByRace.set(s.race_id, new Set());
    windowStagesByRace.get(s.race_id).add(Number(s.stage_number) || 1);
    const race = raceById.get(s.race_id);
    const finishers = [...(stageRowsByStage.get(key) ?? [])].sort((a, b) => a.rank - b.rank);
    if (!race || finishers.length === 0) continue; // ikke afviklet endnu, eller uden resultater
    const profile = profileByStage.get(key) ?? null;
    const finisherIds = new Set(finishers.map((r) => r.rider_id));
    const outOfRace = new Map();
    for (const i of abandonsByStage.get(key) ?? []) if (!finisherIds.has(i.rider_id) && !outOfRace.has(i.rider_id)) outOfRace.set(i.rider_id, i.kind);
    const timeLimit = [...outOfRace].filter(([, k]) => k === "time_limit").map(([id]) => id).sort();
    const others = [...outOfRace].filter(([, k]) => k !== "time_limit").map(([id]) => id).sort();
    let nextRank = Math.max(...finishers.map((r) => r.rank)) + 1;
    const fieldResults = [
      ...finishers.map((r) => ({ rider_id: r.rider_id, rank: r.rank })),
      ...[...timeLimit, ...others].map((id) => ({ rider_id: id, rank: nextRank++ })),
    ];
    const winner = finishers[0];
    let favoriteId = null;
    const obs = observe({ raceId: race.id, profile, results: fieldResults, teamByRider: new Map(finishers.map((r) => [r.rider_id, r.team_id ?? null])) });
    if (obs && obs.favoriteId != null) favoriteId = obs.favoriteId;
    const favRow = favoriteId == null ? null : finishers.find((r) => r.rider_id === favoriteId) ?? null;
    const counts = { crash: 0, illness: 0, fatigue: 0, mechanical: 0 };
    for (const kind of outOfRace.values()) counts[abandonCategory(kind)] += 1;
    stages.push({
      raceId: race.id,
      stageNumber: Number(s.stage_number) || 1,
      group: raceGroupOfRace(race),
      revision: race.engine_rules_revision ?? "ingen",
      profileType: profile?.profile_type ?? null,
      timeTrial: TIME_TRIAL_PROFILES.has(profile?.profile_type),
      winnerId: winner.rider_id,
      winnerInBreakaway: winner.in_breakaway === true,
      favoriteId,
      favoriteWon: favoriteId != null && winner.rider_id === favoriteId,
      favoriteInBreakaway: favRow ? favRow.in_breakaway === true : false,
      starters: fieldResults.length,
      abandons: counts,
    });
  }

  // Afsluttede etapeloeb: alle etaper har resultater, og sidste etape laa i vinduet.
  const races = [];
  for (const [raceId, windowStages] of windowStagesByRace) {
    const race = raceById.get(raceId);
    const total = Number(race?.stages) || 1;
    if (!race || total < 2 || !windowStages.has(total)) continue;
    const rows = stageRowsByRace.get(raceId) ?? [];
    const stagesWithResults = new Set(rows.map((r) => Number(r.stage_number) || 1));
    if (stagesWithResults.size < total) continue;
    const gcRows = gcRowsByRace.get(raceId) ?? [];
    if (!gcRows.length) continue;
    const lastGcStage = Math.max(...gcRows.map((r) => Number(r.stage_number) || 0));
    const winnerRow = gcRows.find((r) => r.rank === 1 && (Number(r.stage_number) || 0) === lastGcStage);
    if (!winnerRow) continue;
    const wonFromBreakaway = rows.some((r) => r.rank === 1 && r.in_breakaway === true && r.rider_id === winnerRow.rider_id);
    races.push({ raceId, group: raceGroupOfRace(race), revision: race.engine_rules_revision ?? "ingen", gcWinnerWonFromBreakaway: wonFromBreakaway });
  }
  return { stages, races };
}

// ── Maal pr. gruppe (REN) ────────────────────────────────────────────────────

export function computeGroupMetrics(facts) {
  const out = {};
  for (const group of GROUPS) {
    const road = facts.stages.filter((s) => s.group === group && !s.timeTrial);
    const gcRaces = GC_RACE_GROUPS.has(group) ? facts.races.filter((r) => r.group === group) : [];
    const known = road.filter((s) => s.favoriteId != null);
    const wins = new Map();
    for (const s of road) wins.set(s.winnerId, (wins.get(s.winnerId) ?? 0) + 1);
    const starters = road.reduce((a, s) => a + s.starters, 0);
    const sum = (key) => road.reduce((a, s) => a + (s.abandons[key] ?? 0), 0);
    const crash = sum("crash");
    const illness = sum("illness");
    const fatigue = sum("fatigue");
    const mechanical = sum("mechanical");
    const revisions = {};
    for (const s of road) revisions[s.revision] = (revisions[s.revision] ?? 0) + 1;
    out[group] = {
      stages: road.length,
      races: new Set(road.map((s) => s.raceId)).size,
      gcRaces: gcRaces.length,
      knownFavoriteStages: known.length,
      revisions,
      values: {
        breakawayWinShare: share(road.filter((s) => s.winnerInBreakaway).length, road.length),
        favoriteWinShare: share(known.filter((s) => s.favoriteWon).length, known.length),
        topRiderWinShare: road.length ? Math.max(...wins.values()) / road.length : null,
        favoriteInBreakawayShare: share(known.filter((s) => s.favoriteInBreakaway).length, known.length),
        gcWinnerFromBreakawayShare: share(gcRaces.filter((r) => r.gcWinnerWonFromBreakaway).length, gcRaces.length),
        abandonShare: share(crash + illness + fatigue + mechanical, starters),
        crashShare: share(crash, starters),
        illnessShare: share(illness, starters),
        fatigueShare: share(fatigue, starters),
      },
    };
  }
  return out;
}

// ── Domme (REN) ──────────────────────────────────────────────────────────────

/** Antal observationer et maal bygger paa (til stikproevegraensen). */
function sampleOf(measureKey, g) {
  if (measureKey === "gcWinnerFromBreakawayShare") return g.gcRaces;
  if (measureKey === "favoriteWinShare" || measureKey === "favoriteInBreakawayShare") return g.knownFavoriteStages;
  return g.stages;
}

export function bandStatus(value, band) {
  if (!finite(value)) return "NODATA";
  if (band.min !== undefined && value < band.min) return "DEVIATION";
  if (band.max !== undefined && value > band.max) return "DEVIATION";
  return "OK";
}

/**
 * Doemmer hver maalt gruppe mod de private baand. Status: OK, DEVIATION, FOR_LIDT (under stikproevegraensen),
 * INGEN_DATA (maalet kan ikke beregnes) eller INFO (intet baand). Kun OK og DEVIATION taelles som gates.
 */
export function evaluate(metrics, thresholds) {
  const groups = {};
  let ok = 0;
  let deviations = 0;
  let tooLittle = 0;
  const deviating = [];
  for (const group of GROUPS) {
    const g = metrics[group];
    const cfg = thresholds.groups[group] ?? { bands: {} };
    const minStages = cfg.minStages ?? thresholds.minStages;
    const rows = [];
    for (const m of MEASURES) {
      const value = g.values[m.key];
      const band = cfg.bands[m.key] ?? null;
      const n = sampleOf(m.key, g);
      let status;
      if (!band) status = "INFO";
      else if (n < minStages) { status = "FOR_LIDT"; tooLittle += 1; }
      else {
        status = bandStatus(value, band);
        if (status === "OK") ok += 1;
        else if (status === "DEVIATION") { deviations += 1; deviating.push({ group, key: m.key, label: m.label }); }
        else tooLittle += 1; // INGEN_DATA tolkes som for lidt data, aldrig som afvigelse
        if (status === "NODATA") status = "INGEN_DATA";
      }
      rows.push({ key: m.key, label: m.label, value, band, n, status });
    }
    groups[group] = { ...g, minStages, rows };
  }
  return { groups, ok, deviations, tooLittle, deviating, gates: ok + deviations };
}

/** Den ene linje der maa staa i Actions-loggen: ingen tal fra maalingerne, kun optaelling. */
export function summaryLine(result) {
  const little = result.tooLittle ? `, ${result.tooLittle} uden nok data` : "";
  return `${result.ok} gates OK / ${result.deviations} afvigelser${little}`;
}

// ── Rapport (REN) ────────────────────────────────────────────────────────────

const pct = (v) => (finite(v) ? `${(Number(v) * 100).toFixed(1)} %` : "-");
const bandText = (b) => (b ? `${b.min !== undefined ? `>= ${(b.min * 100).toFixed(1)} %` : ""}${b.min !== undefined && b.max !== undefined ? ", " : ""}${b.max !== undefined ? `<= ${(b.max * 100).toFixed(1)} %` : ""}` : "-");
const STATUS_TEXT = { OK: "OK", DEVIATION: "AFVIGELSE", FOR_LIDT: "for lidt data", INGEN_DATA: "ingen data", INFO: "info" };

export function renderReport(result, { since, until } = {}) {
  const lines = [];
  lines.push(`# Ugentlig motor-rapport (${since?.slice(0, 10) ?? "?"} til ${until?.slice(0, 10) ?? "?"})`);
  lines.push(`**${summaryLine(result)}**`);
  lines.push("_Rigtige afviklede etaper. Favoritten er den bedste rytter paa etapens afslutning efter rytterens nuvaerende evner (ikke et snapshot paa etapedagen). Tidskoersler er ikke med._");
  for (const group of GROUPS) {
    const g = result.groups[group];
    const revs = Object.entries(g.revisions).sort().map(([r, n]) => `${r}: ${n}`).join(", ") || "-";
    lines.push("");
    lines.push(`## ${GROUP_LABELS[group]}`);
    lines.push(`${g.stages} etaper i ${g.races} loeb, ${g.gcRaces} afsluttede etapeloeb. Motorrevision (etaper): ${revs}.`);
    if (g.stages === 0) continue;
    for (const r of g.rows) {
      const flag = r.status === "DEVIATION" ? "**AFVIGELSE** " : "";
      lines.push(`- ${flag}${r.label}: ${pct(r.value)} (n=${r.n}) graense ${bandText(r.band)} [${STATUS_TEXT[r.status]}]`);
    }
  }
  return lines.join("\n");
}

export function alarmText(result) {
  const names = result.deviating.map((d) => `${GROUP_LABELS[d.group]}: ${d.label}`);
  return `Motor-drift: ${result.deviations} afvigelser fra graenserne (${summaryLine(result)}). ${names.join("; ")}.`;
}

/** Splitter en rapport i stykker under Discords embed-grænse (4096 tegn), paa linjegraenser. */
export function splitReport(text, max = 3800) {
  const parts = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > max) { parts.push(cur); cur = ""; }
    cur += (cur ? "\n" : "") + line.slice(0, max);
  }
  if (cur) parts.push(cur);
  return parts;
}

export function buildPayloads(result, reportText, { mention = getOpsMention() } = {}) {
  const color = result.deviations > 0 ? 0xe74c3c : 0x2ecc71;
  const parts = splitReport(reportText);
  const payloads = [];
  if (result.deviations > 0) {
    payloads.push(withOpsMention({ embeds: [clampEmbed({ title: "Motor-drift: afvigelse", description: alarmText(result), color })] }, mention));
  }
  parts.forEach((description, i) => {
    payloads.push({ embeds: [clampEmbed({ title: i === 0 ? "Ugentlig motor-rapport" : `Ugentlig motor-rapport (${i + 1}/${parts.length})`, description, color })] });
  });
  return payloads;
}

// ── IO (kun SELECT) ──────────────────────────────────────────────────────────

/** En klient der kun kan laese: from(tabel).select(...) og de filtre select returnerer. Alt andet findes ikke. */
export function makeReadOnlyClient(client) {
  return { from: (table) => ({ select: (...args) => client.from(table).select(...args) }) };
}

export function windowOf({ days = 7, until = null, now = new Date() } = {}) {
  const end = until ? new Date(until) : now;
  if (Number.isNaN(end.getTime())) throw new Error("WEEKLY_DRIFT_UNTIL er ikke et gyldigt tidspunkt");
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) throw new Error("WEEKLY_DRIFT_DAYS er ikke et positivt tal");
  return { since: new Date(end.getTime() - d * 86_400_000).toISOString(), until: end.toISOString() };
}

const V4_MODULES = Object.freeze({
  observers: new URL("../lib/headToHeadObservers.js", import.meta.url).href,
  tuning: new URL("../../lib/engine/v4/tuning.ts", import.meta.url).href,
  entrants: new URL("../../lib/engine/v4/adapters/entrantAdapter.ts", import.meta.url).href,
  abilities: new URL("../../lib/abilityRegistry.js", import.meta.url).href,
});

/** Favorit-observeren: samme definition som drift-vagten (observeStageV4 + entrantFromAbilitiesRow). */
export async function loadFavoriteModules(importModule = (href) => import(href)) {
  const [observers, tuning, entrants, abilities] = await Promise.all([
    importModule(V4_MODULES.observers), importModule(V4_MODULES.tuning), importModule(V4_MODULES.entrants), importModule(V4_MODULES.abilities),
  ]);
  return { observeStageV4: observers.observeStageV4, tuning: tuning.RACE_V4_TUNING, entrantFromAbilitiesRow: entrants.entrantFromAbilitiesRow, abilityKeys: abilities.REGISTRY_ABILITY_KEYS };
}

export function makeObserve(modules, abilityRowByRider) {
  return ({ raceId, profile, results, teamByRider }) => {
    const entrants = {};
    for (const r of results) {
      const row = abilityRowByRider.get(r.rider_id);
      if (row) entrants[r.rider_id] = modules.entrantFromAbilitiesRow(row, { riderId: r.rider_id });
    }
    return modules.observeStageV4({ results, entrants, teamByRider, route: { finale_type: profile?.finale_type ?? null }, tuning: modules.tuning, raceId, terrain: profile?.profile_type ?? undefined });
  };
}

/** Henter raa raekker for ugens afviklede etaper. Kun SELECT; alle loads pagineres. */
export async function fetchRaw(db, { since, until, abilityKeys = [] }) {
  const schedule = await fetchAllRows(() =>
    db.from("race_stage_schedule").select("race_id, stage_number, scheduled_at").gte("scheduled_at", since).lt("scheduled_at", until).order("race_id").order("stage_number"));
  const raceIds = [...new Set(schedule.map((s) => s.race_id))].sort();
  if (!raceIds.length) return { schedule, races: [], results: [], incidents: [], profiles: [], abilityRows: [] };
  const races = await fetchAllRowsChunkedIn(raceIds, (ids) =>
    db.from("races").select("id, stages, race_class, squad, engine_rules_revision").in("id", ids).order("id"), { chunkSize: IN_CHUNK });
  const results = [];
  for (let i = 0; i < raceIds.length; i += IN_CHUNK) {
    const chunk = raceIds.slice(i, i + IN_CHUNK);
    results.push(...await fetchAllRowsKeyset((after) => {
      let q = db.from("race_results").select("id, race_id, stage_number, result_type, rank, rider_id, team_id, in_breakaway").in("race_id", chunk).in("result_type", ["stage", "gc"]).order("id");
      if (after != null) q = q.gt("id", after);
      return q;
    }));
  }
  const incidents = await fetchAllRowsChunkedIn(raceIds, (ids) =>
    db.from("race_incidents").select("id, race_id, stage_number, rider_id, kind, outcome").in("race_id", ids).eq("outcome", "abandon").order("id"), { chunkSize: IN_CHUNK });
  const profiles = await fetchAllRowsChunkedIn(raceIds, (ids) =>
    db.from("race_stage_profiles").select("id, race_id, stage_number, profile_type, finale_type").in("race_id", ids).order("id"), { chunkSize: IN_CHUNK });
  // Baade stage- og gc-raekker: endagsloeb har kun gc-raekker (se buildFacts).
  const riderIds = [...new Set(results.map((r) => r.rider_id).concat(incidents.map((i) => i.rider_id)).filter(Boolean))].sort();
  const abilityRows = abilityKeys.length
    ? await fetchAllRowsChunkedIn(riderIds, (ids) => db.from("rider_derived_abilities").select(["rider_id", ...abilityKeys].join(", ")).in("rider_id", ids).order("rider_id"), { chunkSize: IN_CHUNK })
    : [];
  return { schedule, races, results, incidents, profiles, abilityRows };
}

async function postDiscord(fetchFn, url, payload) {
  try {
    const res = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
    return res.ok;
  } catch {
    return false;
  }
}

export function missingEnv(env) {
  return ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "ENGINE_GATE_THRESHOLDS_JSON", "DISCORD_OPS_WEBHOOK_URL"].filter((k) => !String(env[k] ?? "").trim());
}

function isMain() {
  try {
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? "");
  } catch {
    return false;
  }
}

/**
 * Kører rapporten. Alt IO kan injiceres (tests). Returnerer exit-koden; logger kun resumeet.
 */
export async function main({
  env = process.env,
  fetchFn = fetch,
  log = (s) => console.log(s),
  errorLog = (s) => console.error(s),
  makeDb = null,
  loadModules = loadFavoriteModules,
  now = new Date(),
} = {}) {
  const dry = ["1", "true"].includes(String(env.WEEKLY_DRIFT_DRY_RUN ?? "").toLowerCase());
  const required = dry ? ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "ENGINE_GATE_THRESHOLDS_JSON"] : null;
  const missing = required ? required.filter((k) => !String(env[k] ?? "").trim()) : missingEnv(env);
  if (missing.length) {
    errorLog(`weekly-engine-drift: mangler env ${missing.join(", ")}`);
    return 2;
  }
  let thresholds;
  let win;
  try {
    thresholds = parseThresholds(env.ENGINE_GATE_THRESHOLDS_JSON);
    win = windowOf({ days: env.WEEKLY_DRIFT_DAYS || 7, until: env.WEEKLY_DRIFT_UNTIL || null, now });
  } catch (err) {
    errorLog(`weekly-engine-drift: konfigurationsfejl: ${err.message}`);
    return 2;
  }
  let result;
  let report;
  try {
    let db;
    if (makeDb) db = makeDb(env);
    else {
      const [{ createClient }, wsMod] = await Promise.all([import("@supabase/supabase-js"), import("ws")]);
      db = makeReadOnlyClient(createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, realtime: { transport: wsMod.default } }));
    }
    const modules = await loadModules();
    const raw = await fetchRaw(db, { ...win, abilityKeys: modules.abilityKeys });
    const abilityRowByRider = new Map(raw.abilityRows.map((a) => [a.rider_id, a]));
    const facts = buildFacts(raw, { observe: makeObserve(modules, abilityRowByRider) });
    result = evaluate(computeGroupMetrics(facts), thresholds);
    report = renderReport(result, win);
  } catch (err) {
    errorLog(`weekly-engine-drift: datafejl (${err?.name ?? "Error"})`);
    return 3;
  }
  log(`weekly-engine-drift: ${summaryLine(result)}`);

  if (env.WEEKLY_DRIFT_OUT) {
    const segments = path.resolve(env.WEEKLY_DRIFT_OUT).split(/[\\/]+/);
    if (!segments.includes("balance-internals")) {
      errorLog("weekly-engine-drift: WEEKLY_DRIFT_OUT skal ligge under en balance-internals/-mappe (hard rule 17)");
      return 2;
    }
    writeFileSync(env.WEEKLY_DRIFT_OUT, `${report}\n`);
  }
  if (!dry) {
    const rawMention = String(env.DISCORD_OPS_MENTION ?? "").trim();
    const mention = !rawMention ? null : /^\d+$/.test(rawMention) ? `<@${rawMention}>` : rawMention;
    for (const payload of buildPayloads(result, report, { mention })) {
      if (!await postDiscord(fetchFn, env.DISCORD_OPS_WEBHOOK_URL.trim(), payload)) {
        errorLog("weekly-engine-drift: kunne ikke sende rapporten til Discord-ops");
        return 3;
      }
    }
  }
  return result.deviations > 0 ? 1 : 0;
}

if (isMain()) {
  main().then((code) => process.exit(code), () => { console.error("weekly-engine-drift: uventet fejl"); process.exit(3); });
}
