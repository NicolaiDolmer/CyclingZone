// #2736/#4541 — subscription-reconcile mod Alunta-API'et (hver time + boot, se cron.js).
//
// BAGGRUND: aluntaWebhook.js's ACTIVATING-set lyttede på 'invoice.paid', men det
// event FINDES IKKE i Aluntas event-katalog (kun invoice.created, subscription.
// created/started/cancelled/resumed/ended/payment_failed/tier_changed, checkout.
// completed, customer.*). Konsekvens: current_period_end opdateres ikke
// pålideligt ved fornyelse -> computeIsPro() kan falde til false selvom kunden
// betaler. Reconcilen er sikkerhedsnettet: den henter Aluntas fulde
// abonnements-liste (GET /subscriptions, sidevist) og synker status +
// current_period_end + plan_interval + alunta_customer_id/alunta_subscription_id
// ind i public.subscriptions, matchet på external_customer_id === team_id
// (samme nøgle som ensureCustomer/checkout bruger, jf. billingCheckout.js).
// is_founder RØRES ALDRIG — udelades fra hver upsert-row, præcis samme regel
// som aluntaWebhook.js (server-afledt, permanent, aldrig fra provider-payload).
//
// KONTRAKT VERIFICERET 2026-09-02 (#4541) mod Aluntas ægte GET /subscriptions-svar
// i prod (2 abonnementer): `data[]` med `uuid`, `status` ('active'), `interval`
// (1/6), `current_period_start`/`current_period_end` (ISO, fx
// 2027-03-01T22:59:59.999999Z), `customer: { uuid, name, external_customer_id }`
// hvor external_customer_id === vores team_id, samt `plan: { uuid, name }`,
// `scheduled_plan_change` og `scheduled_price_changes[]`. extractSubscriptionFields
// læser de verificerede navne først og beholder de gamle kandidat-nøgler som
// fallback (koster intet, og et felt-omdøb hos Alunta må ikke nulstille en
// betalende kundes periode).
//
// KADENCE (#4541): hver time + ved boot. Den oprindelige døgn-kadence var et
// setInterval målt fra proces-start uden boot-run; hvert deploy nulstillede
// uret, så med flere backend-deploys om dagen kørte reconcilen reelt aldrig,
// og fornyelsen 1/9 blev ikke synket (#4512/#4514).
//
// FORWARD-GUARD (#4512/#4555): siger Alunta 'active'/'past_due' om et abonnement
// hvis current_period_end ligger længere tilbage end entitlementets respit,
// er noget galt hos Alunta eller i vores udtræk — det alarmeres via Sentry
// (activeButExpired) i stedet for at ligge stille til en kunde klager.
//
// #4542: updated_at stemples på rækken, men KUN når noget faktisk ændres, så
// kolonnen kan bruges til at aflæse hvornår cachen sidst rykkede sig.
//
// Idempotent: identiske værdier springes over (ingen no-op-write); gentagne
// kørsler mod uændret Alunta-tilstand producerer 0 updates. Netværks-/API-fejl
// under selve hentningen kastes højt (efter ét retry), så cron.js' trackedTick
// + monitorCron centralt logger + Sentry-alarmerer + markerer cron-monitoren
// som fejlet — præcis samme mønster som de øvrige sweeps.
//
// Scope-afgrænsning (bevidst): reconcilen OPDATERER kun rækker der allerede
// findes i public.subscriptions. Den OPRETTER ingen ny række for en Alunta-
// kunde uden lokal modpart — checkout skriver accept-loggen på rækken FØR
// Alunta-sessionen oprettes (billingCheckout.js), så en ægte kunde har altid
// en lokal række. En Alunta-kunde uden lokal række er en afvigelse, ikke et
// tilfælde vi skal gætte et team_id til.

import { captureException as defaultCaptureException } from "./sentry.js";
import { PRO_GRACE_AFTER_PERIOD_END_MS } from "./entitlement.js";
import { normalizePlanInterval } from "./subscriptionPlanInterval.js";

const ACTIVE_ALIASES = new Set(["active", "started", "resumed", "trialing"]);
const CANCELLED_ALIASES = new Set(["cancelled", "canceled", "under_cancellation"]);
const PAST_DUE_ALIASES = new Set(["past_due", "payment_failed", "unpaid"]);
const INACTIVE_ALIASES = new Set(["ended", "expired", "inactive", "paused"]);

// PUR: Aluntas rå status-streng -> vores interne status-enum. Ukendte værdier
// returnerer null (raekken røres IKKE — bedre at flagge end at gætte forkert
// på et betalings-kritisk felt). 'under_cancellation' er Aluntas dokumenterede
// tilstand for et opsagt abonnement der stadig løber til slutdatoen (OpenAPI
// Subscription.status: pending/active/under_cancellation/cancelled) — det er
// præcis vores 'cancelled' (æret indtil current_period_end).
export function mapAluntaStatus(rawStatus) {
  const s = String(rawStatus ?? "").toLowerCase().trim();
  if (ACTIVE_ALIASES.has(s)) return "active";
  if (CANCELLED_ALIASES.has(s)) return "cancelled";
  if (PAST_DUE_ALIASES.has(s)) return "past_due";
  if (INACTIVE_ALIASES.has(s)) return "inactive";
  return null;
}

