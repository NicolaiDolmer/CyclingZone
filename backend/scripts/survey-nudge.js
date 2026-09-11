#!/usr/bin/env node
// backend/scripts/survey-nudge.js
// ============================================================================
// #5121 — INDBAKKE-SKUB TIL DEM DER IKKE HAR SVARET PAA ET SPOERGESKEMA.
//
// sendSurveyInvite.mjs (#4943) sendte invitationen til ALLE menneskehold. Dette
// script er det andet skub, og det rammer kun dem der stadig mangler: maalt
// 10/9 var det 28 gennemfoerte, 9 begyndt uden at sende, 218 uden en eneste
// raekke. De tre grupper skal ikke have samme besked, og de gennemfoerte skal
// ikke have nogen.
//
// UDSENDELSE ER EJER-GATED. Scriptet skriver INTET uden --execute, og
// orkestratoren koerer det foerst naar ejeren har sagt "koer" ordret. Claude
// sender aldrig spillerbeskeder paa ejerens vegne.
//
// KOERSEL (secrets via Infisical, aldrig en dotenv-fil):
//   infisical run --env=prod -- node backend/scripts/survey-nudge.js --dry-run
//   infisical run --env=prod -- node backend/scripts/survey-nudge.js --execute
//   infisical run --env=prod -- node backend/scripts/survey-nudge.js \
//     --execute --set-closes-at 2026-09-14T21:59:00Z
//
// --dry-run er default OG kan skrives eksplicit; kun --execute skriver.
// --survey <slug> er valgfri og defaulter til 2026-09-features.
//
// --set-closes-at er et SEPARAT, EKSPLICIT flag og virker kun sammen med
// --execute. Lukkedatoen er en beslutning om hvornaar spillerne mister
// muligheden for at svare; den maa aldrig falde ud som en bivirkning af at
// sende en besked. Vaerdien skrives i UTC (kolonnen er TIMESTAMPTZ) —
// 14/9 23:59 dansk sommertid er 2026-09-14T21:59:00Z.
//
// TO GRUPPER, TO TEKSTER:
//   not_started  ingen raekke i survey_responses  -> "tre minutter til naeste saeson"
//   started      raekker, men ingen completion    -> "du mangler kun at trykke send"
// Gennemfoerte (raekke i survey_completions) faar ingenting.
//
// TYPE = admin_notice, ikke en ny notifikationstype: constrainten paa
// notifications.type, NOTIFICATION_TYPES og NotificationsPage' TYPE_CONFIG er
// tre steder der skal aendres i takt. Linket baeres af metadata.surveySlug,
// som resolveNotificationLink oversaetter til /survey/<slug> (#4943).
//
// IDEMPOTENS. En modtager der allerede har et skub for DETTE skema springes
// over, uanset hvilken af de to varianter han fik. Dedupe-noeglen er altsaa
// (survey, bruger) og ikke (survey, bruger, variant): en spiller der fik
// "du har ikke svaret" og derefter naaede at saette eet kryds ville ellers
// blive klassificeret som "begyndt" ved naeste koersel og faa skub nummer to.
// Eet skub pr. spiller pr. skema, ogsaa naar scriptet koeres igen. Varianten
// gemmes stadig i metadata.surveyNudge, saa en optaelling bagefter kan se
// hvilken tekst der landede hvor.
//
// Vi laener os IKKE paa notifyUser's dedupe-vindue (24 timer), som ville sende
// igen paa dag to.
//
// MODTAGERE. Menneskelige managers med en konto: teams hvor is_ai = false,
// is_test_account = false, is_bank = false og user_id ikke er null. Samme
// afgraensning som sendSurveyInvite.mjs.
// ============================================================================

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { buildKeyedNotification, notifyUser } from "../lib/notificationService.js";
import { fetchAllRows } from "../lib/supabasePagination.js";

export const NOTIFICATION_TYPE = "admin_notice";
export const DEFAULT_SLUG = "2026-09-features";

export const NUDGE_NOT_STARTED = "not_started";
export const NUDGE_STARTED = "started";

/** i18n-koder pr. variant. Teksterne bor i frontend/public/locales/<sprog>/backendMessages.json. */
export const NUDGE_CODES = {
  [NUDGE_NOT_STARTED]: {
    titleCode: "notif.admin.surveyNudge.title",
    messageCode: "notif.admin.surveyNudge.message",
  },
  [NUDGE_STARTED]: {
    titleCode: "notif.admin.surveyNudgeStarted.title",
    messageCode: "notif.admin.surveyNudgeStarted.message",
  },
};

