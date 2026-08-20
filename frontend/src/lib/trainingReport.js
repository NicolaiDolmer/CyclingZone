// trainingReport.js — rene helpers til trænings-feedback-laget (#1305 polish, parent #1136).
//
// Afleder anticipation (progress mod næste +1) + payoff (gennembrud, dags-opsummering)
// fra useTraining-data. Ingen DB/React/Date — unit-testes isoleret med node --test.

import { TRAINING_FOCUS_ABILITIES } from "./training.js";

// Form-værdi (0-100) hvorved en rytter regnes "i topform" i dags-opsummeringen.
// Lille UI-konstant (form 50 = neutral start; >=70 = mærkbart skarp). Påvirker KUN
// opsummerings-tallet, aldrig trænings-matematikken.
export const PEAK_FORM_THRESHOLD = 70;

// Progress-fraktion hvor baren skifter til success-farve ("tæt på gennembrud").
export const NEAR_BREAKTHROUGH = 0.9;

// Fokus-evnens vej mod næste +1. Blandt fokussets evner vælges den TÆTTEST på
// gennembrud (højeste progress) — det er anticipation-momentet spilleren skal se.
//   focus            : fokus-nøgle (vo2max/threshold/...) eller null
//   progressForRider : { [ability]: 0..1 } (ability_progress fra useTraining) eller null
// Returnerer { ability, pct } (pct = 0..100 afrundet) eller null hvis intet fokus
// eller ingen progress-data for fokussets evner.
export function focusProgress(focus, progressForRider) {
  if (!focus || !progressForRider) return null;
  const abilities = TRAINING_FOCUS_ABILITIES[focus];
  if (!abilities) return null;
  let best = null;
  for (const ability of abilities) {
    const raw = progressForRider[ability];
    if (raw == null) continue;
    const frac = Number(raw);
    if (!Number.isFinite(frac)) continue;
    if (best == null || frac > best.frac) best = { ability, frac };
  }
  if (best == null) return null;
  const clamped = Math.max(0, Math.min(0.999, best.frac));
  return { ability: best.ability, pct: Math.round(clamped * 100) };
}

// ── #3709 trin 1: kvitteringen (point pr. SÆSON) ────────────────────────────────
//
// "En kvittering kan ikke være løgn, en forudsigelse kan" (spec §5, #3659). Hele
// problemet hedder "kan managers stole på udviklingen", så fladen viser dét
// rytteren FIK: nuværende værdi, point opnået i denne sæson, og fremdrift mod
// næste point. Enheden er point pr. sæson (ejer-beslutning 9, 14/8).
//
// Taget (`nu → tag` i spec §5.1) er BEVIDST ikke med i trin 1: `ability_caps`
// forlader aldrig serveren (#1162 — backend/routes/api.js: "KUN ability-nøgler
// forlader serveren"), og patch note v7.119 lover spillerne at det præcise loft
// ikke kan aflæses. Taget venter til trin 3.

// Sæsonens hele point pr. evne for ÉN rytter, summeret fra trænings-kørslerne.
//
//   runs        : [{ tick_date, report: { riders: [...] } }] — samme form som
//                 useTrainingHistory leverer (nyeste først, men rækkefølgen er
//                 uden betydning her).
//   riderId     : rytterens id
//   seasonStart : "YYYY-MM-DD" for den AKTIVE sæsons start, eller null.
//
// Sæson-filteret er ikke pynt: vinduet er 30 dage, en sæson 28, så uden filteret
// ville forrige sæsons hale bløde ind i tallet lige efter et sæsonskift.
// tick_date er en DATE-kolonne ("YYYY-MM-DD"), så streng-sammenligning ER dato-
// sammenligning — ingen Date-parsing, ingen tidszone.
//
// Returnerer { [ability]: point } (tom = rytteren fik 0 point i sæsonen), eller
// **null** når sæsonstarten er ukendt: et fabrikeret "+0" ville være præcis den
// slags tal en kvittering ikke må vise.
export function seasonAbilityGains(runs, riderId, seasonStart) {
  if (!Array.isArray(runs) || !riderId || !seasonStart) return null;
  const since = String(seasonStart);
  const out = {};
  for (const run of runs) {
    const tickDate = run?.tick_date;
    if (!tickDate || String(tickDate) < since) continue;
    const rows = run?.report?.riders;
    if (!Array.isArray(rows)) continue;
    const row = rows.find((r) => r && r.rider_id === riderId);
    const gains = row?.gains;
    if (!gains) continue;
    for (const [ability, n] of Object.entries(gains)) {
      const v = Number(n);
      if (!Number.isFinite(v) || v <= 0) continue;
      out[ability] = (out[ability] ?? 0) + v;
    }
  }
  return out;
}

