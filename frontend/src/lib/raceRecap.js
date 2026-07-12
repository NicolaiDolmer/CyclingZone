// #1311 — Tekst-recaps udledt af PERSISTEREDE race_results. Ren præsentation: ingen
// ny sim-mekanik, ingen motor-data ud over hvad der allerede gemmes (finish-orden,
// tids-gab, in_breakaway/breakaway_caught, klassementer). Returnerer strukturerede
// momenter { key, params } — IKKE færdige strenge, så al oversættelse bliver i
// komponenten via t("detail.recap.<key>", params). EN-først/DA-sekundært i i18n.
//
// Degraderer ærligt: tynde/gamle data → færre eller ingen momenter, aldrig falske
// påstande, aldrig kast.
import { resultEntity } from "./raceResultEntity.js";

// Solo vs. spurt-grænse: et gab på ≥10s til nr. 2 = en "solo"-fortælling.
const SOLO_THRESHOLD_S = 10;
const MAX_MOMENTS = 5;

// S4 (#1176): styrt/mekaniske uheld (race_incidents). Cap på abandon-momenter
// (mange samtidige DNF'er ville ellers oversvømme referatet — den fulde liste
// vises i stedet i en separat kompakt DNF-sektion, se RaceDetailPage). En
// time_loss tæller kun som "notable" hvis den ramte en topplaceret rytter for
// ≥30s — ellers spammer småuheld referatet med støj uden fortælleværdi.
const ABANDON_MOMENT_LIMIT = 2;
const NOTABLE_CRASH_TIME_LOSS_S = 30;

