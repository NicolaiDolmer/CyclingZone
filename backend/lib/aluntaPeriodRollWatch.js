// #4555 — periode-rul-vagt. Read-only, ligesom aluntaOverdueWatch.js.
//
// BAGGRUND: BILLING_STACK.md §9 punkt 9 siger det skarpest: "Et 2xx fra en
// gateway er ikke bevis for at der er flyttet penge." Vores egen sync
// (webhook + time-reconcile) kan flytte current_period_end videre til den
// NÆSTE periode uden at et kort nogensinde blev trukket — Alunta forsøger
// automatisk korttræk (§2 "Hvornår et kort trækkes"), men #4514's postmortem
// dokumenterer allerede ÉT tilfælde hvor automatisk korttræk aldrig kørte for
// en aktiv kunde. aluntaOverdueWatch.js fanger en UDSTEDT, UBETALT faktura —
// men hvis Alunta af en eller anden grund aldrig UDSTEDER en faktura for den
// nye periode (den blinde plet hul 2 i #4514's postmortem: "en faktura hvor
// der ikke forsøges betaling producerer INGEN event"), er der intet at være
// forfalden PÅ, og den vagt tier.
//
// Denne vagt spørger derfor et andet spørgsmål: for et hold hvis periode LIGE
// er rullet (current_period_end ændrede sig for nylig, eller reconcilen satte
// den), findes der overhovedet en faktura hos Alunta i vinduet omkring
// rulningen? Ingen faktura = enten trak kortet aldrig (§9's punkt 9), eller
// vores sync-tidspunkt/felt er forkert — begge er værd at vide FØR en kunde
// mister Pro eller klager.
//
// DESIGN: ren beregning (selectRecentPeriodRolls/findMissingInvoiceRolls'
// klassifikations-del) adskilt fra I/O — samme mønster som
// aluntaOverdueWatch.js/balanceDriftWatch.js. READ-ONLY mod Alunta og mod
// subscriptions — eneste skrivning er upsert til ops_alert_state (edge-
// triggered dedup, #2730-mønsteret, samme som balanceDriftWatch.js/
// trainingSlotHealthWatch.js).
//
// PERIODE-ANKER: subscriptions-tabellen har INGEN current_period_start-kolonne
// (kun current_period_end), så vinduet for "har Alunta en faktura til den nye
// periode" bygges omkring `updated_at` (#4542: stemplet KUN ved reel ændring —
// altså netop når current_period_end/status flyttede sig), ikke omkring en
// periode-startdato vi ikke har lokalt. PERIOD_ROLL_WINDOW_MS afgør hvor
// "nyligt" tæller som en rulning; INVOICE_LOOKBACK_BUFFER_MS udvider
// faktura-søgningen bagud for reconcile-lag (op til en time) + Aluntas eget
// forsøgsvindue (§2: 3 forsøg/døgn).
//
// ALARMVEJ: samme kanal som aluntaOverdueWatch.js — struktureret console.warn
// (Railway-logvagten) + captureException (Sentry). IKKE Discord — vagten taler
// kun til ejeren, ligesom forfalds-vagten.
//
// PRIVATLIV: logger aldrig kundenavn/e-mail. Kun team-id/kunde-uuid (interne
// referencer, ikke PII) + tidsstempler.

import { captureException as defaultCaptureException } from "./sentry.js";
import { parseTimestamp } from "./aluntaOverdueWatch.js";

const ALERT_KEY = "alunta-period-roll-missing-invoice"; // nøgle i ops_alert_state

// Statusser hvor en periode-rulning er relevant — samme som computeIsPro()'s
// entitling statusser minus 'cancelled' (en opsagt kunde forventes IKKE at få
// en ny faktura — det er netop pointen med opsigelse).
const ROLL_RELEVANT_STATUSES = new Set(["active", "past_due"]);

const DAY_MS = 24 * 60 * 60 * 1000;
export const PERIOD_ROLL_WINDOW_MS = DAY_MS; // "inden for de sidste 24 timer"
// Bagud-buffer på faktura-søgningen: reconcile-lag (op til 1 time, hver-time-
// kadence) + Aluntas 3x/døgn korttræks-forsøg (§2) + generel margin.
export const INVOICE_LOOKBACK_BUFFER_MS = 2 * DAY_MS;

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

// PUR: lokale subscriptions-rækker -> dem hvis periode rullede inden for
// PERIOD_ROLL_WINDOW_MS (updated_at som proxy — #4542: kun stemplet ved reel
// ændring, og status/current_period_end/plan_interval/alunta-id'er er de
// eneste felter reconcilen/webhooken rører).
export function selectRecentPeriodRolls(rows = [], { now = new Date(), windowMs = PERIOD_ROLL_WINDOW_MS } = {}) {
  const nowMs = now.getTime();
  const out = [];
  for (const row of rows) {
    if (!ROLL_RELEVANT_STATUSES.has(row?.status)) continue;
    if (!row?.current_period_end) continue;
    const updatedAt = parseTimestamp(row?.updated_at);
    if (!updatedAt) continue;
    const deltaMs = nowMs - updatedAt.getTime();
    if (deltaMs < 0 || deltaMs > windowMs) continue; // fremtidig eller for gammel
    out.push({
      teamId: row.team_id,
      alunta_customer_id: row.alunta_customer_id ?? null,
      current_period_end: row.current_period_end,
      updated_at: row.updated_at,
    });
  }
  return out;
}