// Kvitterings-rækker for en liste af evner. Ren afledning — én form for begge
// flader (/training-rosteret og rytterprofilens Træning-fane), så de to steder
// ikke kan komme til at sige forskellige ting om samme rytter.
//
//   abilityKeys : evner der skal med, i visningsrækkefølge
//   abilities   : { [ability]: 1-99 } (rider_derived_abilities-rækken)
//   progress    : { [ability]: 0..1 } (ability_progress)
//   capped      : [ability] — backend-leverede NØGLER, aldrig cap-tal (#1162)
//   seasonGains : resultatet af seasonAbilityGains (null = sæson ukendt)
//
// Returnerer [{ ability, value, gained, pct, locked }]:
//   value  : nuværende evne, eller null når tallet mangler
//   gained : hele point i sæsonen, eller null når sæsonen er ukendt
//   pct    : 0-99 fremdrift mod næste point, eller null (låst evne / ingen data)
//   locked : evnen står på sit loft → fladen skriver "færdig" i stedet for en
//            død bar. Ordet "aldrig" bruges ALDRIG (spec §5.1).
// #3924 trin 2 (design-go 20/8, ejer-godkendt): gårsdagens bidrag til "på vej
// mod næste point"-baren, som et mørkere segment oven på fylden. Løser
// #3988-fundet: 67% af hårde pas viser +0 i dag i kvitteringens gained-kolonne
// og læses som bugs — segmentet gør et +0-pas synligt i BAREN, uanset om der
// landede et helt point.
//
// Et helt point der landede væltede baren om (mod 1): resten der nu vises ER i
// sin helhed overløbet fra gårsdagens pas (den gamle, næsten-fulde bar blev
// brugt op af pointet), så segmentet dækker HELE den viste bar. Ellers er
// segmentet den rå fremgang siden i går (nu-fraktion minus fraktion FØR
// gårsdagens tick), med et 1%-gulv så et reelt pas ALDRIG runder ned til et
// usynligt 0%-segment (den bindende regel i design-go'et).
//
//   pct         : rækkens viste fremdrifts-pct (0-99), eller null (låst/ingen data)
//   locked      : evnen står på loftet — intet segment, der er ingen bar
//   rawFrac     : rå fremdriftsfraktion NU (samme kilde som pct, før afrunding)
//   beforeFrac  : fremdriftsfraktion FØR gårsdagens tick (backend: progress_before,
//                 kun til stede på kørsler kørt efter #3924 trin 2 — ældre kørsler
//                 giver NaN/undefined, og funktionen svarer null: intet segment,
//                 ikke et gættet ét)
//   gainedToday : hele point vundet på DENNE evne i gårsdagens kørsel (report-
//                 rækkens `gains[ability]`)
// Returnerer 0-99 (segmentets bredde i pct-point) eller null (intet at vise).
export function abilityYesterdayPct({ pct, locked, rawFrac, beforeFrac, gainedToday }) {
  if (locked || pct == null) return null;
  if (Number(gainedToday) > 0) return pct;
  if (!Number.isFinite(beforeFrac)) return null;
  const now = Math.max(0, Math.min(0.999, Number.isFinite(rawFrac) ? rawFrac : 0));
  const before = Math.max(0, Math.min(0.999, beforeFrac));
  const delta = now - before;
  if (delta <= 0) return 0;
  return Math.min(pct, Math.max(1, Math.round(delta * 100)));
}

