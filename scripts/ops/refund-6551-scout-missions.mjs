// scripts/ops/refund-6551-scout-missions.mjs
//
// #6579 · Engangs-refusion af scout-missioner ramt af #6551 (ejer-beslutning 13/10: A).
//
// Fejlen: scoutMissionMaturation.defaultLoadCandidates hentede riders og
// academy_intake(status=offered) uden paginering. PostgREST klipper ved 1.000
// raekker, saa eksklusionen af offered-intake-ryttere manglede et par hundrede
// ryttere. Fra ca. 1/10 (offered > 1.000) kunne en faerdig mission derfor ende med
// en shortlist der KUN bestod af skjulte ryttere. Visningslaget
// (backend/lib/scoutReportVisibility.js) fjerner dem, og feedet skjuler missioner
// med tom liste. Spilleren betalte og fik intet.
//
// UDVAELGELSE (ren funktion selectAffectedMissions, testet):
//   · kind='mission', status='completed', completed_at i [--from, --to)
//   · shortlist er ikke tom, og HVER rytter i den er skjult NU eller slettet
//     (samme predikat som visningslaget: isRiderHiddenFromReport)
//   · der findes en oprindelig scout_travel-debitering for missionen
//     (idempotency_key scout_travel:<team>:<assignment>); refusionen er dens beloeb
//   IKKE med: missioner med en reelt tom shortlist fra start (ejer: spejderen har
//   gjort arbejdet). Det var mulighed B, som er fravalgt.
//
// IDEMPOTENS: refusionen skrives via increment_balance_with_audit-RPC'en med
// idempotency_key = scout_refund_6551:<assignment-id>. Den UNIQUE-haandhaevede
// noegle goer at en anden koersel ruller transaktionen tilbage (23505 -> skipped),
// saa der aldrig betales to gange. Notifikationen sendes kun hvis der ikke allerede
// ligger en med samme related_id + messageCode, saa en genkoersel efter en
// notifikationsfejl indhenter den manglende besked uden at sende dubletter.
//
// Brug:
//   # 1) dry-run (default, INGEN skrivning)
//   infisical run --env=prod -- node scripts/ops/refund-6551-scout-missions.mjs
//
//   # 2) udfoer (kraever ejer-go paa dry-run-tallene + at tallene stadig matcher)
//   OWNER_GO=1 infisical run --env=prod -- node scripts/ops/refund-6551-scout-missions.mjs \
//     --execute --expect-count=9 --expect-total=54000
//
// Flag:
//   --execute            skriv refusion + notifikation (naegter uden OWNER_GO=1)
//   --expect-count=N     paakraevet ved --execute: antal raekker der skal refunderes
//   --expect-total=N     paakraevet ved --execute: samlet beloeb
//   --from=YYYY-MM-DD    vindue-start for completed_at (default 2026-10-01)
//   --to=YYYY-MM-DD      vindue-slut, eksklusiv (default 2026-10-13)
//   --show-names         vis holdnavne i stedet for aliaser (ALDRIG i et offentligt repo/PR)
//
// Testbarhed: filen importerer kun backend/lib/balanceRpc.js (ingen afhaengigheder).
// @supabase/supabase-js loades dynamisk i main(), saa testen kan importere filen i
// CI's static-guards-job uden npm ci.

import { incrementBalanceWithAudit } from "../../backend/lib/balanceRpc.js";

export const REFUND_IDEMPOTENCY_PREFIX = "scout_refund_6551";
export const REFUND_REASON_CODE = "scout_lost_report_refund_6551";
export const REFUND_TX_CODE = "tx.scoutLostReportRefund";
export const NOTIF_TYPE = "admin_notice";
export const NOTIF_TITLE_CODE = "notif.scoutLostReportRefund.title";
export const NOTIF_MESSAGE_CODE = "notif.scoutLostReportRefund.message";
export const DEFAULT_FROM = "2026-10-01";
export const DEFAULT_TO = "2026-10-13";
const PAGE = 1000;
const CHUNK = 200;

export function refundIdempotencyKey(assignmentId) {
  return `${REFUND_IDEMPOTENCY_PREFIX}:${assignmentId}`;
}

