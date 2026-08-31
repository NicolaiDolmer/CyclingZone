// #4514 — daglig vagt for ubetalte fakturaer og udløbne entitlements.
//
// BAGGRUND: den eneste betalende kunde havde en ubetalt faktura i 23 dage og
// beholdt fuld Pro-adgang hele perioden. Ingen fik besked. Opdaget 31/8 ved en
// tilfældig gennemgang, ikke af et system.
//
// Tre huller dækkede for hinanden (målt 31/8):
//   1. Alle Aluntas betalings-notifikationer stod med enabled_channels: []
//      (payment_failed, invoice_generated, invoice_paid, automatic_invoicing_
//      reminder, webhook_delivery_failed).
//   2. Selv tændt havde de ikke fanget sagen: `payment_failed` udløses når et
//      KORT AFVISES. Her blev der aldrig forsøgt et træk, så der var ingen fejl
//      at melde — og Alunta har ingen "faktura forfalden"-notifikation i sit
//      katalog overhovedet. En faktura hvor der ikke forsøges betaling
//      producerer INGEN event. Hverken fejl eller succes. Stilhed.
//   3. Vi havde ingen vagt selv. aluntaWebhook.js mapper korrekt
//      subscription.payment_failed -> past_due, og past_due tæller bevidst
//      stadig som Pro indtil current_period_end (respitperiode). Men intet
//      eskalerede, og ingen fik besked.
//
// Denne vagt lukker hul 3, og er samtidig den eneste af de tre der kan fange
// hul 2. Den spørger Alunta direkte: "er der fakturaer der er forfaldne?" —
// et spørgsmål ingen event kan besvare.
//
// DESIGN: ren beregning adskilt fra I/O, samme mønster som
// aluntaSubscriptionReconcile.js. Vagten SKRIVER intet — hverken i Alunta eller
// i vores DB. Den observerer og alarmerer. En vagt der kan mutere tilstand er
// en vagt der kan gøre skade når den tager fejl.
//
// ALARMVEJ: struktureret console.warn (fanges af Railway-logvagten, #4453) +
// captureException med tags, så Sentry rejser et issue. Bevidst IKKE e-mail
// eller Discord til kunden — vagten taler kun til ejeren.
//
// PRIVATLIV: logger aldrig kundenavn, e-mail eller pay_url. Kun UUID,
// fakturanummer, beløb og antal dage. pay_url er en betalingslink-credential
// og må ikke ende i en logstrøm.

import { captureException as defaultCaptureException } from "./sentry.js";

// Statusser hvor computeIsPro() stadig giver adgang. Holdt i sync med
// backend/lib/entitlement.js + frontend/src/lib/proEntitlement.js — en kunde i
// en af disse tilstande HAR produktet, uanset om der er betalt.
const ENTITLING_STATUSES = new Set(["active", "cancelled", "past_due"]);

