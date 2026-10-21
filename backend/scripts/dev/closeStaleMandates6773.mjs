// #6773 · Bestyrelsesmandater for en AFSLUTTET sæson der stadig står `active`
// (eller `proposed`) og kan skygge for den aktuelle sæsons mandat.
//
// ROD-ÅRSAG (generalprøven #6751, read-only 17/10)
//   Forslag fra sidst i en sæson (ny-holds-stien foreslår for den NUVÆRENDE
//   sæson) stod åbne over sæsonskiftet. Skiftet lukkede kun `active` for den
//   afsluttede sæsons id, så forslagene blev underskrevet bagefter (manager
//   eller auto-accept) og stod aktive ved siden af næste sæsons mandat. Fixet i
//   samme PR: læserne filtrerer på den aktive sæson, sæsonskiftet lukker alt
//   for afsluttede sæsoner (`closeEndedSeasonMandates`), og et forslag for en
//   afsluttet sæson kan ikke længere underskrives.
//
// HVAD SCRIPTET GØR
//   Standard (ingen flag): READ-ONLY dry-run. Klienten pakkes i en proxy der
//   KASTER ved enhver skrivning. Viser samlede tal i konsollen; detaljer
//   (mandat-id'er, hold-id'er) + backup-SQL + restore-SQL lægges i
//   balance-internals/6773/ (gitignoreret).
//   --apply --owner-go=6773-production --approved-list=<hash>: (1) flytter
//   bonusmål (source 'bonus_offer') fra et gammelt aktivt mandat til holdets
//   aktuelle mandat, idempotent på bonus_offer_id (review N1: ellers forsvinder
//   et S4-bonusmål fra Boardroom, når læserne vælger den aktive sæson); (2)
//   lukker KUN de godkendte id'er, betinget på den forventede gamle status
//   (Codex/review N2). Afbryder FØR første skrivning hvis den levende liste
//   afviger fra den godkendte (hash, inkl. bonus-flytninger), eller hvis
//   backup-tabellen (backup_6773_board_mandates) ikke dækker alle berørte
//   rækker (også mandater der får bonusmål). Efter apply: post-verify (0
//   tilbage), ellers exit 1.
//
// SCOPE = runtime-predikatet: status active/proposed og
//   season_number <= aktiv sæson - 1. Rækker uden season_number tælles separat
//   ("uden for scope") og røres ikke, præcis som runtime.
//   active → completed, proposed → lapsed. På de lukkede rækker skrives kun
//   status og updated_at; på modtager-mandatet kun goals og updated_at. Ingen
//   tillid, ingen kvittering, ingen penge.
//
// Idempotent: en lukket række matcher ikke predikatet igen, og hver opdatering
// er betinget på den gamle status.
//
// Brug (fra backend/):
//   infisical run --env=prod --silent -- node scripts/dev/closeStaleMandates6773.mjs
//   ... node scripts/dev/closeStaleMandates6773.mjs --apply --owner-go=6773-production --approved-list=<hash>

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { hasBonusGoalForOffer } from "../../lib/boardBonusGoal.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../../lib/supabasePagination.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "../../..");
export const PRIVATE_DIR = join(REPO_ROOT, "balance-internals", "6773");

export const OWNER_GO_TOKEN = "6773-production";
export const BACKUP_TABLE = "backup_6773_board_mandates";
export const OPEN_STATUSES = Object.freeze(["active", "proposed"]);
export const TARGET_STATUS = Object.freeze({ active: "completed", proposed: "lapsed" });

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Den aktive sæson. Kaster hvis der ikke er præcis én: uden den kan
 * "afsluttet" ikke afgøres, og scriptet gætter ikke.
 */
export function resolveActiveSeason(seasons) {
  const active = (seasons || []).filter((s) => s?.status === "active");
  if (active.length !== 1) {
    throw new Error(`Forventede præcis én aktiv sæson, fandt ${active.length}. Intet gjort.`);
  }
  const number = Number(active[0].number);
  if (!Number.isFinite(number)) throw new Error("Den aktive sæson har intet gyldigt nummer. Intet gjort.");
  return { id: active[0].id, number };
}