export function originalDebitKey(teamId, assignmentId) {
  return `scout_travel:${teamId}:${assignmentId}`;
}

// Spejler backend/lib/scoutReportVisibility.js isRiderHiddenFromReport. Kopieret
// (ikke importeret) fordi den fil ellers er ren, men vi vil ikke have at et senere
// import i den fil kan braekke static-guards; testen laaser at de er enige.
export function isHidden(rider, offeredRiderIds) {
  if (!rider) return true; // slettet rytter
  if (rider.pending_team_id != null) return true;
  if (rider.owner_is_ai === true) return true;
  if (offeredRiderIds.has(rider.id) && rider.team_id == null && rider.is_academy === false) return true;
  return false;
}

/**
 * Ren udvaelgelse. Returnerer { rows, skipped } hvor rows er missioner der skal
 * (eller allerede er) refunderet og skipped forklarer kandidater der faldt fra.
 */
export function selectAffectedMissions({ missions, ridersById, offeredRiderIds, debitsByKey, refundedKeys }) {
  const rows = [];
  const skipped = [];
  for (const m of missions) {
    if (m.kind !== "mission" || m.status !== "completed") continue;
    const shortlist = Array.isArray(m.result?.shortlist) ? m.result.shortlist : [];
    if (shortlist.length === 0) continue; // reelt tom fra start: ikke med (B fravalgt)
    const allHidden = shortlist.every((id) => isHidden(ridersById.get(id), offeredRiderIds));
    if (!allHidden) continue;
    const debit = debitsByKey.get(originalDebitKey(m.team_id, m.id));
    if (!debit) {
      skipped.push({ assignmentId: m.id, teamId: m.team_id, reason: "no_original_debit" });
      continue;
    }
    const amount = Math.abs(Number(debit.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      skipped.push({ assignmentId: m.id, teamId: m.team_id, reason: "invalid_debit_amount" });
      continue;
    }
    const key = refundIdempotencyKey(m.id);
    rows.push({
      assignmentId: m.id,
      teamId: m.team_id,
      seasonId: m.season_id ?? null,
      completedOn: String(m.completed_at ?? "").slice(0, 10),
      shortlistSize: shortlist.length,
      amount,
      idempotencyKey: key,
      alreadyRefunded: refundedKeys.has(key),
    });
  }
  rows.sort((a, b) => (a.completedOn + a.assignmentId).localeCompare(b.completedOn + b.assignmentId));
  return { rows, skipped };
}

export function summarize(rows) {
  const pending = rows.filter((r) => !r.alreadyRefunded);
  return {
    count: rows.length,
    teams: new Set(rows.map((r) => r.teamId)).size,
    total: rows.reduce((s, r) => s + r.amount, 0),
    pendingCount: pending.length,
    pendingTotal: pending.reduce((s, r) => s + r.amount, 0),
  };
}

// Stabile aliaser (Hold A, B, ...) i raekkefoelgen holdene foerst optraeder.
export function teamAliases(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.teamId)) map.set(r.teamId, `Hold ${String.fromCharCode(65 + map.size)}`);
  }
  return map;
}

export function buildFinancePayload(row) {
  return {
    type: "scout_travel", // positiv modpost til den oprindelige scout_travel-debitering
    amount: row.amount,
    description: "Refund: scout report lost to a bug",
    season_id: row.seasonId,
    actor_type: "admin",
    source_path: "scripts/ops/refund-6551-scout-missions.mjs",
    reason_code: REFUND_REASON_CODE,
    related_entity_type: "manual",
    related_entity_id: row.assignmentId, // uuid-kolonne; peger paa scout_assignments-raekken
    idempotency_key: row.idempotencyKey,
    metadata: { code: REFUND_TX_CODE, params: { assignmentId: row.assignmentId } },
  };
}

export function buildNotification(row, userId) {
  const params = { date: row.completedOn, amount: row.amount };
  return {
    user_id: userId,
    type: NOTIF_TYPE,
    title: "Scout mission refunded",
    message: `Your scout report from ${row.completedOn} was lost to a bug. The ${row.amount.toLocaleString("en-US")} CZ$ has been refunded.`,
    related_id: row.assignmentId,
    is_read: false,
    metadata: {
      kind: "scout_refund_6551",
      titleCode: NOTIF_TITLE_CODE,
      titleParams: {},
      messageCode: NOTIF_MESSAGE_CODE,
      messageParams: params,
    },
  };
}