// PUR: Postgres-timestamp -> Date. Supabase returnerer formen
// `2026-08-31 21:59:59.999999+00`: mellemrum i stedet for T, mikrosekunder
// (6 cifre, JS kan kun 3) og timezone-offset uden minutter. `new Date()` giver
// Invalid Date paa den — fanget af regressionstesten, hvor den aegte prod-raekke
// ellers ville vaere klassificeret som "ulaeselig" i stedet for "udloeber snart".
export function parseTimestamp(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  const normalized = String(raw)
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1")
    .replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

// PUR: ISO-dato (YYYY-MM-DD) eller timestamp -> hele dage fra dueDate til now.
// Negativ = forfalder i fremtiden. Returnerer null ved uparsbar dato, så en
// ugyldig værdi flagges i stedet for at blive læst som 0 dage over.
export function daysOverdue(dueDate, now) {
  if (!dueDate) return null;
  const due = parseTimestamp(typeof dueDate === "string" && dueDate.length === 10 ? `${dueDate}T23:59:59.999Z` : dueDate);
  if (!due) return null;
  return Math.floor((now.getTime() - due.getTime()) / 86_400_000);
}

// PUR: Aluntas fakturaliste -> de fakturaer der reelt er forfaldne.
//
// Kriteriet er `outstanding > 0` OG forfaldsdato passeret. Vi læser IKKE
// `status`-feltet som sandhed: "issued" dækker både en faktura der lige er
// dannet og en der har ligget en måned. Restbeløbet er det entydige signal.
export function selectOverdueInvoices(invoices = [], { now = new Date(), graceDays = 0 } = {}) {
  const out = [];
  for (const inv of invoices) {
    const outstanding = Number(inv?.outstanding ?? 0);
    if (!Number.isFinite(outstanding) || outstanding <= 0) continue;
    const days = daysOverdue(inv?.due_date, now);
    if (days === null) {
      out.push({
        uuid: inv?.uuid ?? null,
        number: inv?.number ?? null,
        customerUuid: inv?.customer?.uuid ?? null,
        outstanding,
        currency: inv?.currency ?? null,
        daysOverdue: null,
        reason: "unparsable_due_date",
      });
      continue;
    }
    if (days <= graceDays) continue;
    out.push({
      uuid: inv?.uuid ?? null,
      number: inv?.number ?? null,
      customerUuid: inv?.customer?.uuid ?? null,
      outstanding,
      currency: inv?.currency ?? null,
      daysOverdue: days,
      reason: "overdue",
    });
  }
  return out.sort((a, b) => (b.daysOverdue ?? Infinity) - (a.daysOverdue ?? Infinity));
}

// PUR: lokale subscriptions-rækker -> dem hvor entitlementet er udløbet eller
// udløber snart, mens statussen stadig giver adgang.
//
// Fanger den anden ende af samme blinde plet (#4512): en kunde kan beholde Pro
// længe efter at der ikke er betalt, fordi ingen kigger på current_period_end.
export function selectStaleEntitlements(rows = [], { now = new Date(), warnDays = 2 } = {}) {
  const out = [];
  const warnMs = warnDays * 86_400_000;
  for (const row of rows) {
    if (!ENTITLING_STATUSES.has(row?.status)) continue;
    if (!row?.current_period_end) {
      out.push({ teamId: row?.team_id ?? null, status: row?.status ?? null, currentPeriodEnd: null, state: "missing_period_end" });
      continue;
    }
    const end = parseTimestamp(row.current_period_end);
    if (!end) {
      out.push({ teamId: row?.team_id ?? null, status: row?.status ?? null, currentPeriodEnd: row.current_period_end, state: "unparsable_period_end" });
      continue;
    }
    const delta = end.getTime() - now.getTime();
    if (delta < 0) {
      out.push({ teamId: row?.team_id ?? null, status: row?.status ?? null, currentPeriodEnd: row.current_period_end, state: "expired" });
    } else if (delta <= warnMs) {
      out.push({ teamId: row?.team_id ?? null, status: row?.status ?? null, currentPeriodEnd: row.current_period_end, state: "expiring_soon" });
    }
  }
  return out;
}

// PUR: findings -> én linje pr. fund, klar til logstrømmen.
// Aldrig navn, e-mail eller pay_url — se PRIVATLIV i filhovedet.
export function formatFindings({ overdue = [], stale = [] } = {}) {
  const lines = [];
  for (const o of overdue) {
    const days = o.daysOverdue === null ? "ugyldig forfaldsdato" : `${o.daysOverdue} dage over`;
    lines.push(`[billing-watch] UBETALT faktura #${o.number} · ${o.outstanding} ${o.currency ?? "?"} (minor) · ${days} · kunde ${o.customerUuid}`);
  }
  for (const s of stale) {
    lines.push(`[billing-watch] ENTITLEMENT ${s.state} · team ${s.teamId} · status ${s.status} · periode slut ${s.currentPeriodEnd ?? "mangler"}`);
  }
  return lines;
}

// Henter alle fakturasider. Samme paginerings-konvention som
// fetchAllAluntaSubscriptions: Laravel-envelope med meta.last_page.
export async function fetchAllAluntaInvoices(client, { perPage = 100, maxPages = 20 } = {}) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await client.listInvoices({ page, perPage });
    const rows = res?.data ?? [];
    all.push(...rows);
    const last = Number(res?.meta?.last_page ?? 1);
    if (!rows.length || !Number.isFinite(last) || page >= last) break;
  }
  return all;
}

export async function runAluntaOverdueWatch({
  client,
  supabase,
  now = new Date(),
  graceDays = 0,
  warnDays = 2,
  captureExceptionFn = defaultCaptureException,
  logger = console,
} = {}) {
  const invoices = await fetchAllAluntaInvoices(client);
  const overdue = selectOverdueInvoices(invoices, { now, graceDays });

  let stale = [];
  if (supabase) {
    const { data, error } = await supabase.from("subscriptions").select("team_id, status, current_period_end");
    // En fejlet DB-læsning må ikke skjule et faktura-fund: vi logger den og
    // fortsætter med den halvdel vi HAR. En vagt der falder helt om ved delvist
    // datatab er værre end en der rapporterer det den kunne måle.
    if (error) {
      logger.warn(`[billing-watch] subscriptions-opslag fejlede: ${error.message}`);
      captureExceptionFn(new Error(`billing-watch: subscriptions-opslag fejlede: ${error.message}`), {
        tags: { flow: "billing", stage: "overdue-watch" },
      });
    } else {
      stale = selectStaleEntitlements(data ?? [], { now, warnDays });
    }
  }

  const lines = formatFindings({ overdue, stale });
  for (const line of lines) logger.warn(line);

  if (lines.length > 0) {
    const worst = overdue[0]?.daysOverdue ?? null;
    const err = new Error(
      `billing-watch: ${overdue.length} ubetalt(e) faktura(er), ${stale.length} entitlement-afvigelse(r)` +
        (worst !== null ? ` — værste ${worst} dage over forfald` : "")
    );
    captureExceptionFn(err, {
      tags: { flow: "billing", stage: "overdue-watch" },
      extra: { overdueCount: overdue.length, staleCount: stale.length, worstDaysOverdue: worst },
    });
  }

  return { invoicesChecked: invoices.length, overdue, stale, alerted: lines.length > 0 };
}

export default runAluntaOverdueWatch;