/**
 * Datoen de to beskeder NAEVNER i deres tekst ("lukker den 14. september").
 * Datoen kan ikke vaere en parameter: den skal skrives forskelligt paa engelsk
 * og dansk, og notifikationen rendres i modtagerens sprog LANGT efter scriptet
 * er koert. Derfor staar den i de to locale-strenge, og derfor tjekker
 * scriptet at databasen siger det samme foer det sender. Flytter ejeren
 * lukkedatoen, skal begge locale-strenge og denne konstant flytte med.
 *
 * NB: 14. september 2026 er en MANDAG, ikke en soendag (13/9 er soendag).
 * Issue #5121's udkast skrev "soendag den 14. september"; ugedagen er derfor
 * taget ud af teksten, og selve skemaets forside regner ugedagen ud af
 * closes_at i stedet for at paastaa den.
 */
export const MESSAGE_CLOSES_ON = "2026-09-14";
export const CLOSES_TIMEZONE = "Europe/Copenhagen";

/**
 * Siger beskederne og databasen det samme om lukkedatoen? Returnerer null naar
 * alt stemmer, ellers en linje der forklarer forskellen. En besked der lyver om
 * datoen er vaerre end ingen besked.
 */
export function closeDateMismatch(closesAt, expected = MESSAGE_CLOSES_ON) {
  if (!closesAt) return `closes_at er ikke sat, men beskederne siger ${expected}.`;
  const ms = Date.parse(closesAt);
  if (Number.isNaN(ms)) return `closes_at kunne ikke laeses: ${closesAt}`;
  const actual = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLOSES_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
  if (actual === expected) return null;
  return `closes_at er ${actual} (dansk tid), men beskederne siger ${expected}. Ret teksten eller datoen.`;
}

/** Hvor mange eksempel-brugere dry-run viser pr. gruppe. */
export const SAMPLE_SIZE = 3;
/** Hvor mange tegn af et user_id der vises. Nok til at slaa op, for lidt til at vaere en identitet. */
export const SAMPLE_PREFIX_LENGTH = 8;

/**
 * Parser argv. Dry-run er default; kun --execute skriver.
 * `--survey`/`--set-closes-at` uden vaerdi (eller efterfulgt af et nyt flag)
 * laeses ikke som en vaerdi — ellers ville `--survey --execute` stille sende
 * til et skema der hedder "--execute".
 */
export function parseArgs(argv) {
  const args = argv ?? [];
  const valueOf = (flag) => {
    const index = args.indexOf(flag);
    if (index < 0) return null;
    const value = args[index + 1];
    return value && !value.startsWith("--") ? value : null;
  };
  return {
    slug: valueOf("--survey") ?? DEFAULT_SLUG,
    execute: args.includes("--execute"),
    setClosesAt: valueOf("--set-closes-at"),
    setClosesAtRequested: args.includes("--set-closes-at"),
  };
}

/**
 * Fejl der skal stoppe koerslen foer den roerer databasen. Returnerer en liste
 * af beskeder (tom = alt i orden), saa alle fejl kan vises paa een gang.
 */
export function validateArgs(args) {
  const errors = [];
  if (!args?.slug) errors.push("--survey mangler en vaerdi.");
  if (args?.setClosesAtRequested && !args?.setClosesAt) {
    errors.push("--set-closes-at mangler en ISO-dato, fx 2026-09-14T21:59:00Z.");
  }
  if (args?.setClosesAt && Number.isNaN(Date.parse(args.setClosesAt))) {
    errors.push(`--set-closes-at er ikke en gyldig dato: ${args.setClosesAt}`);
  }
  if (args?.setClosesAtRequested && !args?.execute) {
    errors.push("--set-closes-at kraever --execute. En lukkedato saettes aldrig i en dry-run.");
  }
  return errors;
}

