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
//   --apply --owner-go=6773-production --approved-list=<hash>: lukker rækkerne
//   via SAMME funktion som sæsonskiftet (`closeEndedSeasonMandates`, genbrugt,
//   ikke kopieret) pr. hold med tærsklen "aktiv sæson - 1". Afbryder FØR første
//   skrivning hvis den levende liste afviger fra den godkendte (hash), eller
//   hvis backup-tabellen (backup_6773_board_mandates) ikke dækker alle rækker.
//   Efter apply: post-verify (0 tilbage), ellers exit 1.
//
// SCOPE = runtime-predikatet: status active/proposed og
//   season_number <= aktiv sæson - 1. Rækker uden season_number tælles separat
//   ("uden for scope") og røres ikke, præcis som runtime.
//   active → completed, proposed → lapsed. Kun status og updated_at skrives:
//   ingen tillid, ingen kvittering, ingen penge.
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

import { closeEndedSeasonMandates } from "../../lib/boardMandateEngine.js";
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
    outOfScopeCount: outOfScope.length,
    counts: {
      total: rows.length,
      activeToCompleted: staleActive.length,
      proposedToLapsed: rows.length - staleActive.length,
      teams: teamIds.length,
      teamsAlsoWithCurrentActive: new Set(staleActive.filter((r) => currentActiveByTeam.has(r.teamId)).map((r) => r.teamId)).size,
      staleSignedAfterCurrent: shadowing.length,
      frozenTeams: teamIds.filter((id) => teamById.get(id)?.is_frozen).length,
      bySeason,
    },
  };
}

/** Stabil hash af den godkendte liste (id + fra-status), så apply kan nægte en anden mængde. */
export function approvedListHash(plan) {
  const body = plan.rows.map((r) => `${r.id}:${r.from}`).join("\n");
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
export function buildBackupSql(plan) {
  if (!plan.rows.length) return "-- #6773: ingen kandidater, ingen backup nødvendig\n";
  const ids = uuidList(plan.rows.map((r) => r.id));
  return `-- #6773 backup FØR lukning af mandater for afsluttede sæsoner. Idempotent.
begin;
create table if not exists public.${BACKUP_TABLE} as
  select *, now() as snapshot_at from public.board_mandates where false;
alter table public.${BACKUP_TABLE} enable row level security;
create unique index if not exists ${BACKUP_TABLE}_id on public.${BACKUP_TABLE}(id);
insert into public.${BACKUP_TABLE}
  select *, now() from public.board_mandates where id in (
  ${ids}
  )
on conflict (id) do nothing;
commit;
notify pgrst, 'reload schema';
-- Verificér: select count(*) from public.${BACKUP_TABLE}; (skal være ${plan.rows.length})
`;
}

/** Restore-SQL: sæt status/updated_at tilbage fra backuppen. Ejer-gated. */
export function buildRestoreSql() {
  return `-- #6773 restore: rul lukningen tilbage fra ${BACKUP_TABLE}. Ejer-gated.
update public.board_mandates m
   set status = b.status, updated_at = b.updated_at
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
    .select("id, team_id, season_id, season_number, status, signed_at, proposed_at")
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
  closeFn = closeEndedSeasonMandates,
}) {
  if (ownerGo !== OWNER_GO_TOKEN) throw new Error(`--apply kræver --owner-go=${OWNER_GO_TOKEN}. Intet skrevet.`);
  const plan = planStaleMandateClosure(await fetchSnapshot(supabase));
  if (approvedHash !== approvedListHash(plan)) {
    throw new Error("Den levende liste afviger fra den godkendte. Kør dry-run igen og vis ejeren den nye liste. Intet skrevet.");
  }
  await assertBackupCovers(supabase, plan.rows.map((r) => r.id));

  const result = { completed: 0, lapsed: 0, failedTeams: [] };
  for (const teamId of plan.teamIds) {
    try {
      const res = await closeFn(supabase, { teamId, endedSeasonNumber: plan.threshold, now });
      result.completed += res.completed;
      result.lapsed += res.lapsed;
    } catch (err) {
      result.failedTeams.push({ teamId, error: err.message });
    }
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
  if (apply && ownerGo !== OWNER_GO_TOKEN) {
    return { error: `--apply kræver --owner-go=${OWNER_GO_TOKEN} (eksplicit ejer-go for netop denne kørsel).` };
  }
  if (apply && !approvedHash) return { error: "--apply kræver --approved-list=<hash> fra det dry-run ejeren godkendte." };
  return { apply, ownerGo, approvedHash };
}

/** Offentlige linjer: kun samlede tal, ingen id'er. */
export function renderPublicSummary(plan, hash) {
  const c = plan.counts;
  const lines = [
    `Aktiv sæson: S${plan.activeSeasonNumber} (lukker mandater for S${plan.threshold} og ældre)`,
    `Rækker der ville blive lukket: ${c.total} (active → completed: ${c.activeToCompleted}, proposed → lapsed: ${c.proposedToLapsed})`,
    `Berørte hold: ${c.teams} (heraf frosne: ${c.frozenTeams})`,
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

  const { result, remaining } = await runApply({ supabase, ownerGo: args.ownerGo, approvedHash: args.approvedHash });
  console.log(`APPLY: completed ${result.completed}, lapsed ${result.lapsed}, fejlede hold ${result.failedTeams.length}`);
  for (const f of result.failedTeams) console.error(`  FAIL ${f.teamId}: ${f.error}`);
  console.log(`POST-VERIFY: åbne mandater for afsluttede sæsoner tilbage: ${remaining}`);
  process.exit(result.failedTeams.length > 0 || remaining > 0 ? 1 : 0);
}

if (isMain()) {
  await main();
}
