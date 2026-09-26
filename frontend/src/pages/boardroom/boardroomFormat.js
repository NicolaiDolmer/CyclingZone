// #4557 · Delte formaterings-helpers for Boardroom-siden. Ren funktion,
// ingen React — genbruges af ConfidenceCard/MandateCard/BoardCard/MemberPanel
// så "Sun 30 Aug"-stilen kun defineres ét sted.
// .js-endelser, saa node --test kan importere helperne direkte (boardroomLocale.test.js).
import { formatDate, formatNumber } from "../../lib/intl.js";
import { getBoardGoalLabel } from "../../lib/boardGoalLabel.js";
import { formatCz } from "../../lib/marketValues.js";

// "Sun 30 Aug" — weekday + dag + kort maaned, lokaliseret via Intl (samme
// mekanisme som lib/intl.js's øvrige helpers).
export function formatWeekdayShortDate(date) {
  if (!date) return "";
  return formatDate(date, null, { weekday: "short", day: "numeric", month: "short" });
}

// "28 Aug" — dag + kort maaned uden ugedag (mandat-underskrift, milepaele).
export function formatShortDate(date) {
  if (!date) return "";
  return formatDate(date, null, { day: "numeric", month: "short" });
}

// Kun ugedagen ("Sun", "Sat", "Wed") — referat-feedets kompakte tidsstempel.
export function formatWeekdayOnly(date) {
  if (!date) return "";
  return formatDate(date, null, { weekday: "short" });
}

// #4557 · Saet punktum efter en dato UDEN at doble det. Dansk forkorter maaneder
// og ugedage med punktum ("28. aug.", "soen. 30. aug."), saa den engelske
// "{tekst}, {dato}."-form gav "28. aug.." paa dansk — et synligt slop-tegn paa
// hver kvittering og paa tillidskortets bevaegelses-linje.
export function endSentence(text) {
  const value = String(text ?? "");
  if (!value) return "";
  return value.endsWith(".") ? value : `${value}.`;
}

