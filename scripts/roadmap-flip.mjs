#!/usr/bin/env node
// scripts/roadmap-flip.mjs
// ============================================================
// Faerdig-rutinen for roadmap-hubben (#6152, spor 4; spec §7).
//
// Naar en PR lukker et issue, finder scriptet roadmap-punkter og kendte fejl
// med issue_ref = N og viser hvad der ville blive flyttet (dry-run).
// Med --apply saettes shipped/fixed og tidsstemplet.
//
// Brug:  infisical run -- node scripts/roadmap-flip.mjs --issue N [--apply]
// Env:   SUPABASE_URL + SUPABASE_SERVICE_KEY (print aldrig vaerdierne).
//
// Flyttet maa kun koeres med --apply EFTER merge og naar funktionen er live
// for alle (ikke beta). Se docs/GITHUB_WORKFLOW.md (close-protokollen).
//
// #8793: --apply afviser, naar issuets levering kun roerer interne stier (docs,
// scripts, CI, tests) eller slet ikke findes. Et issue med en roadmap-raekke er
// altid spillervendt, saa et designdokument maa aldrig flytte det til leveret.
// Leveringen laeses med gh + git (samme regel som til doers, lib/til-doers.mjs).
// ============================================================

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchIssueBundle } from "./lib/til-doers.mjs";

const DONE_ITEM = ["shipped", "archived"];
const DONE_ISSUE = ["fixed", "dismissed"];

/**
 * Ren vurdering af issuets levering. ok = false betyder, at --apply skal afvises.
 * @param {{prs?: Array, commits?: Array, internalOnly?: boolean}} bundle fra fetchIssueBundle
 */
export function deliveryGate({ prs = [], commits = [], internalOnly = false } = {}) {
  if (!prs.some((p) => p.merged) && !commits.length) {
    return { ok: false, reason: "ingen merget PR eller main-commit refererer issuet" };
  }
  if (internalOnly) {
    return { ok: false, reason: "leveringen rører kun interne stier (docs, scripts, CI, tests), ikke spillervendt kode" };
  }
  return { ok: true, reason: "spillervendt levering er merget" };
}

/** Henter leveringen og vurderer den. fetchBundle injiceres i tests. */
export function checkDelivery({ issue, fetchBundle = fetchIssueBundle }) {
  return deliveryGate(fetchBundle({ number: issue }));
}

/** Ren planlaegger: ingen I/O. Returnerer en liste af patches. */
export function planFlips({ issue, now, items, issues }) {
  if (!Number.isSafeInteger(issue) || issue < 1) {
    throw new Error("--issue skal være et positivt heltal");
  }
  return [
    ...items
      .filter((i) => i.issue_ref === issue && !DONE_ITEM.includes(i.status))
      .map((i) => ({
        table: "roadmap_items",
        id: i.id,
        title: i.title_en,
        from: i.status,
        patch: { status: "shipped", shipped_at: now },
      })),
    ...issues
      .filter((k) => k.issue_ref === issue && !DONE_ISSUE.includes(k.status))
      .map((k) => ({
        table: "known_issues",
        id: k.id,
        title: k.title_en,
        from: k.status,
        patch: { status: "fixed", closed_at: now, updated_at: now },
      })),
  ];
}

export function parseArgs(argv) {
  const out = { issue: NaN, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--issue") out.issue = Number(argv[(i += 1)]);
    else if (a.startsWith("--issue=")) out.issue = Number(a.slice("--issue=".length));
    else throw new Error(`Ukendt argument: ${a}`);
  }
  return out;
}

export function formatPlan(plan) {
  if (plan.length === 0) return "Ingen roadmap-punkter eller kendte fejl at flytte.";
  const lines = plan.map(
    (p) => `${p.table.padEnd(14)} ${String(p.id).slice(0, 8)}  ${p.from} -> ${p.patch.status}  ${p.title}`,
  );
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_KEY er ikke sat i miljøet (kør via infisical run).");
  }
  // Valider issue-nummeret foer vi rører nettet.
  planFlips({ issue: args.issue, now: "", items: [], issues: [] });

  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const [itemsRes, issuesRes] = await Promise.all([
    db.from("roadmap_items").select("id, issue_ref, status, title_en").eq("issue_ref", args.issue),
    db.from("known_issues").select("id, issue_ref, status, title_en").eq("issue_ref", args.issue),
  ]);
  if (itemsRes.error) throw new Error(`roadmap_items: ${itemsRes.error.message}`);
  if (issuesRes.error) throw new Error(`known_issues: ${issuesRes.error.message}`);

  const now = new Date().toISOString();
  const plan = planFlips({ issue: args.issue, now, items: itemsRes.data, issues: issuesRes.data });
  console.log(formatPlan(plan));

  // #8793: en fejl i opslaget kaster videre, saa --apply aldrig skriver paa et ukendt grundlag.
  const gate = plan.length ? checkDelivery({ issue: args.issue }) : null;
  if (gate) console.log(`\nlevering: ${gate.ok ? "ok" : "afvist"} (${gate.reason})`);

  if (!args.apply) {
    console.log("\ndry-run, intet skrevet");
    return;
  }
  if (gate && !gate.ok) {
    throw new Error(`--apply afvist (#8793): ${gate.reason}. Intet skrevet.`);
  }

  for (const p of plan) {
    // Optimistisk laas: kun hvis status stadig er den vi planlagde ud fra.
    const { data: changed, error } = await db
      .from(p.table)
      .update(p.patch)
      .eq("id", p.id)
      .eq("status", p.from)
      .select("id");
    if (error) throw new Error(`${p.table} ${p.id}: ${error.message}`);
    if (!changed || changed.length === 0) {
      throw new Error(`${p.table} ${p.id}: status ændret siden planen blev lavet, intet skrevet`);
    }
    const { data, error: vErr } = await db.from(p.table).select("id, status").eq("id", p.id).single();
    if (vErr) throw new Error(`verify ${p.table} ${p.id}: ${vErr.message}`);
    if (data.status !== p.patch.status) {
      throw new Error(`verify ${p.table} ${p.id}: forventede ${p.patch.status}, fandt ${data.status}`);
    }
    console.log(`flyttet ${p.table} ${p.id} -> ${data.status} (verificeret)`);
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`roadmap-flip fejlede: ${err.message}`);
    process.exit(1);
  });
}
