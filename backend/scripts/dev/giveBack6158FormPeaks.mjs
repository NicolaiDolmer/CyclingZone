// #6158 · Giv formtoppe brugt uden virkning under v4 tilbage til managerne.
//
// Spec: docs/superpowers/specs/2026-10-04-form-og-formtoppe-i-v4-design.md §4.
// Ejer-valg 4/10 (kort 2): toppene gives tilbage. Køres SAMMEN med tændingen af
// #6156 (form + toppe i v4), ikke før. Prod-skrivning kun efter ordret ejer-go på
// dry-run-tallene, og ejeren ser tilstanden live først.
//
// REGLEN (spec §4)
//   En top gives tilbage, hvis den ikke kan have fået virkning:
//   A) dens vindue startede fra S4's start og frem til tændingen, eller
//   B) dens målløb er startet før tændingen (løbet kører færdigt uden form,
//      ejer-beslutning 4), uanset hvor vinduet ligger.
//   Ingen top må både tælle i et løb og gives tilbage: har et løb der startede
//   EFTER tændingen allerede kørt en etape med rytteren inde i vinduet, har toppen
//   virket og beholdes ("talt"). Tilbagegivne toppe udløser intet dyk.
//
// HVORDAN EN TOP BLIVER PLANLÆGBAR IGEN (afklaret 7/10, læst i koden)
//   - Kvoten (riderPeakPlans.MAX_PEAK_PLANS_PER_SEASON) tælles som antal RÆKKER i
//     rider_peak_plans for (rytter, sæson) i POST /peak-plans og /peak-plans/bulk.
//   - Låsen er ikke en kolonne der kan slås fra: riderPeakPlans.isPlanLocked
//     udleder den ved læse-tid fra window_start (nu >= window_start), og
//     lockGuardForWrite stempler locked_at ved første skriveforsøg derefter.
//   - Motoren og dykket læser vinduet fra SAMME række (racePeakPlans.loadPeakPlans
//     henter alle rytterens vinduer i sæsonen; dykket ligger i dagene efter
//     window_end, racePeaks.peakPhaseForWindow).
//   Derfor er "giv tilbage" = slet rækken (efter backup). Det frigiver pladsen i
//   kvoten, fjerner låsen sammen med rækken, og der findes intet vindue at give et
//   dyk efter. Alternativerne frigiver ikke pladsen: at nulle target_race_id
//   efterlader en række der stadig tæller i kvoten (og som motoren springer over,
//   #4294), og at flytte window_start frem ville være et vindue ingen manager har
//   valgt. Manageren opretter derefter en ny plan som normalt: målet skal være et
//   seniorløb i holdets kalender der ikke er startet (#5992), og rytteren skal stå
//   i seniortruppen. Det samme målløb kan vælges igen, hvis det ikke er startet
//   (UNIQUE(rider, season, target) rammer ikke, rækken er væk); vinduet snappes så
//   igen om løbet og er låst fra sin startdato som alle andre planer.
//
// HVAD SCRIPTET GØR
//   Standard (ingen flag): READ-ONLY dry-run. Ingen skrivning til databasen.
//     Skriver en PRIVAT rapport (rytter-id'er, holdnavne, tal) + json + snapshot-
//     SQL + restore-SQL til balance-internals/6158/ (gitignoreret). Konsollen får
//     kun samlede tal og liste-hashen.
//   --ignition=<ISO-tidspunkt>: tændingstidspunktet. Default "nu" (prognose).
//     Et tidspunkt i fremtiden giver en prognose for den dag.
//   --apply --owner-go=6158-production --approved-list=<hash> --ignition=<ISO>:
//     sletter præcis de godkendte planer. Kræver eksplicit --ignition (ellers ville
//     "nu" ved en sen kørsel flytte reglens grænse). Afbryder FØR første skrivning,
//     hvis den levende liste afviger fra den godkendte (hash), eller hvis backup-
//     tabellen (backup_6158_rider_peak_plans) ikke dækker alle planer.
//     Idempotent: hashen dækker "levende kandidater + allerede tilbagegivne"
//     (i backup, ikke længere i tabellen), så en genkørsel efter et afbrudt apply
//     matcher samme hash og sletter kun resten. Verificerer bagefter at ingen af de
//     godkendte planer findes mere.
//
// SCOPE
//   Kun den aktive sæson (S4) og kun ryttere på menneskehold (ikke bank, ikke
//   frosset, ikke testkonto, samme ejendomsfilter som #5864). Planer uden for scope
//   og planer uden målløb listes separat og røres ikke.
//
//   node backend/scripts/dev/giveBack6158FormPeaks.mjs
//   node backend/scripts/dev/giveBack6158FormPeaks.mjs --ignition=2026-10-12T08:00:00+02:00
//   node backend/scripts/dev/giveBack6158FormPeaks.mjs --apply --owner-go=6158-production --approved-list=<hash> --ignition=<ISO>

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../../lib/supabasePagination.js";
import { copenhagenDateString } from "../../lib/copenhagenTime.js";
import { dateStringToOrdinal, scheduledAtToOrdinal } from "../../lib/racePeakPlans.js";
import { peakPhaseForWindow } from "../../lib/racePeaks.js";
import { RACE_V3_TUNING } from "../../lib/raceRoles.js";
import { peakTargetRaceStarted, plannerSquadFor } from "../../lib/peakTargetScope.js";
import { MAX_PEAK_PLANS_PER_SEASON } from "../../lib/riderPeakPlans.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "../../..");
export const PRIVATE_DIR = join(REPO_ROOT, "balance-internals", "6158");

