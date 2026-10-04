#!/usr/bin/env node
// scripts/roadmap-drift.mjs
// ============================================================
// Drift-tjek mellem docs/MASTERPLAN.md og roadmap-hubben (#6152, spor 4,
// task 4.3; spec §7 "Samspil med masterplanen").
//
// READ-ONLY: skriver aldrig noget (hverken Supabase, GitHub eller filer).
// Viser to lister:
//   missing - issues i MASTERPLANs Brand og "Lovet til spillerne", som hverken
//             har et roadmap-punkt eller en kendt fejl.
//   stale   - punkter/fejl hvis issue er lukket eller claude:done, men som
//             stadig staar som planlagt, i gang eller aaben.
// Exit 0 ogsaa ved fund: det er en rapport, ikke en gate.
//
// Brug:  infisical run -- node scripts/roadmap-drift.mjs
// Env:   SUPABASE_URL + SUPABASE_SERVICE_KEY (print aldrig vaerdierne).
// Tekst-heuristik: issue-numre hentes med regex fra to sektioner.
// ============================================================

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Sektioner i docs/MASTERPLAN.md, hvis issues spillerne kan maerke.
const PLAN_SECTIONS = [/^## .*Brand/, /^## Bane 1 · Lovet/];
const ITEM_DONE = ["shipped", "archived"];
const ISSUE_DONE = ["fixed", "dismissed"];

export function planIssueNumbers(markdown) {
  const out = [];
  let inside = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      inside = PLAN_SECTIONS.some((re) => re.test(line));
    } else if (inside) {
      for (const m of line.matchAll(/#(\d+)/g)) {
        const n = Number(m[1]);
        if (!out.includes(n)) out.push(n);
      }
    }
  }
  return out;
}

export function findDrift({ planIssues, items, issues, doneIssues }) {
  const linked = new Set([...items, ...issues].map((r) => r.issue_ref).filter(Boolean));
  return {
    missing: planIssues.filter((n) => !linked.has(n)),
    stale: [
      ...items
        .filter((i) => doneIssues.has(i.issue_ref) && !ITEM_DONE.includes(i.status))
        .map((i) => ({ table: "roadmap_items", id: i.id, title: i.title_en, status: i.status, issue: i.issue_ref })),
      ...issues
        .filter((k) => doneIssues.has(k.issue_ref) && !ISSUE_DONE.includes(k.status))
        .map((k) => ({ table: "known_issues", id: k.id, title: k.title_en, status: k.status, issue: k.issue_ref })),
    ],
  };
}

export function formatDrift(drift) {
  const lines = [];
  lines.push(`Lovet/brand uden roadmap-punkt eller kendt fejl (${drift.missing.length}):`);
  lines.push(...(drift.missing.length ? drift.missing.map((n) => `  \`#${n}\``) : ["  ingen"]));
  lines.push(`Punkter/fejl med færdigt issue men åben status (${drift.stale.length}):`);
  lines.push(
    ...(drift.stale.length
      ? drift.stale.map((s) => `  \`#${s.issue}\`  ${s.table} ${String(s.id).slice(0, 8)}  ${s.status}  ${s.title}`)
      : ["  ingen"]),
  );
  return lines.join("\n");
}

/** Lukket eller claude:done = faerdigt. Ukendt/fejl = ikke faerdigt (konservativt). */
function isIssueDone(n) {
  try {
    const raw = execFileSync(
      "gh",
      ["issue", "view", String(n), "--json", "state,labels"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const j = JSON.parse(raw);
    return j.state === "CLOSED" || (j.labels || []).some((l) => l.name === "claude:done");
  } catch {
    console.error(`advarsel: kunne ikke læse issue ${n} via gh, behandles som ikke færdigt`);
    return false;
  }
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_KEY er ikke sat i miljøet (kør via infisical run).");
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const markdown = readFileSync(resolve(here, "..", "docs", "MASTERPLAN.md"), "utf8");

  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const [itemsRes, issuesRes] = await Promise.all([
    db.from("roadmap_items").select("id, issue_ref, status, title_en").not("issue_ref", "is", null),
    db.from("known_issues").select("id, issue_ref, status, title_en").not("issue_ref", "is", null),
  ]);
  if (itemsRes.error) throw new Error(`roadmap_items: ${itemsRes.error.message}`);
  if (issuesRes.error) throw new Error(`known_issues: ${issuesRes.error.message}`);

  const refs = new Set([...itemsRes.data, ...issuesRes.data].map((r) => r.issue_ref));
  const doneIssues = new Set([...refs].filter(isIssueDone));
  const drift = findDrift({
    planIssues: planIssueNumbers(markdown),
    items: itemsRes.data,
    issues: issuesRes.data,
    doneIssues,
  });
  console.log(formatDrift(drift));
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`roadmap-drift fejlede: ${err.message}`);
    process.exit(1);
  });
}
