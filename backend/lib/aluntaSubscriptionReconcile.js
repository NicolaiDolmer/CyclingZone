// #2736 — daglig subscription-reconcile mod Alunta-API'et.
//
// BAGGRUND: aluntaWebhook.js's ACTIVATING-set lytter på 'invoice.paid', men det
// event FINDES IKKE i Aluntas event-katalog (kun invoice.created, subscription.
// created/started/cancelled/resumed/ended/payment_failed/tier_changed, checkout.
// completed, customer.*). Konsekvens: current_period_end opdateres muligvis
// ALDRIG ved fornyelse -> computeIsPro() falder til false selvom kunden betaler.
//
// VERIFICERET LIVE 2026-08-03 (read-only SELECT mod prod): den eneste
// subscriptions-række i produktion har status='active', is_founder=true, MEN
// current_period_end=NULL og alunta_customer_id/alunta_subscription_id begge
// NULL. last_event_id='checkout.completed:<timestamp>' (fallback-formatet i
// aluntaWebhook.js — betyder checkout.completed-payloaden ikke indeholdt et
// data.uuid, og enten aldrig indeholdt current_period_end/subscription_uuid,
// eller et senere subscription.created-event med de felter aldrig fyrede).
// computeIsPro() kræver current_period_end != null OG i fremtiden — denne
// kunde er derfor allerede (ikke kun ved fornyelse ~24/8) uden synlig Pro-
// status i entitlement-laget. Ingen backend-feature er pt. hård-gatet bag
// isPro (kun UI: ProBadge/ProfilePage/ProUpgradePage), så impact er kosmetisk
// indtil videre — men datamodellen SKAL rettes uafhængigt af 24/8.
//
// DESIGN (fra issuet, Refs #1903): daglig cron henter Aluntas fulde
// abonnements-liste (GET /subscriptions, sidevist) og synker status +
// current_period_end + plan_interval + alunta_customer_id/alunta_subscription_id
// ind i public.subscriptions, matchet på external_customer_id === team_id
// (samme nøgle som ensureCustomer/checkout bruger, jf. billingCheckout.js).
// is_founder RØRES ALDRIG — udelades fra hver upsert-row, præcis samme regel
// som aluntaWebhook.js (server-afledt, permanent, aldrig fra provider-payload).
//
// ⚠️ UVERIFICERET KONTRAKT: Aluntas faktiske GET /subscriptions-svarform er IKKE
// bekræftet i denne session — ingen levende test_mode-adgang, og docs-siden
// (app.alunta.com/docs/v1) er en JS-SPA uden statisk indhold WebFetch kan læse.
// extractSubscriptionFields er derfor bevidst FORSVARSMÆSSIGT (flere kandidat-
// nøgler pr. felt, samme mønster som alunta.js' checkout_url-fallback).
// Kør `node scripts/reconcileAluntaSubscriptions.js` (UDEN --apply) FØRST og
// læs RAW-output — ret feltnavnene her hvis de ikke matcher det ægte svar,
// FØR app_config-flaget flippes til on (se PR-beskrivelsen for aktiverings-
// tjekliste).
//
// Idempotent: identiske værdier springes over (ingen no-op-write); gentagne
// kørsler mod uændret Alunta-tilstand producerer 0 updates. Netværks-/API-fejl
// under selve hentningen kastes højt (efter ét retry), så cron.js' trackedTick
// + monitorCron centralt logger + Sentry-alarmerer + markerer cron-monitoren
// som fejlet — præcis samme mønster som de øvrige daglige sweeps.
//
// Scope-afgrænsning (bevidst, se PR-beskrivelse "Åbne spørgsmål"): reconcilen
// OPDATERER kun rækker der allerede findes i public.subscriptions. Den
// OPRETTER ingen ny række for en Alunta-kunde uden lokal modpart (ville kræve
// FK-gyldig team_id-gæt + er ikke nødvendig lige nu: checkout er paused,
// CHECKOUT_PAUSED=true i billingCheckout.js, så ingen nye kunder kan opstå).

import { captureException as defaultCaptureException } from "./sentry.js";

const ACTIVE_ALIASES = new Set(["active", "started", "resumed", "trialing"]);
const CANCELLED_ALIASES = new Set(["cancelled", "canceled"]);
const PAST_DUE_ALIASES = new Set(["past_due", "payment_failed", "unpaid"]);
const INACTIVE_ALIASES = new Set(["ended", "expired", "inactive", "paused"]);

// PUR: Aluntas rå status-streng -> vores interne status-enum. Ukendte værdier
// returnerer null (raekken røres IKKE — bedre at flagge end at gætte forkert
// på et betalings-kritisk felt).
export function mapAluntaStatus(rawStatus) {
  const s = String(rawStatus ?? "").toLowerCase().trim();
  if (ACTIVE_ALIASES.has(s)) return "active";
  if (CANCELLED_ALIASES.has(s)) return "cancelled";
  if (PAST_DUE_ALIASES.has(s)) return "past_due";
  if (INACTIVE_ALIASES.has(s)) return "inactive";
  return null;
}

