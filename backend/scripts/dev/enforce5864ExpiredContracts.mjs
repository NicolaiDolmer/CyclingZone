// #5864 · Håndhæv udløbne kontrakter på managerhold (S2/S3-kontrakter der stadig
// står på holdet i S4).
//
// Ejer-beslutning 28/9 (valg B): håndhæv straks, også når en ungdomstrup dermed
// bliver for lille til at stille til start. Ejer 5/10: ejeren ser listen live
// FØR go, fordi det er destruktivt.
//
// ROD-ÅRSAG (målt read-only 5/10)
//   Sæsonskiftets kontraktudløb (contractExpiryRelease.releaseExpiredContractRiders,
//   Phase 5c i seasonTransition.js) henter kun SENIORTRUPPEN (applySeniorSquadFilter:
//   squad='senior' AND is_academy=false). Ungdomsryttere (u23/junior, akademiet)
//   med udløbet kontrakt blev derfor aldrig fundet, hverken ved S2→S3 eller S3→S4.
//   Langt de fleste berørte er ungdomsryttere; resten er få seniorer.
//
// HVAD SCRIPTET GØR
//   Standard (ingen flag): READ-ONLY dry-run. Ingen skrivning til databasen.
//     Skriver en PRIVAT rapport (rytter-id'er, holdnavne, tal) til
//     balance-internals/5864/ (gitignoreret) og kun samlede tal til konsollen.
//     Lægger også snapshot-SQL og restore-SQL samme sted.
//   --apply --owner-go=5864-production: frigiver ryttere via SAMME sti som
//     sæsonskiftet (releaseExpiredContractRiders, genbrugt, ikke kopieret) med en
//     injiceret hente-funktion der også tager ungdomstrupperne med. Kræver at
//     snapshot-tabellerne (backup_5864_*) findes i databasen med alle kandidater,
//     ellers afbrydes FØR første skrivning.
//
// SCOPE
//   Samme ejendomsfilter som sæsonskiftet (ikke bank, ikke frosset, ikke testkonto)
//   + kun menneskehold (is_ai=false). Frosne hold og testkonti listes separat som
//   "uden for scope" og røres ikke (normal udløbs-sti springer dem også over).
//   Parkerede hold er MED (normal sti filtrerer dem ikke fra) og vises separat.
//
// UNDTAGELSER (genbrugt fra normal sti)
//   En rytter midt i et aktivt etapeløb udskydes (getRidersInActiveStageRace).
//   Han beholder sin udløbne kontrakt og fanges af en ny kørsel af apply
//   (idempotent: forespørgslen er `contract_end_season <= tærskel`).
//
// UNGDOMS-NORMALISERING (eneste nye skridt, se slutrapport på #5864)
//   Normal sti nulstiller ikke is_academy, fordi den aldrig har set en akademi-
//   rytter. En fri agent med is_academy=true findes ikke i spillet i dag; frie
//   ungdomsryttere står med is_academy=false og ungdomstrup i `squad` (samme form
//   som academyGenerator giver nye kandidater). Efter frigivelsen sættes derfor
//   is_academy=false på de frigivne akademiryttere, `squad` bevares.
//
//   node backend/scripts/dev/enforce5864ExpiredContracts.mjs
//   node backend/scripts/dev/enforce5864ExpiredContracts.mjs --apply --owner-go=5864-production --approved-list=<hash>
//   (hash = "Liste-hash" fra det dry-run ejeren godkendte; afviger den levende rytter-mængde, afbrydes FØR skrivning)

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../../lib/supabasePagination.js";
import { isYouthSquad } from "../../lib/squads.js";
import { MIN_RIDERS_FOR_RACE } from "../../lib/marketUtils.js";
import { DIVISION_SQUAD_LIMITS } from "../../lib/boardConstants.js";
import { MIN_RACE_ENTRIES } from "../../lib/raceAutopick.js";
import { getRidersInActiveStageRace } from "../../lib/stageRaceTransferDefer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "../../..");
export const PRIVATE_DIR = join(REPO_ROOT, "balance-internals", "5864");