/**
 * Ren plan. `mandates` = åbne rækker (active/proposed). Returnerer de rækker
 * runtime-predikatet ville lukke, plus samlede tal til den offentlige rapport.
 */
export function planStaleMandateClosure({ seasons, mandates, teams = [] }) {
  const activeSeason = resolveActiveSeason(seasons);
  const threshold = activeSeason.number - 1;
  const teamById = new Map((teams || []).map((t) => [t.id, t]));

  const open = (mandates || []).filter((m) => OPEN_STATUSES.includes(m?.status));
  const rows = [];
  const outOfScope = [];
  for (const m of open) {
    const n = m.season_number == null ? NaN : Number(m.season_number);
    if (!Number.isFinite(n)) {
      outOfScope.push(m);
      continue;
    }
    if (n <= threshold) {
      rows.push({
        id: m.id,
        teamId: m.team_id,
        seasonNumber: n,
        from: m.status,
        to: TARGET_STATUS[m.status],
        signedAt: m.signed_at ?? null,
        // Codex P1 (#6780): lukningen er betinget på denne version (ikke i hashen).
        updatedAt: m.updated_at ?? null,
      });
    }
  }
  rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const currentActiveByTeam = new Map();
  for (const m of open) {
    if (m.status === "active" && Number(m.season_number) === activeSeason.number) {
      currentActiveByTeam.set(m.team_id, m);
    }
  }

  // Review N1: bonusmål på et gammelt aktivt mandat flyttes til holdets aktuelle
  // mandat. Uden aktuelt mandat kan de ikke flyttes; de tælles til ejeren.
  const mandateById = new Map(open.map((m) => [m.id, m]));
  const bonusMoves = [];
  const orphanBonus = [];
  let bonusGoalsWithoutTarget = 0;
  for (const r of rows) {
    if (r.from !== "active") continue;
    const bonus = (mandateById.get(r.id)?.goals || []).filter((g) => g?.source === "bonus_offer");
    if (!bonus.length) continue;
    const target = currentActiveByTeam.get(r.teamId);
    if (!target) { bonusGoalsWithoutTarget += bonus.length; orphanBonus.push({ fromId: r.id, count: bonus.length }); continue; }
    const missing = bonus.filter((g) => !hasBonusGoalForOffer(target.goals, { offerId: g.bonus_offer_id, extraGoal: g }));
    if (missing.length) bonusMoves.push({ fromId: r.id, toId: target.id, teamId: r.teamId, goals: missing });
  }
  bonusMoves.sort((a, b) => String(a.fromId).localeCompare(String(b.fromId)));

  const teamIds = [...new Set(rows.map((r) => r.teamId))].sort();
  const staleActive = rows.filter((r) => r.from === "active");
  const shadowing = staleActive.filter((r) => {
    const current = currentActiveByTeam.get(r.teamId);
    if (!current) return false;
    const staleMs = r.signedAt ? new Date(r.signedAt).getTime() : NaN;
    const currentMs = current.signed_at ? new Date(current.signed_at).getTime() : NaN;
    return Number.isFinite(staleMs) && (!Number.isFinite(currentMs) || staleMs > currentMs);
  });

  const bySeason = {};
  for (const r of rows) {
    const key = `S${r.seasonNumber}`;
    bySeason[key] = bySeason[key] || { active: 0, proposed: 0 };
    bySeason[key][r.from] += 1;
  }

  return {
    activeSeasonNumber: activeSeason.number,
    threshold,
    rows,
    teamIds,
    bonusMoves,
    orphanBonus,
    outOfScopeCount: outOfScope.length,
    counts: {
      total: rows.length,
      activeToCompleted: staleActive.length,
      proposedToLapsed: rows.length - staleActive.length,
      teams: teamIds.length,
      teamsAlsoWithCurrentActive: new Set(staleActive.filter((r) => currentActiveByTeam.has(r.teamId)).map((r) => r.teamId)).size,
      staleSignedAfterCurrent: shadowing.length,
      frozenTeams: teamIds.filter((id) => teamById.get(id)?.is_frozen).length,
      bonusGoalsToMove: bonusMoves.reduce((n, m) => n + m.goals.length, 0),
      bonusGoalsWithoutTarget,
      bySeason,
    },
  };
}

