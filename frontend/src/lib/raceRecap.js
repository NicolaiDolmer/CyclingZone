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

export function buildRaceRecap({ results = [], scope } = {}) {
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

  return moments.slice(0, MAX_MOMENTS);
}
