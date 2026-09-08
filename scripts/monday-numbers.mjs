#!/usr/bin/env node
// Mandagstal, de faste vaekst-tal der aflaeses hver mandag morgen (#5048).
//
// SSOT for hvad tallene betyder: docs/GROWTH_STACK.md §1. Dette script er kun
// maalingen; definitionerne staar i dokumentet. Scriptet er READ-ONLY: kun
// SELECT + read-only RPC'er, ingen skrivninger, ingen mutationer.
//
// BRUG:
//   infisical run --env=prod -- node scripts/monday-numbers.mjs
//   infisical run --env=prod -- node scripts/monday-numbers.mjs --json
//
// ENV (fra Infisical, aldrig fra disk):
//   SUPABASE_URL          (paakraevet), prod-projektets URL
//   SUPABASE_SERVICE_KEY  (paakraevet), service-role-noegle. signup_attribution,
//                         player_events og RPC'erne er service_role-only.
//   ALUNTA_API_TOKEN      (valgfri)  , bruges KUN til at krydstjekke antallet af
//                         aktive abonnementer mod Alunta. MRR findes ikke i
//                         REST-API'et; hent den via Alunta MCP get_business_overview.
//
// EXIT-CODES:
//   0 = tal hentet
//   1 = manglende env / ugyldige args
//   2 = fejl mod Supabase (auth, netvaerk, RPC)

import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const TZ = "Europe/Copenhagen";
const PAGE = 1000;
const MAX_PAGES = 300; // 300k raekker; rammes loftet, siger scriptet det hoejt.

// Kanal-gruppen "AI assistant" (#4322). Holdes i sync med GROWTH_STACK.md §2.
const AI_ASSISTANT_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "perplexity.ai",
  "claude.ai",
  "copilot.microsoft.com",
  "gemini.google.com",
  "bard.google.com",
];
// Gmail-appen sender android-app://com.google.android.gm/ som referrer. Det er
// klik i VORES egne mails, ikke en tredjepartskanal (#3796-kommentar 27/8).
const OWN_EMAIL_HOSTS = ["com.google.android.gm", "mail.google.com", "outlook.live.com", "outlook.office.com"];
const REDDIT_HOSTS = ["reddit.com", "com.reddit.frontpage", "redd.it"];
const SEARCH_HOSTS = ["google.", "bing.com", "duckduckgo.com", "ecosia.org", "yahoo.com", "search.brave.com"];

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    args[key] = rest.length ? rest.join("=") : true;
  }
  return args;
}

// Dato-dele i Europe/Copenhagen, al tid i projektet er dansk lokaltid.
function cphParts(date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return parts;
}