export const OWNER_GO_FLAG = "--owner-go=6158-production";
export const BACKUP_TABLE = "backup_6158_rider_peak_plans";

const PLAN_COLUMNS = "id, rider_id, season_id, target_race_id, window_start, window_end, locked_at, created_at";
const RIDER_COLUMNS = "id, firstname, lastname, team_id, squad, is_academy, is_retired";
const TEAM_COLUMNS = "id, name, is_ai, is_frozen, is_bank, is_test_account, parked_at, retired_at";
const RACE_COLUMNS = "id, name, season_id, status, stages, stages_completed, squad";
// Kvoten hentes fra koden, ikke hardkodet i restore-SQL'en (én kilde).
const RIDER_PLAN_QUOTA_SQL = String(MAX_PEAK_PLANS_PER_SEASON);

// ── Argumenter ──────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const opts = { apply: false, ownerGo: false, approvedHash: null, ignition: null };
  for (const arg of argv) {
    if (arg === "--apply") opts.apply = true;
    else if (arg === OWNER_GO_FLAG) opts.ownerGo = true;
    else if (arg.startsWith("--owner-go=")) throw new Error("Wrong owner-go token");
    else if (arg.startsWith("--approved-list=")) {
      const h = arg.slice("--approved-list=".length);
      if (!/^[a-f0-9]{64}$/.test(h)) throw new Error("--approved-list must be the 64-char list hash printed by the dry-run");
      opts.approvedHash = h;
    } else if (arg.startsWith("--ignition=")) {
      const raw = arg.slice("--ignition=".length);
      const ms = Date.parse(raw);
      if (!raw || !Number.isFinite(ms)) throw new Error("--ignition must be an ISO timestamp, e.g. 2026-10-12T08:00:00+02:00");
      opts.ignition = new Date(ms).toISOString();
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (opts.ownerGo && !opts.apply) throw new Error("--owner-go only makes sense together with --apply");
  if (opts.apply && !opts.ownerGo) throw new Error(`--apply requires ${OWNER_GO_FLAG} (owner must have seen the live list)`);
  if (opts.apply && opts.approvedHash === null) {
    throw new Error("--apply requires --approved-list=<list hash from the dry-run the owner approved>");
  }
  if (opts.apply && opts.ignition === null) {
    throw new Error("--apply requires an explicit --ignition=<ISO> (the same one the approved dry-run used)");
  }
  return opts;
}

// ── Rene klassifikationer ───────────────────────────────────────────────────

/** Samme ejendomsfilter som #5864 + kun menneskehold. */
export function isInScopeTeam(team) {
  return !!team && team.is_ai === false && team.is_bank === false && team.is_frozen === false && team.is_test_account === false;
}

/** Hvorfor en plan er uden for scope (eller null hvis den er med). */
export function outOfScopeReason(rider, team) {
  if (!rider) return "rider_missing";
  if (rider.is_retired === true) return "retired_rider";
  if (!team) return "no_team";
  if (team.is_ai !== false) return "ai_team";
  if (team.is_bank) return "bank";
  if (team.is_test_account) return "test_account";
  if (team.is_frozen) return "frozen";
  return null;
}

/** Tidligste etape-tidspunkt pr. løb fra race_stage_schedule-rækker. */
export function firstStageAtByRace(scheduleRows) {
  const out = new Map();
  for (const row of scheduleRows || []) {
    const ms = Date.parse(row?.scheduled_at);
    if (!row?.race_id || !Number.isFinite(ms)) continue;
    const prev = out.get(row.race_id);
    if (prev == null || ms < prev) out.set(row.race_id, ms);
  }
  return out;
}

/**
 * Er målløbet startet før tændingen? Etapeplanen afgør (første etape før
 * tændingstidspunktet), så en prognose med en fremtidig tænding også fanger løb
 * der når at starte inden. Uden etapeplan falder vi tilbage på løbets status
 * (peakTargetRaceStarted, samme definition som planlæggeren, #5992).
 */
export function targetStartedBeforeIgnition(race, firstStageMs, ignitionMs) {
  if (firstStageMs != null) return firstStageMs < ignitionMs;
  return peakTargetRaceStarted(race);
}

/**
 * Har toppen TALT i et løb efter tændingen? `postIgnitionStages` er kørte etaper
 * (rytter, CET-dag-ordinal) i løb hvis første etape ligger på eller efter
 * tændingen, altså løb der kører på de nye regler. En etape inde i vinduet =
 * toppen har virket. En etape i dagene lige efter vinduet = dykket er allerede
 * mærket (kun informativt; toppen har så alligevel ikke virket).
 */
export function countedAfterIgnition(plan, stagesForRider, paybackDays = RACE_V3_TUNING.PEAK_PAYBACK_DAYS) {
  const start = dateStringToOrdinal(plan.window_start);
  const end = dateStringToOrdinal(plan.window_end);
  const res = { counted: false, countedRaceIds: [], dipFelt: false };
  if (start == null || end == null) return res;
  for (const s of stagesForRider || []) {
    const phase = peakPhaseForWindow(s.dayOrdinal, start, end, paybackDays);
    if (phase === "peak") {
      res.counted = true;
      if (!res.countedRaceIds.includes(s.raceId)) res.countedRaceIds.push(s.raceId);
    } else if (phase === "payback") res.dipFelt = true;
  }
  return res;
}

/**
 * Byg hele planen ud fra rå, allerede-hentede rækker. Ren funktion (ingen I/O).
 *
 * @param {object} p
 * @param {{id:string, number:number, start_date:string}} p.season
 * @param {object[]} p.plans                 rider_peak_plans for sæsonen
 * @param {Map<string,object>} p.ridersById
 * @param {Map<string,object>} p.teamsById
 * @param {Map<string,object>} p.racesById   målløbene
 * @param {Map<string,number>} p.firstStageMs race_id → første etapes tidspunkt (ms)
 * @param {Map<string,Array<{raceId:string, dayOrdinal:number}>>} p.postIgnitionStagesByRider
 * @param {string[]} [p.alreadyGivenBackIds]  i backup, ikke længere i tabellen
 * @param {string} p.ignitionAt              ISO
 */
export function buildPlan({ season, plans, ridersById, teamsById, racesById, firstStageMs, postIgnitionStagesByRider, alreadyGivenBackIds = [], ignitionAt }) {
  const ignitionMs = Date.parse(ignitionAt);
  if (!Number.isFinite(ignitionMs)) throw new Error("ignitionAt must be a valid timestamp");
  const ignitionDay = dateStringToOrdinal(copenhagenDateString(new Date(ignitionMs)));
  const seasonStartDay = dateStringToOrdinal(season?.start_date);
  if (seasonStartDay == null) throw new Error("Active season has no start_date");

  const rows = [];
  const outOfScope = [];
  const orphans = [];
  for (const p of plans || []) {
    const rider = ridersById.get(p.rider_id) || null;
    const team = rider?.team_id ? teamsById.get(rider.team_id) || null : null;
    const reason = outOfScopeReason(rider, team);
    if (reason) {
      outOfScope.push({ planId: p.id, riderId: p.rider_id, teamId: rider?.team_id ?? null, reason });
      continue;
    }
    if (!p.target_race_id) {
      // Kan ikke have virket (motoren springer den over, #4294), men falder uden for
      // ejerens to regler. Listes til ejeren, røres ikke.
      orphans.push({ planId: p.id, riderId: p.rider_id, teamId: rider.team_id });
      continue;
    }
    const race = racesById.get(p.target_race_id) || null;
    const windowStart = dateStringToOrdinal(p.window_start);
    const windowStarted = windowStart != null && windowStart >= seasonStartDay && windowStart <= ignitionDay;
    const targetStarted = targetStartedBeforeIgnition(race, firstStageMs.get(p.target_race_id) ?? null, ignitionMs);
    const c = countedAfterIgnition(p, postIgnitionStagesByRider.get(p.rider_id));
    const rules = [];
    if (windowStarted) rules.push("window_started");
    if (targetStarted) rules.push("target_started");

    let outcome = "keep_will_work";
    if (c.counted) outcome = "keep_counted_after_ignition";
    else if (rules.length) outcome = "give_back";

    const stages = Number(race?.stages) || 0;
    const done = Number(race?.stages_completed) || 0;
    rows.push({
      planId: p.id,
      riderId: p.rider_id,
      name: `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim(),
      teamId: rider.team_id,
      targetRaceId: p.target_race_id,
      targetRaceName: race?.name ?? null,
      windowStart: p.window_start,
      windowEnd: p.window_end,
      lockedAt: p.locked_at ?? null,
      rules,
      outcome,
      countedRaceIds: c.countedRaceIds,
      dipFelt: c.dipFelt,
      // Følgeeffekt til go-kortet: målløbet var i gang ved tændingen (etapeløb).
      targetInProgressAtIgnition: targetStarted && stages > 1 && done < stages,
      // Planlægbar igen? Pladsen frigives altid; det samme mål kan kun vælges igen
      // hvis det ikke er startet, og kun en seniorrytter kan planlægges.
      riderSeniorNow: plannerSquadFor(rider) === "senior",
      sameTargetReplannable: !targetStarted,
    });
  }

  const giveBack = rows.filter((r) => r.outcome === "give_back");
  const teams = new Map();
  for (const r of giveBack) {
    if (!teams.has(r.teamId)) {
      const t = teamsById.get(r.teamId);
      teams.set(r.teamId, { teamId: r.teamId, name: t?.name ?? null, parked: t?.parked_at != null, plans: 0, riders: new Set() });
    }
    const t = teams.get(r.teamId);
    t.plans++;
    t.riders.add(r.riderId);
  }
  const teamList = [...teams.values()].map((t) => ({ ...t, riders: t.riders.size }));

  const totals = {
    ignitionAt: new Date(ignitionMs).toISOString(),
    seasonNumber: season.number,
    seasonStart: season.start_date,
    plansInSeason: (plans || []).length,
    outOfScope: outOfScope.length,
    outOfScopeByReason: countBy(outOfScope, (x) => x.reason),
    orphansNoTarget: orphans.length,
    inScope: rows.length,
    giveBack: giveBack.length,
    giveBackByRule: {
      window_started_only: giveBack.filter((r) => r.rules.length === 1 && r.rules[0] === "window_started").length,
      target_started_only: giveBack.filter((r) => r.rules.length === 1 && r.rules[0] === "target_started").length,
      both: giveBack.filter((r) => r.rules.length === 2).length,
    },
    keepCountedAfterIgnition: rows.filter((r) => r.outcome === "keep_counted_after_ignition").length,
    keepWillWork: rows.filter((r) => r.outcome === "keep_will_work").length,
    giveBackLocked: giveBack.filter((r) => r.lockedAt != null).length,
    giveBackTargetInProgress: giveBack.filter((r) => r.targetInProgressAtIgnition).length,
    giveBackDipAlreadyFelt: giveBack.filter((r) => r.dipFelt).length,
    giveBackRiderNotSenior: giveBack.filter((r) => !r.riderSeniorNow).length,
    giveBackSameTargetReplannable: giveBack.filter((r) => r.sameTargetReplannable).length,
    giveBackRiders: new Set(giveBack.map((r) => r.riderId)).size,
    giveBackTeams: teamList.length,
    giveBackTeamsParked: teamList.filter((t) => t.parked).length,
    alreadyGivenBack: alreadyGivenBackIds.length,
  };
  return { rows, teams: teamList, outOfScope, orphans, alreadyGivenBackIds: [...alreadyGivenBackIds], totals };
}

function countBy(list, keyFn) {
  const out = {};
  for (const x of list) {
    const k = keyFn(x);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/** Plan-id'er apply sletter (levende kandidater). */
export function giveBackIds(plan) {
  return plan.rows.filter((r) => r.outcome === "give_back").map((r) => r.planId);
}

/**
 * Fingeraftryk af præcis den plan-mængde ejeren har set: levende kandidater +
 * allerede tilbagegivne (fra et tidligere, evt. afbrudt apply). Rækkefølge-
 * uafhængig. En plan der er kommet til, faldet ud eller er begyndt at tælle siden
 * dry-run'et giver en ny hash, og apply afbryder.
 */
export function approvedListHash(plan) {
  const ids = [...new Set([...giveBackIds(plan), ...plan.alreadyGivenBackIds].map(String))].sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex");
}

// ── SQL: snapshot + restore ────────────────────────────────────────────────

function uuidList(ids) {
  for (const id of ids) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new Error(`Unexpected plan id format: ${id}`);
  }
  return ids.map((id) => `'${id}'`).join(",\n  ");
}

/**
 * Snapshot-SQL (køres FØR apply, fx via Supabase MCP execute_sql efter ejer-go).
 * Idempotent: `create table if not exists` + `on conflict do nothing`, så en
 * genkørsel aldrig overskriver det oprindelige før-billede.
 */
export function buildSnapshotSql(planIds) {
  if (!planIds.length) return "-- #6158: ingen planer at give tilbage, intet snapshot nødvendigt\n";
  const ids = uuidList(planIds);
  return `-- #6158 snapshot FØR tilbagegivelse af formtoppe. Idempotent.
begin;
create table if not exists public.${BACKUP_TABLE} as
  select ${PLAN_COLUMNS}, now() as backed_up_at
  from public.rider_peak_plans where false;
alter table public.${BACKUP_TABLE} enable row level security;
create unique index if not exists ${BACKUP_TABLE}_id on public.${BACKUP_TABLE}(id);
insert into public.${BACKUP_TABLE}
  select ${PLAN_COLUMNS}, now()
  from public.rider_peak_plans where id in (
  ${ids}
  )
on conflict (id) do nothing;
commit;
notify pgrst, 'reload schema';
-- Verificér: select count(*) from public.${BACKUP_TABLE}; (skal være mindst ${planIds.length})
`;
}

/**
 * Restore-SQL: genindsæt de tilbagegivne planer fra backup. Springer en plan over,
 * hvis rytteren siden har brugt pladsen igen (kvoten ville ellers blive brudt) eller
 * har en plan mod samme mål (UNIQUE). Rytteren skal stadig eksistere (FK).
 */
export function buildRestoreSql() {
  return `-- #6158 restore: rul tilbagegivelsen tilbage fra ${BACKUP_TABLE}. Ejer-gated.
-- NB: kvoten tjekkes mod tabellen FØR indsættelsen; har en rytter to backup-planer
-- og én ny plan, kan han ende over kvoten. Tjek bagefter med forespørgslen nederst.
begin;
insert into public.rider_peak_plans (${PLAN_COLUMNS})
  select b.id, b.rider_id, b.season_id, b.target_race_id, b.window_start, b.window_end, b.locked_at, b.created_at
  from public.${BACKUP_TABLE} b
  join public.riders r on r.id = b.rider_id
  where not exists (select 1 from public.rider_peak_plans p where p.id = b.id)
    and (select count(*) from public.rider_peak_plans p where p.rider_id = b.rider_id and p.season_id = b.season_id) < ${RIDER_PLAN_QUOTA_SQL}
on conflict do nothing;
commit;
-- Over kvoten efter restore:
-- select rider_id, season_id, count(*) from public.rider_peak_plans group by 1, 2 having count(*) > ${RIDER_PLAN_QUOTA_SQL};
`;
}

// ── Privat rapport ──────────────────────────────────────────────────────────

const OUTCOME_LABEL = {
  give_back: "gives tilbage",
  keep_counted_after_ignition: "BEHOLDES (har talt efter tændingen)",
  keep_will_work: "beholdes (virker efter tændingen)",
};
const RULE_LABEL = { window_started: "A vindue startet", target_started: "B målløb startet" };

export function renderPrivateReport(plan, { generatedAt }) {
  const t = plan.totals;
  const lines = [];
  lines.push(`# #6158 dry-run: formtoppe brugt uden virkning under v4 (PRIVAT)`);
  lines.push("");
  lines.push(`Genereret ${generatedAt}. Sæson ${t.seasonNumber} (start ${t.seasonStart}). Tænding ${t.ignitionAt}. Ingen skrivning udført.`);
  lines.push("");
  lines.push("## Samlet");
  lines.push(`- Planer i sæsonen: ${t.plansInSeason}`);
  lines.push(`- Uden for scope (røres ikke): ${t.outOfScope} ${JSON.stringify(t.outOfScopeByReason)}`);
  lines.push(`- Uden målløb (kan ikke have virket, men uden for de to regler, røres ikke): ${t.orphansNoTarget}`);
  lines.push(`- I scope: ${t.inScope}`);
  lines.push(`- **Gives tilbage: ${t.giveBack}** på ${t.giveBackRiders} ryttere og ${t.giveBackTeams} hold (heraf parkerede hold: ${t.giveBackTeamsParked})`);
  lines.push(`  - Kun regel A (vindue startet fra sæsonstart til tænding): ${t.giveBackByRule.window_started_only}`);
  lines.push(`  - Kun regel B (målløb startet før tænding): ${t.giveBackByRule.target_started_only}`);
  lines.push(`  - Begge regler: ${t.giveBackByRule.both}`);
  lines.push(`  - Med hård lås (locked_at stemplet): ${t.giveBackLocked}`);
  lines.push(`  - Dykket allerede mærket i et løb efter tændingen: ${t.giveBackDipAlreadyFelt}`);
  lines.push(`- Beholdes fordi toppen har talt i et løb efter tændingen: ${t.keepCountedAfterIgnition}`);
  lines.push(`- Beholdes fordi den virker efter tændingen: ${t.keepWillWork}`);
  lines.push(`- Allerede givet tilbage (i backup, ikke i tabellen): ${t.alreadyGivenBack}`);
  lines.push(`- Liste-hash (apply kræver \`--approved-list=\` med netop denne og samme \`--ignition=\`): \`${approvedListHash(plan)}\``);
  lines.push("");
  lines.push("## Følgeeffekt til go-kortet");
  lines.push(`- ${t.giveBackTargetInProgress} tilbagegivne toppe hører til et etapeløb der er i gang ved tændingen. Manageren får toppen tilbage, men kan først bruge den i et løb der starter efter tændingen.`);
  lines.push(`- ${t.giveBackRiderNotSenior} tilbagegivne toppe hører til ryttere der ikke står i seniortruppen nu; de kan ikke planlægges igen før rytteren er senior (#5992).`);
  lines.push(`- ${t.giveBackSameTargetReplannable} tilbagegivne toppe har et målløb der ikke er startet; det samme løb kan vælges igen.`);
  lines.push("");
  lines.push("## Sådan bliver en tilbagegivet top planlægbar igen");
  lines.push("- Tilbagegivelse = rækken i `rider_peak_plans` slettes (efter backup). Kvoten tælles som rækker pr. (rytter, sæson), så pladsen er fri med det samme.");
  lines.push("- Låsen udledes fra `window_start` (og et evt. `locked_at`-stempel) på selve rækken. Ingen række, ingen lås.");
  lines.push("- Motoren og dykket læser vinduet fra samme række. Ingen række, intet vindue, intet dyk.");
  lines.push("- Manageren opretter en ny plan som normalt: målet skal være et seniorløb i holdets kalender der ikke er startet, og rytteren skal være senior. Det nye vindue snappes om målløbet og er låst fra sin startdato.");
  lines.push("- Fravalgt: at nulle `target_race_id` (rækken tæller stadig i kvoten) og at flytte `window_start` (et vindue ingen manager har valgt).");
  lines.push("");
  lines.push("## Hold");
  lines.push("| Hold | Status | Toppe tilbage | Ryttere |");
  lines.push("|---|---|---|---|");
  for (const team of [...plan.teams].sort((a, b) => (b.plans - a.plans) || String(a.name).localeCompare(String(b.name)))) {
    lines.push(`| ${team.name} | ${team.parked ? "parkeret" : "aktiv"} | ${team.plans} | ${team.riders} |`);
  }
  lines.push("");
  lines.push("## Planer i scope");
  lines.push("| Rytter | Rytter-id | Hold | Målløb | Vindue | Regler | Udfald | Låst | I gang ved tænding | Senior nu | Samme mål igen | Plan-id |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  const teamName = new Map(plan.teams.map((x) => [x.teamId, x.name]));
  const sorted = [...plan.rows].sort((a, b) => a.outcome.localeCompare(b.outcome) || String(teamName.get(a.teamId) ?? a.teamId).localeCompare(String(teamName.get(b.teamId) ?? b.teamId)) || a.name.localeCompare(b.name));
  for (const r of sorted) {
    lines.push(`| ${r.name} | ${r.riderId} | ${teamName.get(r.teamId) ?? r.teamId} | ${r.targetRaceName ?? r.targetRaceId} | ${r.windowStart} til ${r.windowEnd} | ${r.rules.map((x) => RULE_LABEL[x]).join(", ") || "-"} | ${OUTCOME_LABEL[r.outcome]} | ${r.lockedAt ? "ja" : "nej"} | ${r.targetInProgressAtIgnition ? "ja" : "nej"} | ${r.riderSeniorNow ? "ja" : "nej"} | ${r.sameTargetReplannable ? "ja" : "nej"} | ${r.planId} |`);
  }
  if (plan.outOfScope.length || plan.orphans.length) {
    lines.push("");
    lines.push("## Uden for scope og uden målløb (røres ikke)");
    lines.push("| Plan-id | Rytter-id | Hold-id | Årsag |");
    lines.push("|---|---|---|---|");
    for (const o of plan.outOfScope) lines.push(`| ${o.planId} | ${o.riderId} | ${o.teamId ?? "-"} | ${o.reason} |`);
    for (const o of plan.orphans) lines.push(`| ${o.planId} | ${o.riderId} | ${o.teamId ?? "-"} | no_target_race |`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Konsol-output: KUN samlede tal (ingen id'er, ingen navne). */
export function renderPublicSummary(plan) {
  const t = plan.totals;
  return [
    `#6158 dry-run (read-only). Sæson ${t.seasonNumber}, tænding ${t.ignitionAt}.`,
    `  Planer i sæsonen: ${t.plansInSeason} | uden for scope: ${t.outOfScope} ${JSON.stringify(t.outOfScopeByReason)} | uden målløb: ${t.orphansNoTarget}`,
    `  I scope: ${t.inScope} | gives tilbage: ${t.giveBack} (kun A ${t.giveBackByRule.window_started_only}, kun B ${t.giveBackByRule.target_started_only}, begge ${t.giveBackByRule.both})`,
    `  Beholdes: talt efter tænding ${t.keepCountedAfterIgnition}, virker efter tænding ${t.keepWillWork} | allerede givet tilbage: ${t.alreadyGivenBack}`,
    `  Ryttere ${t.giveBackRiders} | hold ${t.giveBackTeams} (parkerede ${t.giveBackTeamsParked}) | målløb i gang ved tænding ${t.giveBackTargetInProgress} | ikke senior nu ${t.giveBackRiderNotSenior}`,
    `  Liste-hash (til --approved-list): ${approvedListHash(plan)}`,
  ].join("\n");
}

// ── I/O (read-only) ─────────────────────────────────────────────────────────

export async function fetchActiveSeason(supabase) {
  const { data, error } = await supabase
    .from("seasons").select("id, number, start_date").eq("status", "active")
    .order("number", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`season lookup: ${error.message}`);
  if (!data?.id) throw new Error("No active season found");
  return data;
}

async function fetchSeasonPlans(supabase, seasonId) {
  return fetchAllRows(() =>
    supabase.from("rider_peak_plans").select(PLAN_COLUMNS).eq("season_id", seasonId).order("id")
  );
}

async function fetchByIds(supabase, table, columns, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(uniq, (chunk) =>
    supabase.from(table).select(columns).in("id", chunk).order("id")
  );
  return new Map(rows.map((r) => [r.id, r]));
}

async function fetchSchedule(supabase, raceIds) {
  const uniq = [...new Set(raceIds.filter(Boolean))];
  if (!uniq.length) return [];
  return fetchAllRowsChunkedIn(uniq, (chunk) =>
    supabase.from("race_stage_schedule").select("race_id, stage_number, scheduled_at").in("race_id", chunk)
      .order("race_id").order("stage_number")
  );
}

/**
 * Kørte etaper (rytter, CET-dag) i løb der startede på eller efter tændingen.
 * Kun løb i sæsonen med mindst én kørt etape; en etape tæller som kørt når
 * stage_number <= stages_completed.
 */
export async function fetchPostIgnitionStages(supabase, { seasonId, riderIds, ignitionMs }) {
  const out = new Map();
  if (!riderIds.length) return out;
  const entries = await fetchAllRowsChunkedIn(riderIds, (chunk) =>
    supabase.from("race_entries")
      .select("race_id, rider_id, races!inner(season_id, stages_completed)")
      .in("rider_id", chunk)
      .eq("races.season_id", seasonId)
      .gt("races.stages_completed", 0)
      .order("race_id")
      .order("rider_id")
  );
  if (!entries.length) return out;
  const raceIds = [...new Set(entries.map((e) => e.race_id))];
  const schedule = await fetchSchedule(supabase, raceIds);
  const first = firstStageAtByRace(schedule);
  const completedByRace = new Map(entries.map((e) => [e.race_id, Number(e.races?.stages_completed) || 0]));
  const stageDaysByRace = new Map();
  for (const s of schedule) {
    const f = first.get(s.race_id);
    if (f == null || f < ignitionMs) continue; // løbet startede før tændingen: gamle regler
    if (!(Number(s.stage_number) <= (completedByRace.get(s.race_id) || 0))) continue;
    const day = scheduledAtToOrdinal(s.scheduled_at);
    if (day == null) continue;
    if (!stageDaysByRace.has(s.race_id)) stageDaysByRace.set(s.race_id, []);
    stageDaysByRace.get(s.race_id).push(day);
  }
  for (const e of entries) {
    for (const day of stageDaysByRace.get(e.race_id) || []) {
      if (!out.has(e.rider_id)) out.set(e.rider_id, []);
      out.get(e.rider_id).push({ raceId: e.race_id, dayOrdinal: day });
    }
  }
  return out;
}

/** Backup-rækker for sæsonen; tom liste hvis backup-tabellen ikke findes endnu. */
export async function fetchBackupIds(supabase, seasonId) {
  try {
    const rows = await fetchAllRows(() =>
      supabase.from(BACKUP_TABLE).select("id").eq("season_id", seasonId).order("id")
    );
    return rows.map((r) => r.id);
  } catch (err) {
    if (/does not exist|could not find|PGRST205|42P01/i.test(String(err?.message))) return [];
    throw err;
  }
}

export async function loadPlan(supabase, { ignitionAt }) {
  const season = await fetchActiveSeason(supabase);
  const ignitionMs = Date.parse(ignitionAt);
  const plans = await fetchSeasonPlans(supabase, season.id);
  const ridersById = await fetchByIds(supabase, "riders", RIDER_COLUMNS, plans.map((p) => p.rider_id));
  const teamsById = await fetchByIds(supabase, "teams", TEAM_COLUMNS, [...ridersById.values()].map((r) => r.team_id));
  const targetIds = plans.map((p) => p.target_race_id);
  const [racesById, schedule, postIgnitionStagesByRider, backupIds] = await Promise.all([
    fetchByIds(supabase, "races", RACE_COLUMNS, targetIds),
    fetchSchedule(supabase, targetIds),
    fetchPostIgnitionStages(supabase, { seasonId: season.id, riderIds: [...new Set(plans.map((p) => p.rider_id))], ignitionMs }),
    fetchBackupIds(supabase, season.id),
  ]);
  const live = new Set(plans.map((p) => p.id));
  const alreadyGivenBackIds = backupIds.filter((id) => !live.has(id));
  const plan = buildPlan({
    season, plans, ridersById, teamsById, racesById,
    firstStageMs: firstStageAtByRace(schedule),
    postIgnitionStagesByRider, alreadyGivenBackIds, ignitionAt,
  });
  return { plan, season };
}

export function writePrivateArtifacts(plan, { generatedAt, dir = PRIVATE_DIR, suffix = "dry-run" }) {
  mkdirSync(dir, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const report = join(dir, `${suffix}-${stamp}.md`);
  const json = join(dir, `${suffix}-${stamp}.json`);
  const snapshot = join(dir, "snapshot.sql");
  const restore = join(dir, "restore.sql");
  writeFileSync(report, renderPrivateReport(plan, { generatedAt }), "utf8");
  writeFileSync(json, JSON.stringify({ generatedAt, listHash: approvedListHash(plan), ...plan }, null, 2), "utf8");
  writeFileSync(snapshot, buildSnapshotSql(giveBackIds(plan)), "utf8");
  writeFileSync(restore, buildRestoreSql(), "utf8");
  return { report, json, snapshot, restore };
}

// ── Apply (ejer-gated) ──────────────────────────────────────────────────────

/** Kast hvis backup-tabellen ikke dækker alle planer der skal slettes. */
export async function assertBackupCovers(supabase, planIds) {
  if (!planIds.length) return;
  const rows = await fetchAllRowsChunkedIn(planIds, (chunk) =>
    supabase.from(BACKUP_TABLE).select("id").in("id", chunk).order("id")
  ).catch((err) => {
    throw new Error(`Backup table ${BACKUP_TABLE} not readable (${err.message}). Run balance-internals/6158/snapshot.sql first. Nothing was written.`);
  });
  const covered = new Set(rows.map((r) => r.id));
  const missing = planIds.filter((id) => !covered.has(id));
  if (missing.length) {
    throw new Error(`Backup missing ${missing.length} of ${planIds.length} plans. Re-run snapshot.sql. Nothing was written.`);
  }
}

/**
 * Apply: slet præcis de godkendte planer (giv toppene tilbage), derefter
 * verificering. Idempotent: en slettet plan findes ikke igen og tælles som
 * "allerede givet tilbage" i hashen.
 */
export async function runApply({ supabase, plan, seasonId, ownerGo, approvedHash }) {
  if (!ownerGo) throw new Error(`Apply requires ${OWNER_GO_FLAG}`);
  if (approvedHash !== approvedListHash(plan)) {
    throw new Error("Live list differs from the list the owner approved. Re-run dry-run and show the owner the new list. Nothing was written.");
  }
  const ids = giveBackIds(plan);
  await assertBackupCovers(supabase, ids);

  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await supabase.from("rider_peak_plans")
      .delete()
      .in("id", chunk)
      .eq("season_id", seasonId)
      .select("id");
    if (error) throw new Error(`give back (delete) after ${deleted} plans: ${error.message}`);
    deleted += (data || []).length;
  }

  // Verificering: ingen af de godkendte planer må findes bagefter.
  const all = [...new Set([...ids, ...plan.alreadyGivenBackIds])];
  const remaining = all.length
    ? await fetchAllRowsChunkedIn(all, (chunk) => supabase.from("rider_peak_plans").select("id").in("id", chunk).order("id"))
    : [];
  if (remaining.length) throw new Error(`Verification failed: ${remaining.length} approved plans still exist after delete`);
  return { planned: ids.length, deleted, alreadyGivenBack: plan.alreadyGivenBackIds.length, remainingAfter: 0 };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dotenv = await import("dotenv");
  dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const generatedAt = new Date().toISOString();
  const ignitionAt = opts.ignition ?? generatedAt;
  const { plan, season } = await loadPlan(supabase, { ignitionAt });
  const files = writePrivateArtifacts(plan, { generatedAt, suffix: opts.apply ? "pre-apply" : "dry-run" });
  console.log(renderPublicSummary(plan));
  console.log(`  Privat rapport: ${files.report}`);
  console.log(`  Snapshot-SQL:   ${files.snapshot}`);
  console.log(`  Restore-SQL:    ${files.restore}`);
  if (!opts.apply) {
    console.log("Dry-run: intet skrevet til databasen.");
    return;
  }
  const result = await runApply({ supabase, plan, seasonId: season.id, ownerGo: opts.ownerGo, approvedHash: opts.approvedHash });
  const resultPath = join(PRIVATE_DIR, `apply-result-${generatedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`Apply: ${JSON.stringify(result)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(`FEJL: ${err.message}`); process.exitCode = 1; });
}