// PUR: forsvarsmæssigt feltudtræk fra ét Alunta-abonnements-objekt. Se
// "UVERIFICERET KONTRAKT" ovenfor.
export function extractSubscriptionFields(entry) {
  if (!entry || typeof entry !== "object") return null;
  const customer = entry.customer || {};
  const plan = entry.plan || {};
  const externalCustomerId =
    entry.external_customer_id ?? customer.external_customer_id ?? entry.customer_external_id ?? null;
  const customerUuid = entry.customer_uuid ?? customer.uuid ?? entry.customer_id ?? null;
  const subscriptionUuid = entry.uuid ?? entry.subscription_uuid ?? entry.id ?? null;
  const rawStatus = entry.status ?? null;
  const planInterval = entry.plan_interval ?? entry.interval ?? plan.interval ?? null;
  const currentPeriodEnd =
    entry.current_period_end ??
    entry.currentPeriodEnd ??
    entry.period_end ??
    entry.renews_at ??
    entry.ends_at ??
    null;
  return { externalCustomerId, customerUuid, subscriptionUuid, rawStatus, planInterval, currentPeriodEnd };
}

const MAX_PAGES = 50; // safety-cap — 100/side * 50 = 5.000 abonnementer

// Sidevist hent af HELE Aluntas abonnements-liste. Stopper når en side
// returnerer færre end perPage rækker, eller ved maxPages (undgår uendelig
// loop hvis Aluntas pagineringsmeta ikke matcher vores antagelse).
export async function fetchAllAluntaSubscriptions(client, { perPage = 100, maxPages = MAX_PAGES } = {}) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const raw = await client.listSubscriptions({ page, perPage });
    const items = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
    all.push(...items);
    if (items.length < perPage) break;
  }
  return all;
}

// PUR: beregn hvilke lokale rækker der skal opdateres, ud fra Aluntas rå liste.
// localRows: [{ team_id, status, plan_interval, current_period_end,
//               alunta_customer_id, alunta_subscription_id }]
// remoteEntries: rå Alunta-objekter (endnu ikke feltudtrukket).
export function computeReconcileActions({ localRows = [], remoteEntries = [] } = {}) {
  const byTeamId = new Map();
  const unmatchedRemote = [];
  const skippedUnknownStatus = [];

  for (const raw of remoteEntries) {
    const fields = extractSubscriptionFields(raw);
    if (!fields?.externalCustomerId) {
      unmatchedRemote.push(raw);
      continue;
    }
    const mappedStatus = mapAluntaStatus(fields.rawStatus);
    if (!mappedStatus) {
      skippedUnknownStatus.push({ externalCustomerId: fields.externalCustomerId, rawStatus: fields.rawStatus });
      continue;
    }
    byTeamId.set(String(fields.externalCustomerId), { ...fields, mappedStatus });
  }

  const updates = [];
  const unchanged = [];
  const missingRemote = [];

  for (const row of localRows) {
    const match = byTeamId.get(String(row.team_id));
    if (!match) {
      // Kun interessant hvis raekken allerede har en Alunta-identitet ELLER er
      // Pro-relevant (active/past_due/cancelled) — en helt urørt/inaktiv
      // række der aldrig har talt med Alunta er ikke en afvigelse.
      if (
        row.alunta_customer_id ||
        row.alunta_subscription_id ||
        ["active", "past_due", "cancelled"].includes(row.status)
      ) {
        missingRemote.push({ teamId: row.team_id, localStatus: row.status });
      }
      continue;
    }

    const nextRow = {
      team_id: row.team_id,
      status: match.mappedStatus,
      plan_interval: match.planInterval ?? row.plan_interval ?? null,
      alunta_customer_id: match.customerUuid ?? row.alunta_customer_id ?? null,
      alunta_subscription_id: match.subscriptionUuid ?? row.alunta_subscription_id ?? null,
      current_period_end: match.currentPeriodEnd ?? null,
    };

    const isSame =
      nextRow.status === row.status &&
      nextRow.plan_interval === (row.plan_interval ?? null) &&
      nextRow.alunta_customer_id === (row.alunta_customer_id ?? null) &&
      nextRow.alunta_subscription_id === (row.alunta_subscription_id ?? null) &&
      String(nextRow.current_period_end ?? "") === String(row.current_period_end ?? "");

    if (isSame) unchanged.push(row.team_id);
    else updates.push(nextRow);
  }

  return { updates, unchanged, missingRemote, unmatchedRemote, skippedUnknownStatus };
}