// I/O: for hver rulning, spørg Alunta om der findes MINDST ÉN faktura for
// kunden i vinduet [updated_at - INVOICE_LOOKBACK_BUFFER_MS, now]. Mangler
// alunta_customer_id lokalt (kan ske, se BILLING_STACK.md §5 "en række er
// ikke en kunde"), flages det som sit eget fund frem for at gætte.
export async function findMissingInvoiceRolls({ client, rolls = [], now = new Date() }) {
  const missing = [];
  for (const roll of rolls) {
    if (!roll.alunta_customer_id) {
      missing.push({ ...roll, reason: "no_customer_id" });
      continue;
    }
    const updatedAtMs = Date.parse(roll.updated_at);
    const dateFrom = toDateStr(new Date((Number.isNaN(updatedAtMs) ? now.getTime() : updatedAtMs) - INVOICE_LOOKBACK_BUFFER_MS));
    const dateTo = toDateStr(now);
    let invoices;
    try {
      const res = await client.listInvoices({ customerUuid: roll.alunta_customer_id, dateFrom, dateTo, perPage: 50 });
      invoices = Array.isArray(res?.data) ? res.data : [];
    } catch (err) {
      // best-effort: én kundes fejlende Alunta-opslag må ikke vælte resten af
      // batchen (samme mønster som aluntaSubscriptionReconcile.js's errors[]).
      // Fejlen er ikke tabt — den bæres videre i missing[] og captureException'es
      // AGGREGERET af runAluntaPeriodRollWatch nedenfor (ét Sentry-issue for hele
      // vagtens fund, ikke ét pr. kunde).
      missing.push({ ...roll, reason: "fetch_failed", error: err.message });
      continue;
    }
    if (invoices.length === 0) missing.push({ ...roll, reason: "no_invoice_in_window" });
  }
  return missing;
}

// PUR: fund -> én linje pr. fund, klar til logstrømmen. Aldrig navn/e-mail —
// se PRIVATLIV i filhovedet.
export function formatMissingInvoiceFindings(missing = []) {
  return missing.map((m) => {
    const reason =
      m.reason === "no_customer_id"
        ? "intet alunta_customer_id lokalt"
        : m.reason === "fetch_failed"
          ? `Alunta-opslag fejlede (${m.error ?? "ukendt fejl"})`
          : "ingen faktura fundet i vinduet omkring periode-rulningen";
    return `[period-roll-watch] team ${m.teamId} · periode slut ${m.current_period_end} · ${reason}`;
  });
}

export async function runAluntaPeriodRollWatch({
  supabase,
  client,
  now = new Date(),
  captureExceptionFn = defaultCaptureException,
  logger = console,
} = {}) {
  const { data: rows, error: rowsErr } = await supabase
    .from("subscriptions")
    .select("team_id, status, current_period_end, alunta_customer_id, updated_at");
  if (rowsErr) {
    captureExceptionFn(new Error(`period-roll-watch: subscriptions-opslag fejlede: ${rowsErr.message}`), {
      tags: { flow: "billing", stage: "period-roll-watch" },
    });
    return { checked: 0, rolls: 0, missing: 0, alerted: false };
  }

  const rolls = selectRecentPeriodRolls(rows ?? [], { now });
  if (rolls.length === 0) return { checked: (rows ?? []).length, rolls: 0, missing: 0, alerted: false };

  const missing = await findMissingInvoiceRolls({ client, rolls, now });

  // Edge-triggered dedup (#2730-mønsteret): alarmér kun når fund-sættet ÆNDRER
  // sig, så hver hourly reconcile-tick der genfinder SAMME uafklarede team ikke
  // re-spammer. Signaturen er den sorterede liste af team-id'er (kort — ikke
  // hele find-objektet, som ville skifte på tidsstempler alene).
  const signature = missing.length ? missing.map((m) => m.teamId).sort().join(",") : "";
  const { data: stateRow, error: stateErr } = await supabase
    .from("ops_alert_state")
    .select("signature")
    .eq("alert_key", ALERT_KEY)
    .maybeSingle();
  if (stateErr) {
    captureExceptionFn(new Error(`period-roll-watch: ops_alert_state-læsning fejlede: ${stateErr.message}`), {
      tags: { flow: "billing", stage: "period-roll-watch" },
    });
    // Fail-safe: uden dedup-state kan vi ikke afgøre om fundet er nyt — vær
    // STILLE frem for at re-spamme (mirror balanceDriftWatch.js's rationale).
    return { checked: (rows ?? []).length, rolls: rolls.length, missing: missing.length, alerted: false };
  }
  const changed = (stateRow?.signature ?? "") !== signature;

  const lines = formatMissingInvoiceFindings(missing);
  const alerted = missing.length > 0 && changed;
  if (alerted) {
    for (const line of lines) logger.warn(line);
    captureExceptionFn(
      new Error(`period-roll-watch: ${missing.length} hold med periode-rulning uden fundet faktura i vinduet`),
      { tags: { flow: "billing", stage: "period-roll-watch" }, extra: { sample: missing.slice(0, 20) } },
    );
  }

  if (changed) {
    const { error: stateUpsertErr } = await supabase.from("ops_alert_state").upsert(
      {
        alert_key: ALERT_KEY,
        signature,
        ...(alerted ? { last_alerted_at: now.toISOString() } : {}),
        updated_at: now.toISOString(),
      },
      { onConflict: "alert_key" },
    );
    if (stateUpsertErr) {
      captureExceptionFn(new Error(`period-roll-watch: ops_alert_state-upsert fejlede: ${stateUpsertErr.message}`), {
        tags: { flow: "billing", stage: "period-roll-watch" },
      });
    }
  }

  return { checked: (rows ?? []).length, rolls: rolls.length, missing: missing.length, alerted };
}

export default runAluntaPeriodRollWatch;