/** Stabil hash af den godkendte liste (id + fra-status), så apply kan nægte en anden mængde. */
export function approvedListHash(plan) {
  const body = [
    ...plan.rows.map((r) => `${r.id}:${r.from}`),
    ...(plan.bonusMoves || []).map((m) => `bonus:${m.fromId}->${m.toId}:${m.goals.length}`),
    ...(plan.orphanBonus || []).map((o) => `orphan-bonus:${o.fromId}:${o.count}`),
  ].join("\n");
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

function uuidList(ids) {
  for (const id of ids) {
    if (!UUID_RE.test(String(id))) throw new Error(`Uventet id-format: ${id}`);
  }
  return ids.map((id) => `'${id}'`).join(",\n  ");
}

/**
 * Backup-SQL (køres FØR apply, fx via Supabase MCP execute_sql). Idempotent:
 * `create table if not exists` + `on conflict do nothing`, så en genkørsel
 * aldrig overskriver det oprindelige før-billede.
 */
/** Alle rækker apply rører: de lukkede + modtagerne af bonusmål. */
export function touchedIds(plan) {
  return [...new Set([...plan.rows.map((r) => r.id), ...(plan.bonusMoves || []).map((m) => m.toId)])].sort();
}

export function buildBackupSql(plan) {
  if (!plan.rows.length) return "-- #6773: ingen kandidater, ingen backup nødvendig\n";
  const ids = uuidList(touchedIds(plan));
  return `-- #6773 backup FØR lukning af mandater for afsluttede sæsoner. Idempotent.
-- data-api-access: {"table":"public.${BACKUP_TABLE}","roles":{"anon":[],"authenticated":[],"service_role":["SELECT"]},"reason":"Backend-only ops backup; apply reads it to prove coverage"}
begin;
create table if not exists public.${BACKUP_TABLE} as
  select *, now() as snapshot_at from public.board_mandates where false;
alter table public.${BACKUP_TABLE} enable row level security;
-- RLS erstatter ikke grants (docs/DATA_API_GRANTS.md): kun service_role må læse.
revoke all on table public.${BACKUP_TABLE} from public, anon, authenticated, service_role;
grant select on table public.${BACKUP_TABLE} to service_role;
create unique index if not exists ${BACKUP_TABLE}_id on public.${BACKUP_TABLE}(id);
insert into public.${BACKUP_TABLE}
  select *, now() from public.board_mandates where id in (
  ${ids}
  )
on conflict (id) do nothing;
commit;
notify pgrst, 'reload schema';
-- Verificér: select count(*) from public.${BACKUP_TABLE}; (skal være ${touchedIds(plan).length})
`;
}

/** Restore-SQL: sæt status/updated_at tilbage fra backuppen. Ejer-gated. */
export function buildRestoreSql() {
  return `-- #6773 restore: rul lukningen tilbage fra ${BACKUP_TABLE}. Ejer-gated.
update public.board_mandates m
   set status = b.status, goals = b.goals, updated_at = b.updated_at
  from public.${BACKUP_TABLE} b
 where b.id = m.id;
`;
}

// ── Læsning ─────────────────────────────────────────────────────────────────

export async function fetchSnapshot(supabase) {
  const { data: seasons, error: seasonsError } = await supabase.from("seasons").select("id, number, status").order("number");
  if (seasonsError) throw new Error(`seasons lookup failed: ${seasonsError.message}`);
  const mandates = await fetchAllRows(() => supabase
    .from("board_mandates")
    .select("id, team_id, season_id, season_number, status, signed_at, proposed_at, goals, updated_at")
    .in("status", [...OPEN_STATUSES])
    .order("id"));
  const teamIds = [...new Set(mandates.map((m) => m.team_id).filter(Boolean))];
  const teams = teamIds.length
    ? await fetchAllRowsChunkedIn(teamIds, (chunk) => supabase.from("teams").select("id, is_frozen").in("id", chunk).order("id"))
    : [];
  return { seasons: seasons || [], mandates, teams };
}

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

/** Proxy der kaster ved enhver skrivning: dry-run kan ikke skrive, heller ikke ved en fejl. */
export function createReadOnlyClient(supabase) {
  return {
    from(table) {
      const builder = supabase.from(table);
      return new Proxy(builder, {
        get(target, prop) {
          if (typeof prop === "string" && WRITE_METHODS.has(prop)) {
            return () => { throw new Error(`dry-run: ${prop} på ${table} er blokeret`); };
          }
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    rpc() {
      throw new Error("dry-run: rpc er blokeret");
    },
  };
}

export async function runDryRun({ supabase }) {
  const snapshot = await fetchSnapshot(createReadOnlyClient(supabase));
  const plan = planStaleMandateClosure(snapshot);
  return { plan, hash: approvedListHash(plan) };
}

// ── Apply (ejer-gated) ──────────────────────────────────────────────────────

/** Kast hvis backup-tabellen ikke dækker alle rækker der skal lukkes. */
export async function assertBackupCovers(supabase, ids) {
  if (!ids.length) return;
  const rows = await fetchAllRowsChunkedIn(ids, (chunk) =>
    supabase.from(BACKUP_TABLE).select("id").in("id", chunk).order("id")
  ).catch((err) => {
    throw new Error(`Backup-tabellen ${BACKUP_TABLE} kan ikke læses (${err.message}). Kør backup.sql først. Intet skrevet.`);
  });
  const covered = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !covered.has(id));
  if (missing.length) {
    throw new Error(`Backuppen mangler ${missing.length} af ${ids.length} rækker. Kør backup.sql igen. Intet skrevet.`);
  }
}

export async function runApply({
  supabase,
  ownerGo,
  approvedHash,
  now = new Date(),
  allowOrphanBonus = 0,
}) {
  if (ownerGo !== OWNER_GO_TOKEN) throw new Error(`--apply kræver --owner-go=${OWNER_GO_TOKEN}. Intet skrevet.`);
  const plan = planStaleMandateClosure(await fetchSnapshot(supabase));
  if (approvedHash !== approvedListHash(plan)) {
    throw new Error("Den levende liste afviger fra den godkendte. Kør dry-run igen og vis ejeren den nye liste. Intet skrevet.");
  }
  // Codex P1: bonusmål uden aktuelt mandat at flytte til bliver usynlige, når
  // kilden lukkes. Det er en ejer-beslutning: apply kræver det præcise antal.
  const orphanCount = plan.counts.bonusGoalsWithoutTarget;
  if (orphanCount > 0 && Number(allowOrphanBonus) !== orphanCount) {
    throw new Error(`${orphanCount} bonusmål har intet aktuelt mandat at flytte til. Kræver ejerens beslutning: --allow-orphan-bonus=${orphanCount}. Intet skrevet.`);
  }
  await assertBackupCovers(supabase, touchedIds(plan));

  // Codex P1 (#6780): hver skrivning skal give en NY updated_at, ellers kan en
  // samtidig accept, der læste efter første flytning, stadig matche sin gamle
  // lås og overskrive næste flytning til samme mandat. Strengt stigende pr. skriv.
  // Codex P1: tokenet skal også ligge EFTER rækkens nuværende updated_at, ellers
  // kan en accept skrevet efter `now` give samme token, og CAS'en ændrer intet.
  let lastLockMs = now.getTime();
  const nextLockToken = (rowUpdatedAt) => {
    const rowMs = rowUpdatedAt == null ? Number.NaN : Date.parse(rowUpdatedAt);
    if (Number.isFinite(rowMs) && rowMs > lastLockMs) lastLockMs = rowMs;
    lastLockMs += 1; // kun fra det injicerede ur (AGENTS L55), strengt stigende
    return new Date(lastLockMs).toISOString();
  };
  const result = { completed: 0, lapsed: 0, bonusGoalsMoved: 0, skipped: [] };

  // (1) Bonusmål først, så intet accepteret mål er usynligt mellem de to trin.
  // Codex P1: lykkes en flytning ikke, lukkes kilden IKKE.
  const keepOpen = new Set();
  // Codex P1: optimistisk lås på updated_at, så en samtidig accept af et
  // bonustilbud (appendBonusGoalToActiveMandate sætter updated_at) aldrig
  // overskrives af et forældet goals-array. Ved kollision læses der igen.
  for (const move of plan.bonusMoves) {
    let moved = false;
    let reason = "bonusmål ikke skrevet efter 3 forsøg; kilden lukkes ikke";
    for (let attempt = 1; attempt <= 3 && !moved; attempt += 1) {
      const { data: target, error } = await supabase
        .from("board_mandates").select("id, status, goals, updated_at").eq("id", move.toId).maybeSingle();
      if (error) throw new Error(`modtager-mandat ${move.toId}: ${error.message}`);
      if (!target || target.status !== "active") { reason = "modtager ikke aktiv; kilden lukkes ikke"; break; }
      const current = Array.isArray(target.goals) ? target.goals : [];
      const add = move.goals.filter((g) => !hasBonusGoalForOffer(current, { offerId: g.bonus_offer_id, extraGoal: g }));
      if (!add.length) { moved = true; break; }
      let q = supabase.from("board_mandates").update({ goals: [...current, ...add], updated_at: nextLockToken(target.updated_at) })
        .eq("id", move.toId).eq("status", "active");
      q = target.updated_at == null ? q.is("updated_at", null) : q.eq("updated_at", target.updated_at);
      const { data: upd, error: upErr } = await q.select("id");
      if (upErr) throw new Error(`bonusmål til ${move.toId}: ${upErr.message}`);
      if ((upd || []).length) { result.bonusGoalsMoved += add.length; moved = true; }
    }
    if (!moved) { result.skipped.push({ id: move.toId, reason }); keepOpen.add(move.fromId); }
  }

  // (2) Luk KUN de godkendte id'er, betinget på den forventede gamle status.
  // Codex P1 (#6780): lukningen er også betinget på kildens updated_at fra
  // snapshottet. Har en accept tilføjet et bonusmål til kilden imens, lukkes
  // den ikke (målet ville blive usynligt); en ny dry-run fanger det.
  for (const r of plan.rows) {
    if (keepOpen.has(r.id)) continue;
    let q = supabase
      .from("board_mandates").update({ status: r.to, updated_at: nextLockToken(r.updatedAt) })
      .eq("id", r.id).eq("status", r.from);
    q = r.updatedAt == null ? q.is("updated_at", null) : q.eq("updated_at", r.updatedAt);
    const { data: upd, error } = await q.select("id");
    if (error) throw new Error(`luk ${r.id}: ${error.message}`);
    if (!(upd || []).length) { result.skipped.push({ id: r.id, reason: "ændret siden godkendelse (status eller indhold); kør dry-run igen" }); continue; }
    if (r.to === "completed") result.completed += 1; else result.lapsed += 1;
  }

  const after = planStaleMandateClosure(await fetchSnapshot(supabase));
  return { plan, result, remaining: after.counts.total };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const goArg = argv.find((a) => a.startsWith("--owner-go="));
  const hashArg = argv.find((a) => a.startsWith("--approved-list="));
  const ownerGo = goArg ? goArg.slice("--owner-go=".length) : null;
  const approvedHash = hashArg ? hashArg.slice("--approved-list=".length) : null;
  const orphanArg = argv.find((a) => a.startsWith("--allow-orphan-bonus="));
  const allowOrphanBonus = orphanArg ? Number(orphanArg.slice("--allow-orphan-bonus=".length)) : 0;
  if (apply && ownerGo !== OWNER_GO_TOKEN) {
    return { error: `--apply kræver --owner-go=${OWNER_GO_TOKEN} (eksplicit ejer-go for netop denne kørsel).` };
  }
  if (apply && !approvedHash) return { error: "--apply kræver --approved-list=<hash> fra det dry-run ejeren godkendte." };
  return { apply, ownerGo, approvedHash, allowOrphanBonus };
}

/** Offentlige linjer: kun samlede tal, ingen id'er. */
export function renderPublicSummary(plan, hash) {
  const c = plan.counts;
  const lines = [
    `Aktiv sæson: S${plan.activeSeasonNumber} (lukker mandater for S${plan.threshold} og ældre)`,
    `Rækker der ville blive lukket: ${c.total} (active → completed: ${c.activeToCompleted}, proposed → lapsed: ${c.proposedToLapsed})`,
    `Berørte hold: ${c.teams} (heraf frosne: ${c.frozenTeams})`,
    `Bonusmål der flyttes til det aktuelle mandat: ${c.bonusGoalsToMove}; bonusmål uden aktuelt mandat at flytte til: ${c.bonusGoalsWithoutTarget}`,
    `Hold der også har et aktivt mandat for S${plan.activeSeasonNumber}: ${c.teamsAlsoWithCurrentActive}`,
    `Gamle mandater underskrevet SENERE end holdets aktuelle (skygger i den gamle læser): ${c.staleSignedAfterCurrent}`,
    `Pr. sæson: ${Object.entries(c.bySeason).map(([k, v]) => `${k} active=${v.active} proposed=${v.proposed}`).join("; ") || "ingen"}`,
    `Uden for scope (intet season_number, røres ikke): ${plan.outOfScopeCount}`,
    `Liste-hash: ${hash}`,
  ];
  return lines.join("\n");
}

function writePrivateFiles(plan, hash, generatedAt) {
  mkdirSync(PRIVATE_DIR, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const detailFile = join(PRIVATE_DIR, `dry-run-${stamp}.json`);
  writeFileSync(detailFile, JSON.stringify({ generatedAt, hash, ...plan }, null, 2), "utf8");
  writeFileSync(join(PRIVATE_DIR, "backup.sql"), buildBackupSql(plan), "utf8");
  writeFileSync(join(PRIVATE_DIR, "restore.sql"), buildRestoreSql(), "utf8");
  return detailFile;
}

function isMain() {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY.");
    process.exit(1);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key);

  if (!args.apply) {
    const { plan, hash } = await runDryRun({ supabase });
    const detailFile = writePrivateFiles(plan, hash, new Date().toISOString());
    console.log("DRY-RUN (read-only, intet skrevet)");
    console.log(renderPublicSummary(plan, hash));
    console.log(`Detaljer + backup.sql + restore.sql: ${detailFile.replace(REPO_ROOT, ".")} (gitignoreret)`);
    console.log(`Anvend (ejer-go): --apply --owner-go=${OWNER_GO_TOKEN} --approved-list=${hash}`);
    return;
  }

  const { result, remaining } = await runApply({ supabase, ownerGo: args.ownerGo, approvedHash: args.approvedHash, allowOrphanBonus: args.allowOrphanBonus });
  console.log(`APPLY: completed ${result.completed}, lapsed ${result.lapsed}, bonusmål flyttet ${result.bonusGoalsMoved}, sprunget over ${result.skipped.length}`);
  for (const f of result.skipped) console.error(`  SKIP: ${f.reason}`);
  console.log(`POST-VERIFY: åbne mandater for afsluttede sæsoner tilbage: ${remaining}`);
  process.exit(result.skipped.length > 0 || remaining > 0 ? 1 : 0);
}

if (isMain()) {
  await main();
}