export function parseGapSeconds(gap) {
  if (!gap || typeof gap !== "string") return null;
  const m = gap.match(/(\d+):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatMargin(gap) {
  return typeof gap === "string" ? gap.replace(/^\+/, "") : "";
}

function maxStage(rows) {
  return rows.reduce((mx, r) => Math.max(mx, r.stage_number ?? 1), 0);
}

// Rytternavn på en incident-række — enten et joinet rider-objekt (frontend:
// supabase-embed `rider:rider_id(firstname,lastname)`, samme mønster som
// raceResultEntity.js) eller en fladt-navngivet enrichment fra backenden
// (Discord-embed'ens `rider_name`, spejler race_results' egen konvention).
function incidentRiderName(inc) {
  const r = inc?.rider;
  if (r && (r.firstname || r.lastname)) return `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim();
  return inc?.rider_name || null;
}

// Sekunder → "M:SS" til recap-tekst (fx et tabt tidsrum efter et styrt).
function formatClock(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

// Uheld inden for den valgte scope — etape-scope viser kun DEN etapes uheld,
// samlet-scope viser hele løbets (den kompakte DNF-sektion filtrerer selv
// yderligere ved behov).
function scopedIncidents(incidents, scope) {
  if (!incidents?.length) return [];
  if (scope.type === "stage") {
    return incidents.filter((inc) => (inc.stage_number ?? 1) === scope.stageNumber);
  }
  return incidents;
}

// Finish-orden for scope: etape → 'stage'-rækker for etapen; samlet → 'gc' ved
// sidste etape (gælder både endagsløb (gc på etape 1) og etapeløb (final-GC)).
function selectFinishOrder(results, scope) {
  let rows;
  if (scope.type === "stage") {
    rows = results.filter((r) => r.result_type === "stage" && (r.stage_number ?? 1) === scope.stageNumber);
  } else {
    // Samlet finish = 'gc' ved sidste etape. Endagsløb/gamle PCM-løb kan gemme finish
    // som 'stage'-rækker (ingen gc) — fald tilbage til højeste etapes stage-rækker
    // (spejler RaceDetailPage's egen gc→stage-fallback).
    const gc = results.filter((r) => r.result_type === "gc");
    const src = gc.length ? gc : results.filter((r) => r.result_type === "stage");
    const ms = maxStage(src);
    rows = src.filter((r) => (r.stage_number ?? 1) === ms);
  }
  return [...rows].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
}

function selectClassification(results, type) {
  const rows = results.filter((r) => r.result_type === type);
  const ms = maxStage(rows);
  return rows.filter((r) => (r.stage_number ?? 1) === ms).sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
}

function jerseyWinnerName(results, type) {
  const rows = selectClassification(results, type);
  const first = rows.find((r) => (r.rank ?? 0) === 1);
  return first ? resultEntity(first).name : null;
}

export function buildRaceRecap({ results = [], scope, incidents = [] } = {}) {
  const sc = scope || { type: "overall" };
  const moments = [];
  const finish = selectFinishOrder(results, sc);
  if (!finish.length) return moments;

  const first = finish[0];
  const second = finish[1];
  const winnerName = resultEntity(first).name;

  // 1) Sejr + margin.
  if (winnerName) {
    const marginS = second ? parseGapSeconds(second.finish_time) : null;
    if (marginS == null) {
      moments.push({ key: "win", params: { rider: winnerName } });
    } else if (marginS >= SOLO_THRESHOLD_S) {
      moments.push({ key: "soloWin", params: { rider: winnerName, marginText: formatMargin(second.finish_time) } });
    } else {
      moments.push({ key: "sprintWin", params: { rider: winnerName } });
    }
  }

  // 2) Udbrud (kun hvor motoren har skrevet udbruds-etiketter: stage-rækker +
  // endagsløbs-gc). Overlevede vinderen som escapee, eller blev udbruddet indhentet?
  const inBreak = finish.filter((r) => r.in_breakaway);
  if (inBreak.length) {
    if (first.in_breakaway && !first.breakaway_caught) {
      moments.push({ key: "breakawaySurvived", params: { count: inBreak.length } });
    } else if (finish.some((r) => r.breakaway_caught)) {
      moments.push({ key: "breakawayCaught", params: { count: inBreak.length } });
    }
  }

  // 3+4) Samlet-scope: holdets dag + sekundære trøjer.
  if (sc.type === "overall") {
    const teams = selectClassification(results, "team");
    const winTeam = teams.find((r) => (r.rank ?? 0) === 1);
    if (winTeam) {
      const teamName = resultEntity(winTeam).name;
      if (teamName) {
        const ridersInTop10 = finish.slice(0, 10).filter((r) => r.team_id && r.team_id === winTeam.team_id).length;
        if (ridersInTop10 >= 2) moments.push({ key: "teamDay", params: { team: teamName, count: ridersInTop10 } });
        else moments.push({ key: "teamWon", params: { team: teamName } });
      }
    }

    const points = jerseyWinnerName(results, "points");
    const mountain = jerseyWinnerName(results, "mountain");
    if (points && mountain) {
      moments.push({ key: "jerseys", params: { points, mountain } });
    }
  }

  // 5+6) S4 (#1176): uheld/DNF — kun når motoren rent faktisk har skrevet
  // race_incidents (v3-flaget er ON). incidents=[] (flag OFF/tabel ikke
  // migreret endnu) → ingen momenter, ingen fejl (samme degradér-ærligt-regel
  // som resten af filen).
  const scoped = scopedIncidents(incidents, sc);

  const abandons = scoped.filter((inc) => inc.outcome === "abandon" && incidentRiderName(inc));
  for (const inc of abandons.slice(0, ABANDON_MOMENT_LIMIT)) {
    moments.push({ key: "abandon", params: { rider: incidentRiderName(inc), kind: inc.kind } });
  }

  const topRiderIds = new Set(finish.slice(0, 3).map((r) => r.rider_id).filter(Boolean));
  const notableCrash = scoped.find((inc) =>
    inc.outcome === "time_loss"
    && (inc.time_loss_seconds ?? 0) >= NOTABLE_CRASH_TIME_LOSS_S
    && topRiderIds.has(inc.rider_id)
    && incidentRiderName(inc)
  );
  if (notableCrash) {
    moments.push({
      key: "notableCrash",
      params: { rider: incidentRiderName(notableCrash), marginText: formatClock(notableCrash.time_loss_seconds) },
    });
  }

  return moments.slice(0, MAX_MOMENTS);
}