/**
 * Udfoer refusion for de raekker der ikke allerede er refunderet, og sender
 * manglende notifikationer. Idempotent: kan koeres igen uden dobbeltbetaling.
 */
export async function executeRefunds(client, rows, { userIdByTeam, notifiedAssignmentIds }) {
  const results = [];
  for (const row of rows) {
    let status = "already_refunded";
    if (!row.alreadyRefunded) {
      const res = await incrementBalanceWithAudit(
        client,
        { teamId: row.teamId, delta: row.amount, payload: buildFinancePayload(row) },
        { allowDuplicate: true },
      );
      status = res.skipped ? "already_refunded" : "refunded";
    }
    let notified = notifiedAssignmentIds.has(row.assignmentId) ? "already_notified" : "skipped_no_owner";
    const userId = userIdByTeam.get(row.teamId);
    if (notified !== "already_notified" && userId) {
      const { error } = await client.from("notifications").insert(buildNotification(row, userId));
      if (error) {
        console.error(`[refund-6551] notifikation fejlede for ${row.assignmentId}: ${error.message}`);
        notified = "notify_failed";
      } else {
        notified = "notified";
        notifiedAssignmentIds.add(row.assignmentId);
      }
    }
    results.push({ assignmentId: row.assignmentId, status, notified });
  }
  return results;
}