// #5472 · Replik + dato i én linje ("Last movement: ..."). Replikkerne er hele
// saetninger med eget punktum, saa den faste ", {dato}."-form gav ".," midt i
// linjen ("Keep them coming., Sun, Sep 20."). Slutter teksten allerede med et
// saetningstegn, kommer datoen efter et mellemrum i stedet for et komma.
export function appendDate(text, date) {
  const body = String(text ?? "").trim();
  if (!date) return body;
  const separator = /[.!?…"”]$/.test(body) ? " " : ", ";
  return `${body}${separator}${endSentence(date)}`;
}

// Delt mellem BoardCard (avatar-grid) og MemberPanel (portræt-header) — samme
// stemnings-dot-farve begge steder, defineret ét sted.
export const MOOD_DOT = {
  positive: "bg-cz-success",
  neutral: "bg-cz-warning",
  negative: "bg-cz-danger",
};

// #4557 (orkestrator-afgørelse efter #4570-afstemning) · mål-rækkens titel
// SKAL vises som hel saetning ("At least 3 race wins"), ikke goalType-
// korttitler. Genbruger den EKSISTERENDE type-styrede resolver
// (lib/boardGoalLabel.js) i stedet for at opfinde en ny — samme kilde som
// BoardPage. `goal.labelKey` (kontraktens navn) er fallback naar `type`
// mangler eller ikke er en kendt type: resolveren tjekker selv `label_key`
// naar det type-styrede spor ikke matcher.
//
// #5472 · boardRoom.js sender ALTID `labelKey: "goalType.<type>"` — den
// generiske korttitel, ikke en maal-specifik label. Gives den til resolveren
// som label_key, vinder den over typer resolveren først haandterer EFTER
// label_key (min_national_riders blev altid "National core" uden tal og land).
// Korttitlen er derfor kun fallback, naar resolveren intet bedre har end
// DB'ens raa label.
export function resolveGoalTitle(t, goal) {
  const labelKey = goal.labelKey ?? null;
  const isTypeFallback = typeof labelKey === "string" && labelKey.startsWith("goalType.");
  const source = {
    type: goal.type ?? null,
    target: goal.target ?? null,
    label: goal.label ?? "",
    label_key: isTypeFallback ? null : labelKey,
    cumulative: goal.cumulative ?? false,
    // #5472 · boardRoom.js spreder buildGoalLabelSource ind i baade maal og
    // milepaele, saa felterne ankommer i snake_case (race_scope,
    // nationality_code). Kun camelCase blev laest: et nationalt-kerne-maal faldt
    // derfor tilbage til DB'ens raa danske label (ogsaa paa engelsk), og et
    // klassiker-podie-maal blev vist som Monument-varianten.
    race_scope: goal.raceScope ?? goal.race_scope ?? null,
    nationality_code: goal.nationalityCode ?? goal.nationality_code ?? null,
  };
  if (!isTypeFallback) return getBoardGoalLabel(t, source);

  // #5472 (ejer-review 23/9) · Resolverens sidste udvej er DB'ens raa label.
  // Om den endte dér, afgoeres af et kald UDEN label: et type-styret svar
  // afhaenger ikke af labelen, saa en tom streng betyder "intet bedre end den
  // raa label". En sammenligning med labelen duede ikke: paa dansk ER den
  // oversatte titel ofte ordret DB-labelen ("Top 6 i divisionen"), og netop de
  // gode titler blev byttet ud med korttitlen ("Divisions-placering").
  // Labelen vaelger ellers kun plan-periode-varianten, og det faar det rigtige
  // kald nedenfor stadig med.
  if (!getBoardGoalLabel(t, { ...source, label: "" })) {
    return t(labelKey, { defaultValue: goal.label ?? "" });
  }
  return getBoardGoalLabel(t, source);
}

// #5472 (ejer-review 23/9) · GET /api/board/room sender maalets tal som raa
// tal-strenge (backend formatGoalDisplayValue: "1074082", "2.5"), saa
// gaeldsmaalet stod som "1074082 / 106397". Her formateres de med appens
// tal-formatter efter sprog: beloeb som resten af siden (formatCz: "1.074.082
// CZ$"), sponsor-vaekst som procent, alt andet med tusindtalsseparator og
// sprogets decimaltegn. En streng der ikke er et rent tal (fixturens "+412.000
// CZ$") er allerede formateret og gaar uroert igennem; null bliver tom.
// Beloeb og "CZ$" bindes med et haardt mellemrum, saa et smalt resumé-felt
// brydes ved " / " og aldrig efterlader "CZ$" alene paa en linje.
const MONEY_GOAL_TYPES = new Set(["no_outstanding_debt", "profitable_transfers"]);
const PLAIN_NUMBER_RE = /^[-+]?\d+(?:\.\d+)?$/;

export function formatGoalValue(value, type) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!PLAIN_NUMBER_RE.test(raw)) return raw;
  const num = Number(raw);
  if (MONEY_GOAL_TYPES.has(type)) return formatCz(num).replace(/ CZ\$$/, "\u00a0CZ$");
  if (type === "sponsor_growth") return formatNumber(num / 100, { style: "percent", maximumFractionDigits: 1 });
  return formatNumber(num);
}

// #5633 (N4, beta-sweep 26/9) · Visionens meta-linje var "S3 to S6": et raat,
// absolut saesonnummer uden forklaring, som spillere laeste som en fejl. Nu
// "4-season plan · Season 3 to 6". Planen starter ved den tidligste milepael,
// hvis den ligger foer startSeason (backend saetter startSeason = mandatets
// saeson, saa en milepael fra en tidligere saeson ellers faldt uden for spaendet).
export function visionSpan(vision) {
  const milestoneSeasons = (vision?.milestones || [])
    .map((m) => (m?.seasonNumber == null ? NaN : Number(m.seasonNumber)))
    .filter(Number.isFinite);
  const pick = (value) => (value == null ? [] : [Number(value)].filter(Number.isFinite));
  const starts = [...pick(vision?.startSeason), ...milestoneSeasons];
  const ends = [...pick(vision?.endSeason), ...milestoneSeasons];
  if (!starts.length || !ends.length) return { start: null, end: null, seasons: null };
  const start = Math.min(...starts);
  const end = Math.max(...ends);
  return { start, end, seasons: end - start + 1 };
}