// PUR: feltudtræk fra ét Alunta-abonnements-objekt. Verificerede navne først
// (se "KONTRAKT VERIFICERET" ovenfor), gamle kandidater som fallback.
export function extractSubscriptionFields(entry) {
  if (!entry || typeof entry !== "object") return null;
  const customer = entry.customer || {};
  const plan = entry.plan || {};
  const externalCustomerId =
    customer.external_customer_id ?? entry.external_customer_id ?? entry.customer_external_id ?? null;
  const customerUuid = customer.uuid ?? entry.customer_uuid ?? entry.customer_id ?? null;
  const subscriptionUuid = entry.uuid ?? entry.subscription_uuid ?? entry.id ?? null;
  const rawStatus = entry.status ?? null;
  // Alunta sender `interval` som TAL (måneder pr. periode); vores skema og alle
  // forbrugere forventer 'monthly' | 'semiannual' (#4541, subscriptionPlanInterval.js).
  const planInterval = normalizePlanInterval(entry.interval ?? entry.plan_interval ?? plan.interval ?? null);
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

// #4542: current_period_end sammenlignes som TIDSPUNKT, ikke som tekst. Alunta
// sender "2027-03-01T22:59:59.999999Z", Postgres returnerer den samme værdi som
// "2027-03-01 22:59:59.999999+00" — tekst-sammenligning saa hver kørsel som en
// ændring, upsertede begge rækker hver time og stemplede updated_at uden at
// noget var sket (målt i Railway-loggen 2/9 efter #4640: "2 opdateret" ved boot
// på allerede synkroniserede rækker). Ulæselige værdier falder tilbage til
// tekst-sammenligning, saa en uventet form aldrig bliver "ens" ved et tilfælde.
export function toInstantMs(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.getTime();
  let s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(" ", "T");
  if (/[+-]\d{2}$/.test(s)) s = `${s}:00`;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

export function sameInstant(a, b) {
  const ma = toInstantMs(a);
  const mb = toInstantMs(b);
  if (ma != null && mb != null) return ma === mb;
  return String(a ?? "") === String(b ?? "");
}

function toMs(now) {
  return now instanceof Date ? now.getTime() : Number(now);
}

// PUR: beregn hvilke lokale rækker der skal opdateres, ud fra Aluntas rå liste.
// localRows: [{ team_id, status, plan_interval, current_period_end,
//               alunta_customer_id, alunta_subscription_id }]
// remoteEntries: rå Alunta-objekter (endnu ikke feltudtrukket).
// now: Date eller epoch-ms — styrer updated_at-stemplet og respit-guarden.
export function computeReconcileActions({ localRows = [], remoteEntries = [], now = Date.now() } = {}) {
  const nowMs = toMs(now);
  const updatedAt = new Date(nowMs).toISOString();
  const byTeamId = new Map();
  const unmatchedRemote = [];
  const skippedUnknownStatus = [];
  const activeButExpired = [];

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

    // Forward-guard: Alunta kalder abonnementet løbende, men perioden er udløbet
    // ud over respitten — ingen fornyelse er rullet, eller vores udtræk er blindt.
    if (mappedStatus === "active" || mappedStatus === "past_due") {
      const endMs = fields.currentPeriodEnd ? Date.parse(fields.currentPeriodEnd) : NaN;
      if (Number.isNaN(endMs) || endMs + PRO_GRACE_AFTER_PERIOD_END_MS < nowMs) {
        activeButExpired.push({
          externalCustomerId: fields.externalCustomerId,
          subscriptionUuid: fields.subscriptionUuid,
          rawStatus: fields.rawStatus,
          currentPeriodEnd: fields.currentPeriodEnd ?? null,
        });
      }
    }
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

    // plan_interval sammenlignes som streng: Alunta sender tallet 6, Postgres
    // returnerer kolonnen som "6" — ellers ville hver kørsel skrive rækken igen.
    const isSame =
      nextRow.status === row.status &&
      String(nextRow.plan_interval ?? "") === String(row.plan_interval ?? "") &&
      nextRow.alunta_customer_id === (row.alunta_customer_id ?? null) &&
      nextRow.alunta_subscription_id === (row.alunta_subscription_id ?? null) &&
      sameInstant(nextRow.current_period_end, row.current_period_end);

    if (isSame) unchanged.push(row.team_id);
    else updates.push({ ...nextRow, updated_at: updatedAt });
  }

  return { updates, unchanged, missingRemote, unmatchedRemote, skippedUnknownStatus, activeButExpired };
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
 * Reconcile (hver time + boot): henter Aluntas fulde abonnements-liste, matcher
 * på external_customer_id === team_id, og upserter status/current_period_end/
 * plan_interval/alunta_customer_id/alunta_subscription_id (+ updated_at ved
 * reel ændring) ind i public.subscriptions. is_founder røres ALDRIG.
 *
 * @param {object}   args
 * @param {object}   args.supabase            service-role Supabase-klient
 * @param {object}   args.client               Alunta-klient (createAluntaClient())
 * @param {(err:Error, ctx:object)=>void} [args.captureExceptionFn]
 * @param {boolean}  [args.dryRun]             beregn + returnér forslag, men skriv INTET
 * @param {Date}     [args.now]                DI-hook: updated_at-stempel + respit-guard
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

  const { updates, unchanged, missingRemote, unmatchedRemote, skippedUnknownStatus, activeButExpired } =
    computeReconcileActions({ localRows, remoteEntries, now });

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
  if (activeButExpired.length) {
    captureExceptionFn?.(
      new Error(
        `Alunta-reconcile: ${activeButExpired.length} abonnement er aktivt hos Alunta men perioden er udløbet ud over respitten`
      ),
      {
        tags: { cron: "alunta-subscription-reconcile" },
        fingerprint: ["alunta-reconcile-active-but-expired"],
        extra: { sample: activeButExpired.slice(0, 20) },
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
    activeButExpired: activeButExpired.length,
    errors,
    updates, // altid inkluderet — dry-run-scriptet bruger dette til at printe forslag
  };
}