/** Menneskelige managers med konto → unikke user_id, stabil raekkefoelge. */
export function recipientIdsFromTeams(teams) {
  const seen = new Set();
  const ids = [];
  for (const team of teams ?? []) {
    const id = team?.user_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** user_id'er fra en liste raekker → Set. Tomme raekker ignoreres. */
export function userIdSet(rows) {
  const ids = new Set();
  for (const row of rows ?? []) {
    if (row?.user_id) ids.add(row.user_id);
  }
  return ids;
}

/**
 * Deler modtagerne i de tre grupper skemaet skelner mellem.
 *   completed   raekke i survey_completions — faar ingenting
 *   started     mindst eet svar, men ingen completion
 *   notStarted  ingen svar overhovedet
 * Raekkefoelgen inden for hver gruppe er modtagerlistens, saa to koersler paa
 * samme data giver samme resultat.
 */
export function classifyRecipients({ recipientIds, completedUserIds, respondedUserIds }) {
  const completedSet = completedUserIds instanceof Set ? completedUserIds : new Set(completedUserIds ?? []);
  const respondedSet = respondedUserIds instanceof Set ? respondedUserIds : new Set(respondedUserIds ?? []);
  const completed = [];
  const started = [];
  const notStarted = [];
  for (const id of recipientIds ?? []) {
    if (completedSet.has(id)) completed.push(id);
    else if (respondedSet.has(id)) started.push(id);
    else notStarted.push(id);
  }
  return { completed, started, notStarted };
}

/**
 * Hvem har allerede faaet et skub for dette skema. En raekke taeller kun hvis
 * baade slug og surveyNudge staar i metadata: invitationen fra #4943 baerer
 * surveySlug uden surveyNudge og maa ikke undertrykke skubbet, og et skub til
 * ET skema maa ikke undertrykke skubbet til det naeste.
 */
export function nudgedUserIds(existing, slug) {
  const ids = new Set();
  for (const row of existing ?? []) {
    if (row?.user_id && row?.metadata?.surveySlug === slug && row?.metadata?.surveyNudge) {
      ids.add(row.user_id);
    }
  }
  return ids;
}

/** Modtagere der stadig mangler skubbet. */
export function pendingRecipients(recipientIds, existing, slug) {
  const already = nudgedUserIds(existing, slug);
  return (recipientIds ?? []).filter((id) => !already.has(id));
}

/** Notifikationens indhold: EN-fallback i raekken, i18n-koder + params i metadata. */
export function buildNudge({ slug, variant, count }) {
  const codes = NUDGE_CODES[variant];
  if (!codes) throw new Error(`unknown nudge variant: ${variant}`);
  const params = { count: Number.isFinite(count) ? count : 0 };
  const { title, message, metadata } = buildKeyedNotification({
    titleCode: codes.titleCode,
    titleParams: {},
    messageCode: codes.messageCode,
    messageParams: params,
    metadata: { surveySlug: slug, surveyNudge: variant },
  });
  return { type: NOTIFICATION_TYPE, title, message, metadata };
}

/** Anonymiserede eksempler: kun id-praefiks, aldrig et helt user_id i en log. */
export function sampleUserIds(ids, size = SAMPLE_SIZE) {
  return (ids ?? []).slice(0, size).map((id) => `${String(id).slice(0, SAMPLE_PREFIX_LENGTH)}...`);
}

/**
 * Dry-run-tabellen. Ren funktion af talene, saa den kan laeses i en test i
 * stedet for at skulle koeres mod prod.
 */
export function formatDryRunReport({ slug, status, closesAt, groups, pending }) {
  const notStartedPending = pending?.notStarted ?? [];
  const startedPending = pending?.started ?? [];
  const eligible = (groups?.notStarted?.length ?? 0) + (groups?.started?.length ?? 0);
  const alreadyNudged = eligible - notStartedPending.length - startedPending.length;
  return [
    `Skema:                ${slug} (status ${status}, lukker ${closesAt ?? "ikke sat"})`,
    `Gennemfoert:          ${groups?.completed?.length ?? 0}`,
    `Ikke begyndt:         ${groups?.notStarted?.length ?? 0}`,
    `Begyndt, ikke sendt:  ${groups?.started?.length ?? 0}`,
    `Har allerede faaet:   ${alreadyNudged}`,
    `Ville faa besked:     ${notStartedPending.length + startedPending.length}`,
    `  ikke begyndt:       ${notStartedPending.length} ${sampleUserIds(notStartedPending).join(" ")}`,
    `  begyndt:            ${startedPending.length} ${sampleUserIds(startedPending).join(" ")}`,
  ];
}

// ── Koerslen ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const errors = validateArgs(args);
  if (errors.length) {
    for (const line of errors) console.error(line);
    console.error(
      "Brug: node backend/scripts/survey-nudge.js [--survey <slug>] [--dry-run|--execute] [--set-closes-at <ISO>]"
    );
    process.exit(1);
  }
  const { slug, execute, setClosesAt } = args;

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL/SUPABASE_SERVICE_KEY mangler i env. Koer via: infisical run --env=prod -- node ...");
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: surveyRows, error: surveyError } = await sb
    .from("surveys")
    .select("id, slug, status, closes_at")
    .eq("slug", slug)
    .limit(1);
  if (surveyError) {
    console.error("Kunne ikke laese skemaet:", surveyError.message);
    process.exit(1);
  }
  let survey = surveyRows?.[0] ?? null;
  if (!survey) {
    console.error(`Intet skema med slug "${slug}".`);
    process.exit(1);
  }

  // Lukkedatoen saettes FOER skubbet: beskeden naevner datoen, saa den skal
  // staa i databasen naar den lander.
  if (setClosesAt) {
    const iso = new Date(setClosesAt).toISOString();
    const { error } = await sb
      .from("surveys")
      .update({ closes_at: iso, updated_at: new Date().toISOString() })
      .eq("id", survey.id);
    if (error) {
      console.error("Kunne ikke saette closes_at:", error.message);
      process.exit(1);
    }
    const { data: afterRows, error: afterError } = await sb
      .from("surveys")
      .select("id, slug, status, closes_at")
      .eq("id", survey.id)
      .limit(1);
    if (afterError || !afterRows?.[0]) {
      console.error("Kunne ikke efterverificere closes_at:", afterError?.message ?? "ingen raekke");
      process.exit(1);
    }
    survey = afterRows[0];
    console.log(`closes_at sat til ${survey.closes_at}`);
  }

  const [teams, completions, responses, existing] = await Promise.all([
    fetchAllRows(() =>
      sb
        .from("teams")
        .select("user_id")
        .eq("is_ai", false)
        .eq("is_test_account", false)
        .eq("is_bank", false)
        .not("user_id", "is", null)
        .order("id", { ascending: true })
    ),
    fetchAllRows(() =>
      sb.from("survey_completions").select("user_id").eq("survey_id", survey.id).order("user_id", { ascending: true })
    ),
    fetchAllRows(() =>
      sb.from("survey_responses").select("user_id").eq("survey_id", survey.id).order("id", { ascending: true })
    ),
    fetchAllRows(() =>
      sb
        .from("notifications")
        .select("user_id, metadata")
        .eq("type", NOTIFICATION_TYPE)
        .eq("metadata->>surveySlug", slug)
        .order("id", { ascending: true })
    ),
  ]);

  const recipientIds = recipientIdsFromTeams(teams);
  const groups = classifyRecipients({
    recipientIds,
    completedUserIds: userIdSet(completions),
    respondedUserIds: userIdSet(responses),
  });
  const pending = {
    notStarted: pendingRecipients(groups.notStarted, existing, slug),
    started: pendingRecipients(groups.started, existing, slug),
  };

  for (const line of formatDryRunReport({
    slug: survey.slug,
    status: survey.status,
    closesAt: survey.closes_at,
    groups,
    pending,
  })) {
    console.log(line);
  }

  const mismatch = closeDateMismatch(survey.closes_at);
  if (mismatch) console.log(`ADVARSEL: ${mismatch}`);

  if (!execute) {
    console.log("DRY-RUN — intet er sendt. Koer med --execute naar ejeren har sagt til.");
    process.exit(0);
  }

  // Et lukket eller ikke-aabnet skema maa ikke skubbes til: modtagerne ville
  // lande paa tak-fladen uden at kunne svare.
  if (survey.status !== "open") {
    console.error(`Skemaet "${slug}" har status "${survey.status}". Skubbet sendes kun til et aabent skema.`);
    process.exit(1);
  }
  if (survey.closes_at && Date.parse(survey.closes_at) <= Date.now()) {
    console.error(`Skemaet "${slug}" lukkede ${survey.closes_at}. Intet skub sendt.`);
    process.exit(1);
  }

  const count = userIdSet(completions).size;
  let delivered = 0;
  let failed = 0;
  for (const [variant, ids] of [
    [NUDGE_NOT_STARTED, pending.notStarted],
    [NUDGE_STARTED, pending.started],
  ]) {
    if (!ids.length) continue;
    const payload = buildNudge({ slug, variant, count });
    for (const userId of ids) {
      // dedupeWindowMs: 0 med vilje. notifyUser dedupliker paa (user, type,
      // title, message, related_id), og titel/tekst er de samme for alle
      // modtagere af samme variant. Scriptets egen idempotens er
      // metadata.surveyNudge-tjekket ovenfor, som er varigt.
      const result = await notifyUser({ supabase: sb, userId, ...payload, dedupeWindowMs: 0 });
      if (result?.delivered) delivered += 1;
      else failed += 1;
    }
  }
  console.log(`Sendt: ${delivered} · fejlet: ${failed}`);

  // Post-verify: laes igen og tjek at ingen af de udvalgte mangler.
  const after = await fetchAllRows(() =>
    sb
      .from("notifications")
      .select("user_id, metadata")
      .eq("type", NOTIFICATION_TYPE)
      .eq("metadata->>surveySlug", slug)
      .order("id", { ascending: true })
  );
  const stillMissing = pendingRecipients([...pending.notStarted, ...pending.started], after, slug);
  if (stillMissing.length || failed) {
    console.error(`Mangler stadig: ${stillMissing.length}. Koer scriptet igen.`);
    process.exit(1);
  }
  console.log("Alle udvalgte modtagere har skubbet.");
}

// Kun main() naar filen KOERES, ikke naar en test importerer de rene
// funktioner ovenfor. realpathSync udligner symlinks/worktree-junctions.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  await main();
}