export function abilityReceipt(abilityKeys, { abilities, progress, capped, seasonGains, progressBefore, gainsToday } = {}) {
  const keys = Array.isArray(abilityKeys) ? abilityKeys : [];
  const lockedSet = new Set(Array.isArray(capped) ? capped : []);
  return keys.map((ability) => {
    const rawValue = Number(abilities?.[ability]);
    const rawFrac = Number(progress?.[ability]);
    const locked = lockedSet.has(ability);
    // Klippet ved 99: en fremdriftsbar der står på "100 %" uden at springe
    // læses som gået i stå. Point landes af den daglige kørsel, ikke af baren.
    const pct = locked || !Number.isFinite(rawFrac)
      ? null
      : Math.min(99, Math.round(Math.max(0, rawFrac) * 100));
    return {
      ability,
      value: Number.isFinite(rawValue) ? rawValue : null,
      gained: seasonGains ? Number(seasonGains[ability] ?? 0) : null,
      pct,
      locked,
      yesterdayPct: abilityYesterdayPct({
        pct, locked, rawFrac,
        beforeFrac: Number(progressBefore?.[ability]),
        gainedToday: gainsToday?.[ability],
      }),
    };
  });
}

// Kvitteringen for det AKTIVE fokus' 2-3 evner. Rosteret på /training kan ikke
// bære 15 evner pr. række; fokussets egne evner er dét rækken handler om.
// Erstatter den ene aggregerede progress-bar, som var rod-årsagen bag #3639:
// baren viste kun evnen tættest på gennembrud, så en låst evne var usynlig.
export function focusAbilityReceipt(focus, data) {
  if (!focus) return null;
  const abilities = TRAINING_FOCUS_ABILITIES[focus];
  if (!abilities?.length) return null;
  return abilityReceipt(abilities, data);
}

// #2578: samlet antal hele point vundet i dagens kørsel for én rapport-række.
// Bruges til "+N i dag"-chippen på roster-rækken, så en progress-bar der netop
// har wrappet efter et gennembrud ikke fejllæses som "ingen fremgang".
export function todayGainTotal(reportRow) {
  const gains = reportRow?.gains;
  if (!gains) return 0;
  let total = 0;
  for (const n of Object.values(gains)) {
    const v = Number(n);
    if (Number.isFinite(v) && v > 0) total += v;
  }
  return total;
}

// Et gennembrud = mindst én evne der steg (+1 eller mere) i dagens kørsel.
export function isBreakthrough(reportRow) {
  const gains = reportRow?.gains;
  if (!gains) return false;
  return Object.values(gains).some((n) => Number(n) > 0);
}

// Dags-opsummering på holdniveau fra rapportens rytter-rækker.
//   trained       = rækker med en aktiv (ikke-rest) session og ikke skadet
//   breakthroughs = antal rækker med mindst ét gennembrud
//   peakForm      = rækker med form >= PEAK_FORM_THRESHOLD
//   total         = antal rækker
export function daySummary(reportRiders) {
  const rows = reportRiders ?? [];
  let trained = 0;
  let breakthroughs = 0;
  let peakForm = 0;
  for (const row of rows) {
    if (!row.injured && row.intensity && row.intensity !== "rest") trained++;
    if (isBreakthrough(row)) breakthroughs++;
    if (Number(row.form) >= PEAK_FORM_THRESHOLD) peakForm++;
  }
  return { trained, breakthroughs, peakForm, total: rows.length };
}

// Gennembruds-spring pr. evne til visning "71 → 72". Bruger backend-berigelsen
// row.gains_detail = { [ability]: { from, to } } når den findes; ellers from/to=null
// så UI'et falder tilbage til "+n ability".
export function breakthroughJumps(reportRow) {
  const gains = reportRow?.gains ?? {};
  const detail = reportRow?.gains_detail ?? {};
  const out = [];
  for (const [ability, n] of Object.entries(gains)) {
    if (Number(n) <= 0) continue;
    const d = detail[ability];
    const from = d && Number.isFinite(Number(d.from)) ? Number(d.from) : null;
    const to = d && Number.isFinite(Number(d.to)) ? Number(d.to) : null;
    out.push({ ability, n: Number(n), from, to });
  }
  return out;
}

// ── #3924 trin 1 (design-go 20/8, ejer-godkendt): "Yesterday's gains" ──────────
//
// Kompakt resumé øverst på Train today — ÉN linje ("X trained toward their
// focus · Y rested · Z point(s) landed"), foldet ud til en kvalitativ linje pr.
// rytter. "Ingen nyt kort" (bindende, fold-disciplin): ingen ny stat-grid, ingen
// ny beregning af gårsdagens data — begge funktioner afleder rent af
// todayRun.report.riders (samme kilde som daySummary ovenfor) + den live
// progress-state (samme kilde som focusProgress).