export function parseArgs(argv) {
  const opts = { execute: false, from: DEFAULT_FROM, to: DEFAULT_TO, showNames: false, expectCount: null, expectTotal: null };
  for (const a of argv) {
    if (a === "--execute") opts.execute = true;
    else if (a === "--dry-run") opts.execute = false;
    else if (a === "--show-names") opts.showNames = true;
    else if (a.startsWith("--from=")) opts.from = a.slice(7);
    else if (a.startsWith("--to=")) opts.to = a.slice(5);
    else if (a.startsWith("--expect-count=")) opts.expectCount = Number(a.slice(15));
    else if (a.startsWith("--expect-total=")) opts.expectTotal = Number(a.slice(15));
    else throw new Error(`Ukendt flag: ${a}`);
  }
  if (argv.includes("--execute") && argv.includes("--dry-run")) throw new Error("--execute og --dry-run kan ikke kombineres");
  for (const d of [opts.from, opts.to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Ugyldig dato: ${d}`);
  }
  return opts;
}

/** Gate for --execute. Returnerer en fejltekst eller null. */
export function executeGate(opts, summary, env) {
  if (env.OWNER_GO !== "1") return "--execute kraever OWNER_GO=1 (ejer-go paa dry-run-tallene)";
  if (!Number.isFinite(opts.expectCount) || !Number.isFinite(opts.expectTotal)) {
    return "--execute kraever --expect-count=N og --expect-total=N fra den godkendte dry-run";
  }
  if (summary.count !== opts.expectCount || summary.total !== opts.expectTotal) {
    return `Tallene matcher ikke den godkendte dry-run: fandt ${summary.count} / ${summary.total}, forventede ${opts.expectCount} / ${opts.expectTotal}`;
  }
  return null;
}

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function fetchPaged(build) {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) return all;
  }
}

async function fetchIn(client, table, select, column, values, extra = (q) => q) {
  const all = [];
  for (const part of chunks([...new Set(values)], CHUNK)) {
    const rows = await fetchPaged(() => extra(client.from(table).select(select).in(column, part)).order("id"));
    all.push(...rows);
  }
  return all;
}

export async function loadPlanInputs(client, { from, to }) {
  const missions = await fetchPaged(() =>
    client
      .from("scout_assignments")
      .select("id, team_id, kind, status, result, season_id, completed_at")
      .eq("kind", "mission")
      .eq("status", "completed")
      .gte("completed_at", `${from}T00:00:00Z`)
      .lt("completed_at", `${to}T00:00:00Z`)
      .order("id"),
  );
  const riderIds = missions.flatMap((m) => (Array.isArray(m.result?.shortlist) ? m.result.shortlist : []));
  const riders = await fetchIn(client, "riders", "id, team_id, pending_team_id, is_academy, owner_is_ai", "id", riderIds);
  const offered = await fetchIn(client, "academy_intake", "id, rider_id", "rider_id", riderIds, (q) => q.eq("status", "offered"));
  const debitKeys = missions.map((m) => originalDebitKey(m.team_id, m.id));
  const debits = await fetchIn(client, "finance_transactions", "id, idempotency_key, amount", "idempotency_key", debitKeys);
  const refundKeys = missions.map((m) => refundIdempotencyKey(m.id));
  const refunds = await fetchIn(client, "finance_transactions", "id, idempotency_key", "idempotency_key", refundKeys);
  return {
    missions,
    ridersById: new Map(riders.map((r) => [r.id, r])),
    offeredRiderIds: new Set(offered.map((o) => o.rider_id)),
    debitsByKey: new Map(debits.map((d) => [d.idempotency_key, d])),
    refundedKeys: new Set(refunds.map((r) => r.idempotency_key)),
  };
}

async function loadTeams(client, teamIds) {
  return fetchIn(client, "teams", "id, name, user_id", "id", teamIds);
}

async function loadNotified(client, assignmentIds) {
  const rows = await fetchIn(client, "notifications", "id, related_id, metadata", "related_id", assignmentIds, (q) => q.eq("type", NOTIF_TYPE));
  return new Set(rows.filter((n) => n.metadata?.messageCode === NOTIF_MESSAGE_CODE).map((n) => n.related_id));
}

export function formatReport(rows, summary, labelFor) {
  const lines = [];
  lines.push("| # | Hold | Assignment | Rapport-dato | Beloeb | Status |");
  lines.push("|---|------|------------|--------------|--------|--------|");
  rows.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${labelFor(r.teamId)} | ${r.assignmentId.slice(0, 8)} | ${r.completedOn} | ${r.amount} | ${r.alreadyRefunded ? "allerede refunderet" : "afventer"} |`);
  });
  lines.push("");
  lines.push(`Total: ${summary.count} missioner / ${summary.teams} hold / ${summary.total} (heraf afventer ${summary.pendingCount} / ${summary.pendingTotal})`);
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error("SUPABASE_URL og SUPABASE_SERVICE_KEY skal vaere sat (infisical run --env=prod -- ...)");
  }
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const inputs = await loadPlanInputs(client, opts);
  const { rows, skipped } = selectAffectedMissions(inputs);
  const summary = summarize(rows);
  const aliases = teamAliases(rows);
  const teams = await loadTeams(client, rows.map((r) => r.teamId));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const labelFor = (teamId) => (opts.showNames ? teamById.get(teamId)?.name ?? teamId : aliases.get(teamId));

  console.log(`[refund-6551] ${opts.execute ? "EXECUTE" : "DRY-RUN"} · vindue completed_at [${opts.from}, ${opts.to})`);
  console.log(`[refund-6551] kandidater i vinduet: ${inputs.missions.length} faerdige missioner`);
  console.log(formatReport(rows, summary, labelFor));
  for (const s of skipped) console.log(`[refund-6551] sprunget over: ${s.assignmentId.slice(0, 8)} (${s.reason})`);

  if (!opts.execute) {
    console.log("[refund-6551] dry-run: intet skrevet. --execute kraever OWNER_GO=1 + --expect-count/--expect-total.");
    return;
  }

  const gate = executeGate(opts, summary, process.env);
  if (gate) {
    console.error(`[refund-6551] STOP: ${gate}`);
    process.exitCode = 1;
    return;
  }
  const userIdByTeam = new Map(teams.filter((t) => t.user_id).map((t) => [t.id, t.user_id]));
  const notifiedAssignmentIds = await loadNotified(client, rows.map((r) => r.assignmentId));
  const results = await executeRefunds(client, rows, { userIdByTeam, notifiedAssignmentIds });
  for (const r of results) console.log(`[refund-6551] ${r.assignmentId.slice(0, 8)}: ${r.status}, ${r.notified}`);
  if (results.some((r) => r.notified === "notify_failed")) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  main().catch((err) => {
    console.error(`[refund-6551] fejl: ${err.message}`);
    process.exit(1);
  });
}