export const OWNER_GO_FLAG = "--owner-go=5864-production";
export const BACKUP_RIDERS_TABLE = "backup_5864_riders";
export const BACKUP_ENTRIES_TABLE = "backup_5864_race_entries";
export const BACKUP_LISTINGS_TABLE = "backup_5864_transfer_listings";

const RIDER_COLUMNS =
  "id, firstname, lastname, team_id, pending_team_id, squad, is_academy, is_retired, salary, contract_length, contract_end_season, acquired_at";
const TEAM_EMBED = "team:team_id!inner(id, name, user_id, is_ai, is_frozen, is_bank, is_test_account, division, parked_at, retired_at)";

// ── Argumenter ──────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const opts = { apply: false, ownerGo: false, approvedHash: null };
  for (const arg of argv) {
    if (arg === "--apply") opts.apply = true;
    else if (arg === OWNER_GO_FLAG) opts.ownerGo = true;
    else if (arg.startsWith("--owner-go=")) throw new Error("Wrong owner-go token");
    else if (arg.startsWith("--approved-list=")) {
      const h = arg.slice("--approved-list=".length);
      if (!/^[a-f0-9]{64}$/.test(h)) throw new Error("--approved-list must be the 64-char list hash printed by the dry-run");
      opts.approvedHash = h;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (opts.ownerGo && !opts.apply) throw new Error("--owner-go only makes sense together with --apply");
  if (opts.apply && !opts.ownerGo) throw new Error(`--apply requires ${OWNER_GO_FLAG} (owner must have seen the live list)`);
  if (opts.apply && opts.approvedHash === null) {
    throw new Error("--apply requires --approved-list=<list hash from the dry-run the owner approved>");
  }
  return opts;
}

/**
 * Fingeraftryk af præcis den rytter-mængde (i scope) ejeren har set. Apply kræver
 * eksakt match, så en rytter der er kommet til (eller faldet ud) siden dry-run'et
 * aldrig frigives uden en ny liste, også selv om antallet er det samme.
 */
export function approvedListHash(plan) {
  const ids = plan.rows.map((r) => String(r.riderId)).sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex");
}

// ── Rene klassifikationer ───────────────────────────────────────────────────

/** Samme ejendomsfilter som contractExpiryRelease + kun menneskehold. */
export function isInScopeTeam(team) {
  return !!team && team.is_ai === false && team.is_bank === false && team.is_frozen === false && team.is_test_account === false;
}

/** Hvorfor et menneskehold er uden for scope (eller null hvis det er med). */
export function outOfScopeReason(team) {
  if (!team) return "no_team";
  if (team.is_ai !== false) return "ai_team";
  if (team.is_bank) return "bank";
  if (team.is_test_account) return "test_account";
  if (team.is_frozen) return "frozen";
  return null;
}

/** Trup-nøgle til tælling: u23/junior/senior; akademi uden ungdomstrup tælles som ungdom ukendt. */
export function rosterBucket(rider) {
  if (isYouthSquad(rider?.squad)) return rider.squad;
  if (rider?.is_academy === true) return "youth_unknown";
  return "senior";
}

export function seniorMinForDivision(division) {
  return DIVISION_SQUAD_LIMITS[division]?.min ?? MIN_RIDERS_FOR_RACE;
}

/** Kaptajn-referencer i holdets strategi (a_chain + captain_priorities pr. terræn). */
export function captainRefsFor(riderId, strategy) {
  const refs = [];
  if (!strategy) return refs;
  if (Array.isArray(strategy.a_chain) && strategy.a_chain.includes(riderId)) refs.push("a_chain");
  const cap = strategy.captain_priorities && typeof strategy.captain_priorities === "object" ? strategy.captain_priorities : {};
  for (const [bucket, ids] of Object.entries(cap)) {
    if (Array.isArray(ids) && ids.includes(riderId)) refs.push(`captain_priorities.${bucket}`);
  }
  return refs;
}

/**
 * Byg hele planen ud fra rå, allerede-hentede rækker. Ren funktion (ingen I/O).
 *
 * @param {object} p
 * @param {object[]} p.candidates      ryttere m. embedded `team`, contract_end_season <= threshold
 * @param {object[]} p.roster          alle ikke-pensionerede ryttere på de berørte hold
 * @param {Set<string>} p.racingIds    kandidater i et aktivt etapeløb
 * @param {Map<string,object>} p.strategies  team_id → team_race_strategy-række
 * @param {object[]} p.futureEntries   race_entries (rider_id, race_role) i fremtidige løb
 * @param {object[]} p.openListings    transfer_listings (rider_id) open/negotiating
 * @param {number} p.threshold
 */
export function buildPlan({ candidates, roster, racingIds, strategies, futureEntries, openListings, threshold }) {
  const inScope = [];
  const outOfScope = [];
  for (const r of candidates) {
    const reason = outOfScopeReason(r.team);
    if (reason) outOfScope.push({ riderId: r.id, teamId: r.team_id, reason, squad: rosterBucket(r), contractEndSeason: r.contract_end_season });
    else inScope.push(r);
  }

  const entriesByRider = new Map();
  for (const e of futureEntries || []) {
    if (!entriesByRider.has(e.rider_id)) entriesByRider.set(e.rider_id, []);
    entriesByRider.get(e.rider_id).push(e);
  }
  const listingsByRider = new Map();
  for (const l of openListings || []) listingsByRider.set(l.rider_id, (listingsByRider.get(l.rider_id) || 0) + 1);

  const rows = inScope.map((r) => {
    const deferred = racingIds.has(r.id);
    const entries = entriesByRider.get(r.id) || [];
    return {
      riderId: r.id,
      name: `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim(),
      teamId: r.team_id,
      squad: rosterBucket(r),
      isAcademy: r.is_academy === true,
      contractEndSeason: r.contract_end_season,
      salary: r.salary ?? null,
      outcome: deferred ? "deferred_active_stage_race" : "release_to_free_agent",
      youthNormalize: !deferred && r.is_academy === true,
      captainRefs: captainRefsFor(r.id, strategies.get(r.team_id)),
      futureEntries: entries.length,
      futureCaptainEntries: entries.filter((e) => e.race_role === "captain" || e.race_role === "sprint_captain").length,
      openListings: listingsByRider.get(r.id) || 0,
    };
  });

  const releasedByTeam = new Map();
  for (const row of rows) {
    if (row.outcome !== "release_to_free_agent") continue;
    if (!releasedByTeam.has(row.teamId)) releasedByTeam.set(row.teamId, []);
    releasedByTeam.get(row.teamId).push(row);
  }

  const teamMeta = new Map();
  for (const r of inScope) teamMeta.set(r.team_id, r.team);
  const rosterByTeam = new Map();
  for (const r of roster || []) {
    if (!teamMeta.has(r.team_id)) continue;
    if (!rosterByTeam.has(r.team_id)) rosterByTeam.set(r.team_id, []);
    rosterByTeam.get(r.team_id).push(r);
  }

  const teams = [...teamMeta.entries()].map(([teamId, t]) => {
    const all = rosterByTeam.get(teamId) || [];
    const released = new Set((releasedByTeam.get(teamId) || []).map((x) => x.riderId));
    const count = (bucket, after) => all.filter((r) => rosterBucket(r) === bucket && !(after && released.has(r.id))).length;
    const squads = {};
    for (const bucket of ["senior", "u23", "junior", "youth_unknown"]) {
      const before = count(bucket, false);
      const after = count(bucket, true);
      if (before === 0 && after === 0) continue;
      const min = bucket === "senior" ? seniorMinForDivision(t.division) : MIN_RACE_ENTRIES;
      squads[bucket] = { before, after, min, startableBefore: before >= min, startableAfter: after >= min };
    }
    const lostStart = Object.entries(squads).filter(([, s]) => s.startableBefore && !s.startableAfter).map(([b]) => b);
    return {
      teamId,
      name: t.name,
      division: t.division ?? null,
      parked: t.parked_at != null,
      retired: t.retired_at != null,
      releasedCount: released.size,
      deferredCount: rows.filter((x) => x.teamId === teamId && x.outcome === "deferred_active_stage_race").length,
      squads,
      lostStart,
    };
  });

  const toRelease = rows.filter((r) => r.outcome === "release_to_free_agent");
  const activeTeams = teams.filter((t) => !t.parked && !t.retired);
  const totals = {
    threshold,
    candidatesAllHumanTeams: candidates.length,
    outOfScope: outOfScope.length,
    outOfScopeByReason: countBy(outOfScope, (x) => x.reason),
    inScope: rows.length,
    release: toRelease.length,
    deferredActiveStageRace: rows.length - toRelease.length,
    youthNormalize: toRelease.filter((r) => r.youthNormalize).length,
    bySquad: countBy(rows, (r) => r.squad),
    byContractEndSeason: countBy(rows, (r) => String(r.contractEndSeason)),
    teams: teams.length,
    teamsActive: activeTeams.length,
    teamsParked: teams.filter((t) => t.parked).length,
    teamsLosingStart: teams.filter((t) => t.lostStart.length > 0).length,
    activeTeamsLosingStart: activeTeams.filter((t) => t.lostStart.length > 0).length,
    lostStartBySquad: countBy(teams.flatMap((t) => t.lostStart.map((b) => ({ b }))), (x) => x.b),
    ridersWithCaptainRefs: rows.filter((r) => r.captainRefs.length > 0).length,
    ridersWithFutureEntries: rows.filter((r) => r.futureEntries > 0).length,
    futureEntries: rows.reduce((n, r) => n + r.futureEntries, 0),
    futureCaptainEntries: rows.reduce((n, r) => n + r.futureCaptainEntries, 0),
    openListings: rows.reduce((n, r) => n + r.openListings, 0),
  };
  return { rows, teams, outOfScope, totals };
}

function countBy(list, keyFn) {
  const out = {};
  for (const x of list) {
    const k = keyFn(x);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

// ── SQL: snapshot + restore ────────────────────────────────────────────────

function uuidList(ids) {
  for (const id of ids) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new Error(`Unexpected rider id format: ${id}`);
  }
  return ids.map((id) => `'${id}'`).join(",\n  ");
}

/**
 * Snapshot-SQL (køres FØR apply, fx via Supabase MCP execute_sql). Idempotent:
 * `create table if not exists` + insert ... on conflict do nothing, så en
 * genkørsel aldrig overskriver det oprindelige før-billede.
 */
export function buildSnapshotSql(riderIds) {
  if (!riderIds.length) return "-- #5864: ingen kandidater, intet snapshot nødvendigt\n";
  const ids = uuidList(riderIds);
  return `-- #5864 snapshot FØR håndhævelse af udløbne kontrakter. Idempotent.
begin;
create table if not exists public.${BACKUP_RIDERS_TABLE} as
  select id, team_id, pending_team_id, squad, is_academy, salary, contract_length, contract_end_season, acquired_at, now() as snapshot_at
  from public.riders where false;
alter table public.${BACKUP_RIDERS_TABLE} enable row level security;
create unique index if not exists ${BACKUP_RIDERS_TABLE}_id on public.${BACKUP_RIDERS_TABLE}(id);
insert into public.${BACKUP_RIDERS_TABLE}
  select id, team_id, pending_team_id, squad, is_academy, salary, contract_length, contract_end_season, acquired_at, now()
  from public.riders where id in (
  ${ids}
  )
on conflict (id) do nothing;

create table if not exists public.${BACKUP_ENTRIES_TABLE} as select * from public.race_entries where false;
alter table public.${BACKUP_ENTRIES_TABLE} enable row level security;
create unique index if not exists ${BACKUP_ENTRIES_TABLE}_pk on public.${BACKUP_ENTRIES_TABLE}(race_id, rider_id);
insert into public.${BACKUP_ENTRIES_TABLE}
  select re.* from public.race_entries re join public.races ra on ra.id = re.race_id
  where ra.status = 'scheduled' and coalesce(ra.stages_completed, 0) = 0 and re.rider_id in (
  ${ids}
  )
on conflict do nothing;

create table if not exists public.${BACKUP_LISTINGS_TABLE} as select * from public.transfer_listings where false;
alter table public.${BACKUP_LISTINGS_TABLE} enable row level security;
create unique index if not exists ${BACKUP_LISTINGS_TABLE}_id on public.${BACKUP_LISTINGS_TABLE}(id);
insert into public.${BACKUP_LISTINGS_TABLE}
  select * from public.transfer_listings where status in ('open', 'negotiating') and rider_id in (
  ${ids}
  )
on conflict (id) do nothing;
commit;
notify pgrst, 'reload schema';
-- Verificér: select count(*) from public.${BACKUP_RIDERS_TABLE}; (skal være ${riderIds.length})
`;
}

/**
 * Restore-SQL: rul håndhævelsen tilbage fra backup-tabellerne. Rører kun ryttere
 * der STADIG er frie agenter (team_id is null), så en rytter der er købt af et
 * andet hold efter frigivelsen ikke trækkes tilbage. Notifikationer rulles ikke
 * tilbage (sendt besked kan ikke trækkes tilbage).
 */
export function buildRestoreSql() {
  return `-- #5864 restore: rul frigivelsen tilbage fra ${BACKUP_RIDERS_TABLE}. Ejer-gated.
begin;
update public.riders r set
  team_id = b.team_id, pending_team_id = b.pending_team_id, squad = b.squad, is_academy = b.is_academy,
  salary = b.salary, contract_length = b.contract_length, contract_end_season = b.contract_end_season,
  acquired_at = b.acquired_at
from public.${BACKUP_RIDERS_TABLE} b
where r.id = b.id and r.team_id is null and b.team_id is not null;

insert into public.race_entries
  select e.* from public.${BACKUP_ENTRIES_TABLE} e
  join public.riders r on r.id = e.rider_id and r.team_id = e.team_id
  join public.races ra on ra.id = e.race_id and ra.status = 'scheduled' and coalesce(ra.stages_completed, 0) = 0
on conflict do nothing;

update public.transfer_listings t set status = b.status
from public.${BACKUP_LISTINGS_TABLE} b
join public.riders r on r.id = b.rider_id and r.team_id = b.seller_team_id
where t.id = b.id and t.status = 'withdrawn';
commit;
`;
}

// ── Privat rapport ──────────────────────────────────────────────────────────

const OUTCOME_LABEL = {
  release_to_free_agent: "frigives (fri agent)",
  deferred_active_stage_race: "UDSKUDT (midt i etapeløb)",
};

export function renderPrivateReport(plan, { generatedAt, activeSeason }) {
  const t = plan.totals;
  const lines = [];
  lines.push(`# #5864 dry-run: udløbne kontrakter på managerhold (PRIVAT)`);
  lines.push("");
  lines.push(`Genereret ${generatedAt}. Aktiv sæson ${activeSeason}, tærskel contract_end_season <= ${t.threshold}. Ingen skrivning udført.`);
  lines.push("");
  lines.push("## Samlet");
  lines.push(`- Ryttere på menneskehold med udløbet kontrakt: ${t.candidatesAllHumanTeams}`);
  lines.push(`- Uden for scope (røres ikke, normal sti springer dem over): ${t.outOfScope} ${JSON.stringify(t.outOfScopeByReason)}`);
  lines.push(`- I scope: ${t.inScope} (trup: ${JSON.stringify(t.bySquad)}, kontrakt-slut: ${JSON.stringify(t.byContractEndSeason)})`);
  lines.push(`- Frigives nu: ${t.release} (heraf ${t.youthNormalize} akademiryttere der får is_academy=false)`);
  lines.push(`- Udskudt fordi de kører et etapeløb: ${t.deferredActiveStageRace} (fanges af en ny apply-kørsel efter løbet)`);
  lines.push(`- Hold berørt: ${t.teams} (aktive ${t.teamsActive}, parkerede ${t.teamsParked})`);
  lines.push(`- Hold der mister evnen til at stille til start i mindst én trup: ${t.teamsLosingStart} (aktive hold: ${t.activeTeamsLosingStart}) ${JSON.stringify(t.lostStartBySquad)}`);
  lines.push(`- Ryttere i kaptajn-/A-kæde-strategi: ${t.ridersWithCaptainRefs}`);
  lines.push(`- Fremtidige løbstilmeldinger der fjernes: ${t.futureEntries} på ${t.ridersWithFutureEntries} ryttere (heraf kaptajnroller: ${t.futureCaptainEntries})`);
  lines.push(`- Åbne transferopslag der trækkes tilbage: ${t.openListings}`);
  lines.push(`- Liste-hash (apply kræver \`--approved-list=\` med netop denne): \`${approvedListHash(plan)}\``);
  lines.push("");
  lines.push(`Minimum for start: ungdomstrup ${MIN_RACE_ENTRIES} ryttere (youthPoolAssignment.canStart), seniortrup divisionens min (DIVISION_SQUAD_LIMITS).`);
  lines.push("");
  lines.push("## Hold");
  lines.push("| Hold | Div | Status | Frigives | Udskudt | Trupper før → efter (min) | Mister start |");
  lines.push("|---|---|---|---|---|---|---|");
  const sorted = [...plan.teams].sort((a, b) => (b.lostStart.length - a.lostStart.length) || (b.releasedCount - a.releasedCount) || String(a.name).localeCompare(String(b.name)));
  for (const team of sorted) {
    const squads = Object.entries(team.squads).map(([k, s]) => `${k} ${s.before}→${s.after} (${s.min})`).join(", ");
    const status = team.retired ? "pensioneret" : team.parked ? "parkeret" : "aktiv";
    lines.push(`| ${team.name} | ${team.division ?? "-"} | ${status} | ${team.releasedCount} | ${team.deferredCount} | ${squads} | ${team.lostStart.join(", ") || "-"} |`);
  }
  lines.push("");
  lines.push("## Ryttere");
  lines.push("| Rytter | Rytter-id | Hold | Trup | Akademi | Kontrakt-slut | Udfald | Kaptajn-ref | Tilmeldinger (kaptajn) | Opslag |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  const teamName = new Map(plan.teams.map((x) => [x.teamId, x.name]));
  const rows = [...plan.rows].sort((a, b) => String(teamName.get(a.teamId)).localeCompare(String(teamName.get(b.teamId))) || a.name.localeCompare(b.name));
  for (const r of rows) {
    lines.push(`| ${r.name} | ${r.riderId} | ${teamName.get(r.teamId)} | ${r.squad} | ${r.isAcademy ? "ja" : "nej"} | S${r.contractEndSeason} | ${OUTCOME_LABEL[r.outcome]} | ${r.captainRefs.join(", ") || "-"} | ${r.futureEntries} (${r.futureCaptainEntries}) | ${r.openListings} |`);
  }
  if (plan.outOfScope.length) {
    lines.push("");
    lines.push("## Uden for scope (røres ikke)");
    lines.push("| Rytter-id | Hold-id | Årsag | Trup | Kontrakt-slut |");
    lines.push("|---|---|---|---|---|");
    for (const o of plan.outOfScope) lines.push(`| ${o.riderId} | ${o.teamId} | ${o.reason} | ${o.squad} | S${o.contractEndSeason} |`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Konsol-output: KUN samlede tal (ingen id'er, ingen navne). */
export function renderPublicSummary(plan) {
  const t = plan.totals;
  return [
    `#5864 dry-run (read-only). Tærskel contract_end_season <= ${t.threshold}.`,
    `  Kandidater på menneskehold: ${t.candidatesAllHumanTeams} | uden for scope: ${t.outOfScope} ${JSON.stringify(t.outOfScopeByReason)}`,
    `  I scope: ${t.inScope} | frigives: ${t.release} | udskudt (etapeløb): ${t.deferredActiveStageRace} | akademi-normalisering: ${t.youthNormalize}`,
    `  Hold: ${t.teams} (aktive ${t.teamsActive}, parkerede ${t.teamsParked}) | mister start i en trup: ${t.teamsLosingStart} (aktive ${t.activeTeamsLosingStart})`,
    `  Kaptajn-refs: ${t.ridersWithCaptainRefs} | fremtidige tilmeldinger: ${t.futureEntries} (kaptajn ${t.futureCaptainEntries}) | åbne opslag: ${t.openListings}`,
    `  Liste-hash (til --approved-list): ${approvedListHash(plan)}`,
  ].join("\n");
}

// ── I/O (read-only) ─────────────────────────────────────────────────────────

export async function fetchActiveSeasonNumber(supabase) {
  const { data, error } = await supabase
    .from("seasons").select("number").eq("status", "active")
    .order("number", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`season lookup: ${error.message}`);
  if (!Number.isFinite(data?.number)) throw new Error("No active season found");
  return data.number;
}

/** Alle ryttere på menneskehold med udløbet kontrakt (ALLE trupper, alle hold-typer klassificeres bagefter). */
export async function fetchHumanTeamCandidates(supabase, threshold) {
  return fetchAllRows(() =>
    supabase.from("riders")
      .select(`${RIDER_COLUMNS}, ${TEAM_EMBED}`)
      .not("team_id", "is", null)
      .eq("is_retired", false)
      .lte("contract_end_season", threshold)
      .eq("team.is_ai", false)
      .order("id")
  );
}

/**
 * Injiceres i releaseExpiredContractRiders: samme ejendomsfilter som normal sti,
 * minus senior-trup-filteret, plus kun menneskehold. `allowedIds` begrænser til
 * præcis de ryttere ejeren har set på listen (en rytter der er kommet til siden
 * dry-run'et frigives ikke uden en ny liste).
 */
export function makeScopedFetcher(threshold, allowedIds, fetchCandidates = fetchHumanTeamCandidates) {
  const allowed = new Set(allowedIds);
  return async ({ supabase }) =>
    (await fetchCandidates(supabase, threshold)).filter((r) => isInScopeTeam(r.team) && allowed.has(r.id));
}

async function fetchRoster(supabase, teamIds) {
  if (!teamIds.length) return [];
  return fetchAllRowsChunkedIn(teamIds, (chunk) =>
    supabase.from("riders").select("id, team_id, squad, is_academy").in("team_id", chunk).eq("is_retired", false).order("id")
  );
}

async function fetchStrategies(supabase, teamIds) {
  if (!teamIds.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(teamIds, (chunk) =>
    supabase.from("team_race_strategy").select("team_id, a_chain, captain_priorities").in("team_id", chunk).order("team_id")
  );
  return new Map(rows.map((r) => [r.team_id, r]));
}

async function fetchFutureEntries(supabase, riderIds) {
  if (!riderIds.length) return [];
  return fetchAllRowsChunkedIn(riderIds, (chunk) =>
    supabase.from("race_entries")
      .select("rider_id, race_id, race_role, races!inner(status, stages_completed)")
      .in("rider_id", chunk)
      .eq("races.status", "scheduled")
      .eq("races.stages_completed", 0)
      .order("race_id")
  );
}

async function fetchOpenListings(supabase, riderIds) {
  if (!riderIds.length) return [];
  return fetchAllRowsChunkedIn(riderIds, (chunk) =>
    supabase.from("transfer_listings").select("id, rider_id").in("rider_id", chunk).in("status", ["open", "negotiating"]).order("id")
  );
}

export async function loadPlan(supabase) {
  const activeSeason = await fetchActiveSeasonNumber(supabase);
  const threshold = activeSeason - 1;
  const candidates = await fetchHumanTeamCandidates(supabase, threshold);
  const inScope = candidates.filter((r) => isInScopeTeam(r.team));
  const teamIds = [...new Set(inScope.map((r) => r.team_id))];
  const riderIds = inScope.map((r) => r.id);
  const [roster, strategies, futureEntries, openListings, racing] = await Promise.all([
    fetchRoster(supabase, teamIds),
    fetchStrategies(supabase, teamIds),
    fetchFutureEntries(supabase, riderIds),
    fetchOpenListings(supabase, riderIds),
    getRidersInActiveStageRace(supabase, riderIds),
  ]);
  const plan = buildPlan({ candidates, roster, racingIds: new Set(racing), strategies, futureEntries, openListings, threshold });
  return { plan, activeSeason, threshold };
}

export function writePrivateArtifacts(plan, { activeSeason, generatedAt, dir = PRIVATE_DIR, suffix = "dry-run" }) {
  mkdirSync(dir, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const report = join(dir, `${suffix}-${stamp}.md`);
  const json = join(dir, `${suffix}-${stamp}.json`);
  const snapshot = join(dir, "snapshot.sql");
  const restore = join(dir, "restore.sql");
  writeFileSync(report, renderPrivateReport(plan, { generatedAt, activeSeason }), "utf8");
  writeFileSync(json, JSON.stringify({ generatedAt, activeSeason, ...plan }, null, 2), "utf8");
  writeFileSync(snapshot, buildSnapshotSql(plan.rows.map((r) => r.riderId)), "utf8");
  writeFileSync(restore, buildRestoreSql(), "utf8");
  return { report, json, snapshot, restore };
}

// ── Apply (ejer-gated) ──────────────────────────────────────────────────────

/** Kast hvis snapshot-tabellen ikke dækker alle ryttere der skal frigives. */
export async function assertSnapshotCovers(supabase, riderIds) {
  if (!riderIds.length) return;
  const covered = new Set();
  const rows = await fetchAllRowsChunkedIn(riderIds, (chunk) =>
    supabase.from(BACKUP_RIDERS_TABLE).select("id").in("id", chunk).order("id")
  ).catch((err) => {
    throw new Error(`Snapshot table ${BACKUP_RIDERS_TABLE} not readable (${err.message}). Run balance-internals/5864/snapshot.sql first. Nothing was written.`);
  });
  for (const r of rows) covered.add(r.id);
  const missing = riderIds.filter((id) => !covered.has(id));
  if (missing.length) {
    throw new Error(`Snapshot missing ${missing.length} of ${riderIds.length} riders. Re-run snapshot.sql. Nothing was written.`);
  }
}

/**
 * Apply: genbruger releaseExpiredContractRiders (normal sæsonskifte-sti) med
 * scoped fetcher, derefter ungdoms-normalisering af de frigivne akademiryttere.
 * Idempotent: en frigjort rytter har contract_end_season=null og findes ikke igen;
 * normaliseringen rammer kun `team_id is null AND is_academy = true`.
 */
export async function runApply({ supabase, plan, threshold, releaseFn, ownerGo, approvedHash, fetchCandidates = fetchHumanTeamCandidates }) {
  if (!ownerGo) throw new Error(`Apply requires ${OWNER_GO_FLAG}`);
  if (approvedHash !== approvedListHash(plan)) {
    throw new Error("Live list differs from the list the owner approved. Re-run dry-run and show the owner the new list. Nothing was written.");
  }
  const planIds = plan.rows.map((r) => r.riderId);
  const releaseIds = plan.rows.filter((r) => r.outcome === "release_to_free_agent").map((r) => r.riderId);
  await assertSnapshotCovers(supabase, planIds);

  const stats = await releaseFn({
    supabase,
    seasonNumber: threshold,
    fetchExpiredContractRiders: makeScopedFetcher(threshold, planIds, fetchCandidates),
  });

  // Alle akademiryttere i planen (også dem der var udskudt ved dry-run, men er
  // frigivet nu); `team_id is null`-vagten rører kun dem der reelt blev frigivet.
  const academyIds = plan.rows.filter((r) => r.isAcademy).map((r) => r.riderId);
  let normalized = 0;
  for (let i = 0; i < academyIds.length; i += 100) {
    const chunk = academyIds.slice(i, i + 100);
    const { data, error } = await supabase.from("riders")
      .update({ is_academy: false })
      .in("id", chunk)
      .is("team_id", null)
      .eq("is_academy", true)
      .select("id");
    if (error) throw new Error(`youth normalize: ${error.message}`);
    normalized += (data || []).length;
  }
  return { ...stats, plannedRelease: releaseIds.length, youthNormalized: normalized };
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
  const { plan, activeSeason, threshold } = await loadPlan(supabase);
  const files = writePrivateArtifacts(plan, { activeSeason, generatedAt, suffix: opts.apply ? "pre-apply" : "dry-run" });
  console.log(renderPublicSummary(plan));
  console.log(`  Privat rapport: ${files.report}`);
  console.log(`  Snapshot-SQL:   ${files.snapshot}`);
  console.log(`  Restore-SQL:    ${files.restore}`);
  if (!opts.apply) {
    console.log("Dry-run: intet skrevet til databasen.");
    return;
  }
  const { releaseExpiredContractRiders } = await import("../../lib/contractExpiryRelease.js");
  const result = await runApply({ supabase, plan, threshold, releaseFn: releaseExpiredContractRiders, ownerGo: opts.ownerGo, approvedHash: opts.approvedHash });
  const resultPath = join(PRIVATE_DIR, `apply-result-${generatedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`Apply: ${JSON.stringify(result)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(`FEJL: ${err.message}`); process.exitCode = 1; });
}