// Holdniveau-tallene til resumé-linjen. Adskilt fra daySummary (som tæller
// "trained" bredt, inkl. ryttere uden fokus) fordi linjen specifikt siger
// "trained toward their FOCUS" — kun rækker med et sat fokus tæller med.
// Skadede ryttere tæller hverken som trænet eller hvilet (de valgte det ikke).
export function yesterdaySummary(reportRiders) {
  const rows = reportRiders ?? [];
  let trainedFocus = 0;
  let rested = 0;
  let pointsLanded = 0;
  for (const row of rows) {
    pointsLanded += todayGainTotal(row);
    if (row.injured) continue;
    if (row.intensity === "rest" || row.intensity === "recovery") rested++;
    else if (row.focus) trainedFocus++;
  }
  return { trainedFocus, rested, pointsLanded, total: rows.length };
}

// Kvalitativ historie pr. rytter til fold-ud'et. Ren klassifikation — selve
// sætningen/oversættelsen sker i UI'et (i18n); denne funktion afgør KUN hvilken
// historie der er sand for rækken, og hvilke (fakta-grundede, jf. #1162
// fog-gate) tal den skal bære. Aldrig lofter/rater, kun det der faktisk skete
// eller en observerbar fremdriftsfraktion mod næste point (samme regel som
// trainingMoment.js).
//
//   reportRiders    : todayRun.report.riders
//   progressByRider : useTraining's `progress` (live ability_progress-map)
// Returnerer [{ riderId, riderName, type, ... }] — samme rækkefølge som input.
export function riderDayStories(reportRiders, progressByRider) {
  const rows = reportRiders ?? [];
  return rows.map((row) => {
    const riderId = row.rider_id;
    const riderName = row.name;
    if (row.injured) return { riderId, riderName, type: "injured" };

    const jumps = isBreakthrough(row) ? breakthroughJumps(row) : [];
    if (jumps.length > 0) return { riderId, riderName, type: "point", jumps };

    const fatigueTo = Number.isFinite(Number(row.fatigue)) ? Number(row.fatigue) : null;
    const fatigueFrom = fatigueTo != null ? fatigueTo - Number(row.fatigue_delta ?? 0) : null;
    if (row.intensity === "rest") {
      return {
        riderId, riderName, fatigueFrom, fatigueTo,
        type: fatigueTo != null && fatigueFrom != null && fatigueTo < fatigueFrom ? "restFresh" : "rest",
      };
    }
    if (row.intensity === "recovery") return { riderId, riderName, type: "recovery", fatigueFrom, fatigueTo };

    if (row.focus) {
      const prog = focusProgress(row.focus, progressByRider?.[riderId]);
      if (prog) {
        const near = prog.pct >= NEAR_BREAKTHROUGH * 100;
        return { riderId, riderName, type: near ? "nearBreakthrough" : "progressing", ability: prog.ability, pct: prog.pct };
      }
      return { riderId, riderName, type: "trained" };
    }
    return { riderId, riderName, type: "noFocus" };
  });
}

// Træningsrapport-historik for ÉN rytter (#1533). Plukker rytterens linje ud af
// hver dags report.riders og parrer den med dagens metadata, så rytterprofilen kan
// vise dag-for-dag-historikken uden at kende run-formen.
//   runs    : [{ tick_date, executed_by, bonus_applied, report: { riders: [...] } }]
//             (allerede sorteret nyeste-først af useTrainingHistory)
//   riderId : rytterens id
// Returnerer [{ tick_date, executed_by, bonus_applied, row }] — kun dage hvor
// rytteren faktisk indgik i kørslen (nye/solgte ryttere mangler på gamle dage).
export function riderHistoryFromRuns(runs, riderId) {
  if (!Array.isArray(runs) || !riderId) return [];
  const out = [];
  for (const run of runs) {
    const rows = run?.report?.riders;
    if (!Array.isArray(rows)) continue;
    const row = rows.find((r) => r && r.rider_id === riderId);
    if (!row) continue;
    out.push({
      tick_date: run.tick_date,
      executed_by: run.executed_by,
      bonus_applied: run.bonus_applied,
      row,
    });
  }
  return out;
}