async function fetchLocalSubscriptionRows(supabase) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("team_id, status, plan_interval, current_period_end, alunta_customer_id, alunta_subscription_id, is_founder");
  if (error) throw new Error(`subscriptions-opslag fejlede: ${error.message}`);
  return data ?? [];
}

async function fetchWithRetry(fn, { attempts = 2, delayMs = 1000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      // swallow-ok: genkastes efter sidste forsøg ('throw lastErr' nedenfor) —
      // dette er kun mellem-forsøgs-pausen, ikke den endelige fejlhåndtering.
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/**
 * Daglig reconcile: henter Aluntas fulde abonnements-liste, matcher på
 * external_customer_id === team_id, og upserter status/current_period_end/
 * plan_interval/alunta_customer_id/alunta_subscription_id ind i public.
 * subscriptions. is_founder røres ALDRIG.
 *
 * @param {object}   args
 * @param {object}   args.supabase            service-role Supabase-klient
 * @param {object}   args.client               Alunta-klient (createAluntaClient())
 * @param {(err:Error, ctx:object)=>void} [args.captureExceptionFn]
 * @param {boolean}  [args.dryRun]             beregn + returnér forslag, men skriv INTET
 * @param {Date}     [args.now]                DI-hook (reserveret, ingen tidsvindue-logik pt.)
 * @param {number}   [args.retryAttempts]      forsøg på Alunta-hentningen (default 2)
 * @param {number}   [args.retryDelayMs]       pause mellem forsøg i ms (default 1000; sæt 0 i tests)
 * @returns {Promise<object>} summary
 */
export async function runAluntaSubscriptionReconcile({
  supabase,
  client,
  captureExceptionFn = defaultCaptureException,
  dryRun = false,
  now = new Date(),
  retryAttempts = 2,
  retryDelayMs = 1000,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!client?.listSubscriptions) throw new Error("Alunta client required");
  void now;

  const localRows = await fetchLocalSubscriptionRows(supabase);

  let remoteEntries;
  try {
    remoteEntries = await fetchWithRetry(() => fetchAllAluntaSubscriptions(client), {
      attempts: retryAttempts,
      delayMs: retryDelayMs,
    });
  } catch (err) {
    const wrapped = new Error(`Alunta GET /subscriptions fejlede: ${err.message}`);
    captureExceptionFn?.(wrapped, {
      tags: { cron: "alunta-subscription-reconcile" },
      fingerprint: ["alunta-reconcile-fetch-failed"],
    });
    throw wrapped;
  }

  const { updates, unchanged, missingRemote, unmatchedRemote, skippedUnknownStatus } = computeReconcileActions({
    localRows,
    remoteEntries,
  });

  const errors = [];
  let applied = 0;
  if (!dryRun) {
    for (const row of updates) {
      try {
        const { error } = await supabase.from("subscriptions").upsert(row, { onConflict: "team_id" });
        if (error) throw new Error(error.message);
        applied += 1;
      } catch (err) {
        // best-effort: én fejlet upsert må ikke vælte hele batchen — samlet i
        // errors[] og aggregeret captureException'et længere nede (ét issue,
        // ikke ét pr. team), mirror ai-trim-heal-sweep-mønstret i cron.js.
        errors.push({ teamId: row.team_id, message: err.message });
      }
    }
  }

  if (missingRemote.length) {
    captureExceptionFn?.(
      new Error(`Alunta-reconcile: ${missingRemote.length} lokal Pro-relevant subscription mangler i Aluntas svar`),
      {
        tags: { cron: "alunta-subscription-reconcile" },
        fingerprint: ["alunta-reconcile-missing-remote"],
        extra: { sample: missingRemote.slice(0, 20) },
      }
    );
  }
  if (skippedUnknownStatus.length) {
    captureExceptionFn?.(
      new Error(`Alunta-reconcile: ${skippedUnknownStatus.length} abonnement med ukendt status-værdi sprunget over`),
      {
        tags: { cron: "alunta-subscription-reconcile" },
        fingerprint: ["alunta-reconcile-unknown-status"],
        extra: { sample: skippedUnknownStatus.slice(0, 20) },
      }
    );
  }
  if (errors.length && !dryRun) {
    captureExceptionFn?.(new Error(`Alunta-reconcile: ${errors.length} upsert(s) fejlede`), {
      tags: { cron: "alunta-subscription-reconcile" },
      fingerprint: ["alunta-reconcile-upsert-failed"],
      extra: { sample: errors.slice(0, 20) },
    });
  }

  return {
    ran: true,
    dryRun,
    checkedLocal: localRows.length,
    checkedRemote: remoteEntries.length,
    proposedUpdates: updates.length,
    applied,
    unchanged: unchanged.length,
    missingRemote: missingRemote.length,
    unmatchedRemote: unmatchedRemote.length,
    skippedUnknownStatus: skippedUnknownStatus.length,
    errors,
    updates, // altid inkluderet — dry-run-scriptet bruger dette til at printe forslag
  };
}
