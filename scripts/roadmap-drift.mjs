#!/usr/bin/env node
// scripts/roadmap-drift.mjs
// ============================================================
// Drift-tjek mellem docs/MASTERPLAN.md og roadmap-hubben (#6152, spor 4,
// task 4.3; spec §7 "Samspil med masterplanen").
//
// READ-ONLY: skriver aldrig noget (hverken Supabase, GitHub eller filer).
// Viser tre lister:
//   missing - issues i MASTERPLANs Brand og "Lovet til spillerne", som hverken
//             har et roadmap-punkt eller en kendt fejl.
//   stale   - punkter/fejl hvis issue er lukket eller claude:done, men som
//             stadig staar som planlagt, i gang eller aaben.
//   Beta-drift - roadmap-punkter, hvis status ikke passer med deres kontakt i
//             app_config (triggeren springer laaste raekker over, bevidst).
// Exit 0 ogsaa ved fund: det er en rapport, ikke en gate.
// Skriver kun med --resync: kalder rpc roadmap_resync_flags() (admin/service_role).
//
// Brug:  infisical run -- node scripts/roadmap-drift.mjs [--resync]
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

/** Kontaktens vaerdi som stadie: "off" | "beta" | "on" (booleans: true=on, false=off). */
function flagStage(v) {
  if (v === true || v === "true" || v === "on") return "on";
  if (v === false || v === "false" || v === "off") return "off";
  return v === "beta" ? "beta" : null;
}

/**
 * Beta-drift: samme regler som triggeren/roadmap_resync_flags() i migrationen.
 * beta -> in_progress med beta_since; on -> shipped; off -> ingen beta_since paa
 * et in_progress-punkt. shipped/archived og punkter uden flag_key roeres aldrig.
 */
export function findFlagDrift({ items, flags }) {
  const out = [];
  for (const i of items) {
    if (!i.flag_key || ITEM_DONE.includes(i.status)) continue;
    const base = { id: i.id, title: i.title_en, status: i.status, flag_key: i.flag_key };
    if (!Object.prototype.hasOwnProperty.call(flags, i.flag_key)) {
      out.push({ ...base, flag: null, reason: "kontakt findes ikke" });
      continue;
    }
    const stage = flagStage(flags[i.flag_key]);
    if (stage === "beta" && (i.status !== "in_progress" || !i.beta_since)) {
      out.push({ ...base, flag: stage, reason: "kontakt er beta, punktet er ikke i gang med beta_since" });
    } else if (stage === "on") {
      out.push({ ...base, flag: stage, reason: "kontakt er on, punktet er ikke shipped" });
    } else if (stage === "off" && i.status === "in_progress" && i.beta_since) {
      out.push({ ...base, flag: stage, reason: "kontakt er off, punktet har stadig beta_since" });
    }
  }
  return out;
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
  const flagDrift = drift.flagDrift || [];
  lines.push(`Beta-drift (${flagDrift.length}), punkt ude af takt med kontakt:`);
  lines.push(
    ...(flagDrift.length
      ? [
          ...flagDrift.map((f) => `  roadmap_items ${String(f.id).slice(0, 8)}  ${f.status}  ${f.title}  (${f.reason})`),
          "  Ret med: infisical run -- node scripts/roadmap-drift.mjs --resync",
        ]
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
  const resync = process.argv.includes("--resync");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_KEY er ikke sat i miljøet (kør via infisical run).");
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const markdown = readFileSync(resolve(here, "..", "docs", "MASTERPLAN.md"), "utf8");

  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const [itemsRes, issuesRes, flagItemsRes, configRes] = await Promise.all([
    db.from("roadmap_items").select("id, issue_ref, status, title_en").not("issue_ref", "is", null),
    db.from("known_issues").select("id, issue_ref, status, title_en").not("issue_ref", "is", null),
    db.from("roadmap_items").select("id, title_en, status, flag_key, beta_since").not("flag_key", "is", null),
    db.from("app_config").select("key, value"),
  ]);
  if (flagItemsRes.error) throw new Error(`roadmap_items (flag_key): ${flagItemsRes.error.message}`);
  if (configRes.error) throw new Error(`app_config: ${configRes.error.message}`);
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
  const flags = Object.fromEntries(configRes.data.map((r) => [r.key, r.value]));
  drift.flagDrift = findFlagDrift({ items: flagItemsRes.data, flags });
  console.log(formatDrift(drift));

  if (resync) {
    const { data, error } = await db.rpc("roadmap_resync_flags");
    if (error) {
      const missing = error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message || "");
      throw new Error(
        missing
          ? "roadmap_resync_flags findes ikke endnu (migrationen er sandsynligvis ikke applied)."
          : `roadmap_resync_flags: ${error.message}`,
      );
    }
    console.log(`Resync: ${data} række(r) rettet.`);
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`roadmap-drift fejlede: ${err.message}`);
    process.exit(1);
  });
}