function cphDateString(date) {
  const p = cphParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function cphStamp(date) {
  const p = cphParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// Mandagen i den uge datoen ligger i (dansk kalender-uge).
function mondayOf(date) {
  const ymd = cphDateString(date);
  const utcNoon = new Date(`${ymd}T12:00:00Z`);
  const dow = (utcNoon.getUTCDay() + 6) % 7; // 0 = mandag
  utcNoon.setUTCDate(utcNoon.getUTCDate() - dow);
  return utcNoon.toISOString().slice(0, 10);
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function pct(part, whole) {
  if (!whole) return "—";
  return `${((part / whole) * 100).toFixed(1).replace(".", ",")} %`;
}

// Henter alle raekker via range-paging. Returnerer {rows, capped}.
async function fetchAll(build, label) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE;
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { rows, capped: false };
  }
  return { rows, capped: true };
}

function hostOf(referrer) {
  if (!referrer) return null;
  const raw = String(referrer).trim();
  if (!raw) return null;
  if (raw.startsWith("android-app://")) return raw.slice("android-app://".length).replace(/\/+$/, "").toLowerCase();
  let host;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    host = raw.replace(/^https?:\/\//, "").split("/")[0].toLowerCase() || null;
  }
  // www.foo.com og foo.com er samme kanal, ellers splittes en kanal i to raekker.
  return host ? host.replace(/^www\d*\./, "") : null;
}

// Kanal-gruppering. Rangorden: eksplicit utm_source foerst (det er VORES egen
// maerkning), derefter referrer-vaertsnavn. Definitionerne staar i GROWTH_STACK §2.
export function classifyChannel(row) {
  const source = (row.utm_source || "").trim().toLowerCase();
  const host = hostOf(row.referrer);
  const probe = source || host || "";
  if (!probe) return "(direct / ukendt)";
  if (AI_ASSISTANT_HOSTS.some((h) => probe.includes(h))) return "AI assistant";
  if (OWN_EMAIL_HOSTS.some((h) => probe.includes(h)) || source === "email") return "email (vores egne mails)";
  if (REDDIT_HOSTS.some((h) => probe.includes(h)) || source === "reddit") return "reddit";
  if (probe.includes("hattrick.org") || source === "hattrick") return "hattrick";
  if (probe.includes("discord")) return "discord";
  if (SEARCH_HOSTS.some((h) => probe.includes(h))) return "soegning (organisk)";
  if (probe.includes("cyclingzone.org") || probe.includes("cycling-zone.vercel.app")) return "self-referral";
  return probe;
}

async function main() {
  const args = parseArgs(process.argv);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    console.error("❌ SUPABASE_URL og/eller SUPABASE_SERVICE_KEY mangler.");
    console.error("   Koer via Infisical: infisical run --env=prod -- node scripts/monday-numbers.mjs");
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date();
  const notes = [];
  const out = { measured_at: now.toISOString(), measured_at_cph: cphStamp(now) };

  // --- Univers: menneskehold (samme diskriminator som dormantTeamsReport/betaReset).
  const { rows: teams } = await fetchAll(
    () =>
      db
        .from("teams")
        .select("id,user_id")
        .eq("is_ai", false)
        .eq("is_bank", false)
        .eq("is_test_account", false)
        .order("id", { ascending: true }),
    "teams",
  );
  const humanUserIds = new Set(teams.map((t) => t.user_id).filter(Boolean));
  const teamToUser = new Map(teams.map((t) => [t.id, t.user_id]));
  out.human_teams = teams.length;

  // --- Brugere (last_seen, sprog, samtykke, email_prefs).
  const { rows: users } = await fetchAll(
    () => db.from("users").select("id,created_at,last_seen,language,consent_preferences,email_prefs").order("id", { ascending: true }),
    "users",
  );
  out.users_total = users.length;

  // --- 1. Aktive 1d/7d/30d (consent-uafhaengig union, GROWTH_STACK §1 / ANALYTICS_STACK).
  const windows = { "1d": daysAgo(1), "7d": daysAgo(7), "30d": daysAgo(30) };
  const activity = new Map(); // user_id -> seneste aktivitet (ms)
  const bump = (userId, iso) => {
    if (!userId || !humanUserIds.has(userId) || !iso) return;
    const ts = new Date(iso).getTime();
    if (!Number.isFinite(ts)) return;
    if (!activity.has(userId) || activity.get(userId) < ts) activity.set(userId, ts);
  };
  for (const u of users) bump(u.id, u.last_seen);

  const since30 = windows["30d"];
  const events = await fetchAll(
    () => db.from("player_events").select("user_id,created_at").gte("created_at", since30).order("id", { ascending: true }),
    "player_events",
  );
  if (events.capped) notes.push(`player_events ramte raekke-loftet (${MAX_PAGES * PAGE}), aktivitetstallene kan undertaelle.`);
  for (const e of events.rows) bump(e.user_id, e.created_at);

  const bids = await fetchAll(
    () => db.from("auction_bids").select("team_id,bid_time").gte("bid_time", since30).order("id", { ascending: true }),
    "auction_bids",
  );
  if (bids.capped) notes.push(`auction_bids ramte raekke-loftet (${MAX_PAGES * PAGE}), aktivitetstallene kan undertaelle.`);
  for (const b of bids.rows) bump(teamToUser.get(b.team_id), b.bid_time);

  notes.push(
    "Aktivitet = users.last_seen ∪ player_events ∪ auction_bids. Manuelle race_entries, xp_log og forum-skrivning er IKKE med endnu (GROWTH_STACK §10), tallet kan derfor undertaelle en smule.",
  );

  out.active = {};
  for (const [label, sinceIso] of Object.entries(windows)) {
    const cut = new Date(sinceIso).getTime();
    out.active[label] = [...activity.values()].filter((ts) => ts >= cut).length;
  }

  // --- 2. Signups pr. uge, sidste 4 fulde + indevaerende.
  const weekBuckets = new Map();
  for (const u of users) {
    if (!u.created_at) continue;
    const monday = mondayOf(new Date(u.created_at));
    weekBuckets.set(monday, (weekBuckets.get(monday) ?? 0) + 1);
  }
  const weeksSorted = [...weekBuckets.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 5);
  out.signups_per_week = weeksSorted.map(([monday, count]) => ({ week_monday: monday, signups: count }));
  const cut7 = new Date(windows["7d"]).getTime();
  const cut30 = new Date(windows["30d"]).getTime();
  out.signups_7d = users.filter((u) => u.created_at && new Date(u.created_at).getTime() >= cut7).length;
  out.signups_30d = users.filter((u) => u.created_at && new Date(u.created_at).getTime() >= cut30).length;

  // --- 3. Mandagstal 1: aktive abonnementer (+ MRR via Alunta).
  const { count: activeSubs, error: subErr } = await db
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .in("status", ["active", "past_due"])
    .not("alunta_subscription_id", "is", null);
  if (subErr) throw new Error(`subscriptions: ${subErr.message}`);
  out.active_subscriptions_sql = activeSubs ?? 0;

  out.alunta_active_subscriptions = null;
  if (process.env.ALUNTA_API_TOKEN) {
    try {
      const { createAluntaClient } = await import("../backend/lib/alunta.js");
      const client = createAluntaClient();
      const res = await client.listSubscriptions({ perPage: 100 });
      const list = res?.data ?? res ?? [];
      out.alunta_active_subscriptions = Array.isArray(list)
        ? list.filter((s) => ["active", "past_due"].includes(String(s?.status || "").toLowerCase())).length
        : null;
    } catch (err) {
      notes.push(`Alunta-krydstjek fejlede: ${String(err?.message || err).slice(0, 160)}`);
    }
  } else {
    notes.push("ALUNTA_API_TOKEN ikke sat, abonnements-tallet er kun fra vores egen tabel.");
  }
  notes.push("MRR findes ikke i Aluntas REST-API. Hent den via Alunta MCP get_business_overview (ekskl. moms) og skriv den i Log-linjen.");

  // --- 4. Mandagstal 2: D7 for seneste fulde kohorte.
  out.cohort_d7 = null;
  const { data: cohortPayload, error: cohortErr } = await db.rpc("get_cohort_retention", { p_weeks: 6 });
  // RPC'en svarer {cohorts:[...], generated_at}, ikke et bart array (maalt 8/9).
  const cohorts = Array.isArray(cohortPayload) ? cohortPayload : (cohortPayload?.cohorts ?? null);
  if (cohortErr) {
    notes.push(`get_cohort_retention fejlede: ${cohortErr.message}`);
  } else if (Array.isArray(cohorts)) {
    const eligible = cohorts
      .filter((c) => Number(c.d7_eligible ?? 0) >= 5)
      .sort((a, b) => (String(a.cohort_week) < String(b.cohort_week) ? 1 : -1));
    out.cohort_d7 = eligible[0]
      ? {
          cohort_week: String(eligible[0].cohort_week).slice(0, 10),
          cohort_size: eligible[0].cohort_size ?? null,
          d7_eligible: eligible[0].d7_eligible ?? null,
          d7_pct: eligible[0].d7_pct ?? null,
        }
      : null;
    if (!eligible.length) notes.push("Ingen kohorte med d7_eligible >= 5 i de seneste 6 uger, D7 baerer ikke i denne uge.");
    out.cohort_all = cohorts.map((c) => ({
      cohort_week: String(c.cohort_week).slice(0, 10),
      cohort_size: c.cohort_size ?? null,
      d7_eligible: c.d7_eligible ?? null,
      d7_pct: c.d7_pct ?? null,
    }));
  }

  // --- 5. Mandagstal 3: checkout gennemfoert / startet, rullende 7 dage.
  const { count: started, error: startErr } = await db
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .gte("terms_accepted_at", windows["7d"]);
  if (startErr) throw new Error(`subscriptions(startede): ${startErr.message}`);
  const { count: completed, error: compErr } = await db
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .gte("last_event_at", windows["7d"])
    .like("last_event_id", "checkout.completed%");
  if (compErr) throw new Error(`subscriptions(gennemfoerte): ${compErr.message}`);
  out.checkout_7d = { started: started ?? 0, completed: completed ?? 0 };

  // --- 6. Kanal-tabel fra signup_attribution.
  const { rows: attribution } = await fetchAll(
    () => db.from("signup_attribution").select("user_id,utm_source,utm_medium,utm_campaign,referrer,signed_up_at").order("user_id", { ascending: true }),
    "signup_attribution",
  );
  const channelTotal = new Map();
  const channel30 = new Map();
  for (const row of attribution) {
    const channel = classifyChannel(row);
    channelTotal.set(channel, (channelTotal.get(channel) ?? 0) + 1);
    if (row.signed_up_at && new Date(row.signed_up_at).getTime() >= cut30) {
      channel30.set(channel, (channel30.get(channel) ?? 0) + 1);
    }
  }
  out.attribution_rows = attribution.length;
  out.channels = [...channelTotal.entries()]
    .map(([channel, total]) => ({ channel, last_30d: channel30.get(channel) ?? 0, total }))
    .sort((a, b) => b.total - a.total || a.channel.localeCompare(b.channel));
  out.attribution_coverage_30d = out.signups_30d ? (channel30.size ? [...channel30.values()].reduce((a, b) => a + b, 0) : 0) : 0;

  // --- 7. Sovende med marketing-mail-samtykke (win-back-segmentet, GROWTH_STACK §8).
  const cutDormant = new Date(daysAgo(30)).getTime();
  const dormantConsent = users.filter((u) => {
    if (!humanUserIds.has(u.id)) return false;
    const seen = u.last_seen ? new Date(u.last_seen).getTime() : null;
    if (seen !== null && seen >= cutDormant) return false;
    if (u.consent_preferences?.email_marketing !== true) return false;
    const prefs = u.email_prefs ?? {};
    if (prefs.all === false || prefs.winback === false) return false;
    return true;
  });
  const consentTotal = users.filter((u) => humanUserIds.has(u.id) && u.consent_preferences?.email_marketing === true).length;
  out.dormant_with_email_consent = dormantConsent.length;
  out.email_marketing_consent_total = consentTotal;

  out.notes = notes;

  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const lines = [];
  lines.push(`## Mandagstal ${cphDateString(now)} (maalt ${cphStamp(now)} CPH)`);
  lines.push("");
  lines.push("| Mandagstal | Vaerdi |");
  lines.push("|---|---|");
  lines.push(
    `| 1. MRR ekskl. moms / aktive abonnementer | MRR: hent via Alunta MCP get_business_overview · abonnementer: ${out.active_subscriptions_sql} (SQL)${
      out.alunta_active_subscriptions !== null ? ` · ${out.alunta_active_subscriptions} (Alunta REST)` : ""
    } |`,
  );
  lines.push(
    `| 2. D7, seneste fulde kohorte | ${
      out.cohort_d7
        ? `${out.cohort_d7.d7_pct ?? "—"} % (uge ${out.cohort_d7.cohort_week}, ${out.cohort_d7.d7_eligible} berettigede)`
        : "baerer ikke (ingen kohorte med >= 5 berettigede)"
    } |`,
  );
  lines.push(
    `| 3. Checkout gennemfoert / startet, 7 d | ${out.checkout_7d.completed} / ${out.checkout_7d.started} (${pct(
      out.checkout_7d.completed,
      out.checkout_7d.started,
    )}) |`,
  );
  lines.push("");
  lines.push(
    `**Nordstjerne, aktive/7d: ${out.active["7d"]}** (1d: ${out.active["1d"]} · 30d: ${out.active["30d"]} · menneskehold: ${out.human_teams} · brugere: ${out.users_total})`,
  );
  lines.push("");
  lines.push(`Signups: ${out.signups_7d} sidste 7 d · ${out.signups_30d} sidste 30 d`);
  lines.push("");
  lines.push("| Uge (mandag) | Signups |");
  lines.push("|---|---:|");
  for (const w of out.signups_per_week) lines.push(`| ${w.week_monday} | ${w.signups} |`);
  lines.push("");
  lines.push(`| Kanal | Sidste 30 d | I alt (${out.attribution_rows} raekker) |`);
  lines.push("|---|---:|---:|");
  for (const c of out.channels) lines.push(`| ${c.channel} | ${c.last_30d} | ${c.total} |`);
  lines.push("");
  lines.push(
    `Sovende (>30 d) med \`email_marketing = true\`: **${out.dormant_with_email_consent}** af ${out.email_marketing_consent_total} med samtykke.`,
  );
  if (out.cohort_all?.length) {
    lines.push("");
    lines.push("| Kohorte-uge | Signups | D7-berettigede | D7 |");
    lines.push("|---|---:|---:|---:|");
    for (const c of out.cohort_all) lines.push(`| ${c.cohort_week} | ${c.cohort_size ?? "—"} | ${c.d7_eligible ?? "—"} | ${c.d7_pct ?? "—"} |`);
  }
  lines.push("");
  lines.push("Forbehold:");
  for (const n of notes) lines.push(`- ${n}`);

  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error("💥 monday-numbers fejlede:", err?.message || err);
  process.exit(2);
});
