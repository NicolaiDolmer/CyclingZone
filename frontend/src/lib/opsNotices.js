// #3941 — Race Control ops-notices: rene helpers til driftsbanneret + "Kendte
// problemer"-listen paa Hjaelp-siden.
//
// fetchActiveOpsNotices/fetchRecentOpsNotices importerer ../lib/supabase.ts
// DYNAMISK (await import) i stedet for statisk i toppen af filen: et statisk
// `import { supabase } from "./supabase"` er extensionless og kan ikke
// resolves af Node's ESM-loader uden en TS-loader (samme begraensning som
// lib/logEvent.js — se dens .test.js-kommentar). Et statisk top-level import
// ville gjort HELE denne fil, inkl. de rene helpers nedenfor, utestbar via
// node --test. Dynamisk import resolves foerst naar funktionen rent faktisk
// kaldes, saa opsNotices.test.js kan importere pickNoticeCopy/SEVERITY_META/
// dismiss-helpers direkte uden at trigger ERR_MODULE_NOT_FOUND.
export const OPS_NOTICE_COLUMNS =
  "id, severity, title_en, title_da, body_en, body_da, active, starts_at, ends_at, created_at";

// Banneret: kun notices der er active=true, allerede startet, og enten uden
// slut-tidspunkt eller endnu ikke udloebet. PostgREST kan ikke udtrykke
// "ends_at IS NULL OR ends_at > now" som to separate .eq/.gt-kald, saa det er
// ét .or()-filter.
export async function fetchActiveOpsNotices() {
  const { supabase } = await import("./supabase");
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("ops_notices")
    .select(OPS_NOTICE_COLUMNS)
    .eq("active", true)
    .lte("starts_at", nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order("starts_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Hjaelp-siden: aktive + seneste 14 dages notices — samme datakilde, bredere
// vindue, saa en notice forbliver synlig som historik lidt efter den er
// slukket/udloebet.
const RECENT_WINDOW_DAYS = 14;

export async function fetchRecentOpsNotices() {
  const { supabase } = await import("./supabase");
  const cutoffIso = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("ops_notices")
    .select(OPS_NOTICE_COLUMNS)
    .or(`active.eq.true,created_at.gte.${cutoffIso}`)
    .order("starts_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Severity -> status-surface. `classes` er FULDE, statiske Tailwind-strenge
// (aldrig sammensat med template-literals i komponenten — JIT-purge fjerner
// dynamisk byggede klassenavne, se docs/design/PAGE_TEMPLATES.md "one status
// surface"). `badgeState` genbruger eksisterende StatusBadge-toner
// (STATUS_TONE.closing = warning, STATUS_TONE.raceLive = danger) i stedet for
// at tilfoeje nye toner til badgeStyles.js for tre severity-vaerdier.
export const SEVERITY_META = {
  info: {
    tone: "info",
    badgeState: "info",
    classes: "bg-cz-info-bg border-cz-info/30 text-cz-info",
  },
  warning: {
    tone: "warning",
    badgeState: "closing",
    classes: "bg-cz-warning-bg border-cz-warning/30 text-cz-warning",
  },
  incident: {
    tone: "danger",
    badgeState: "raceLive",
    classes: "bg-cz-danger-bg border-cz-danger/30 text-cz-danger",
  },
};

// Vaelger EN/DA-copy efter spillerens sprog, med fallback til den anden hvis
// den valgte er tom (redaktionel garde — begge felter er NOT NULL i DB, men
// en tom streng skal ikke give et blankt banner).
export function pickNoticeCopy(notice, lang) {
  const da = (lang || "").startsWith("da");
  const primaryTitle = da ? notice?.title_da : notice?.title_en;
  const primaryBody = da ? notice?.body_da : notice?.body_en;
  return {
    title: primaryTitle || notice?.title_en || notice?.title_da || "",
    body: primaryBody || notice?.body_en || notice?.body_da || "",
  };
}

// Dismiss pr. notice-id (localStorage), samme try/catch-form som
// lib/seasonStartGuide.js — private mode/storage-afvisning fejler stille i
// stedet for at vaelte banneret. Severity 'incident' bruger disse helpers
// aldrig (kaldersiden viser ingen dismiss-knap for incident).
const DISMISS_KEY_PREFIX = "cz_ops_notice_dismissed_";

export function opsNoticeDismissKey(noticeId) {
  return `${DISMISS_KEY_PREFIX}${noticeId}`;
}

export function readOpsNoticeDismissed(noticeId) {
  if (!noticeId) return false;
  try {
    return globalThis.localStorage?.getItem(opsNoticeDismissKey(noticeId)) === "1";
  } catch {
    return false;
  }
}

export function writeOpsNoticeDismissed(noticeId) {
  if (!noticeId) return;
  try {
    globalThis.localStorage?.setItem(opsNoticeDismissKey(noticeId), "1");
  } catch {
    /* ignore */
  }
}
