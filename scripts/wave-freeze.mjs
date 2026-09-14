#!/usr/bin/env node
// scripts/wave-freeze.mjs
// ============================================================
// Frys- og timeout-beregningen for boelger (#5178). Rene funktioner, saa
// reglen kan testes - .claude/workflows/wave.js har hverken filsystem-,
// Node-API- eller Date.now()-adgang og kan derfor ikke importere den.
//
// FEJLKLASSEN (postmortem .claude/learnings/2026-09-11-wave-timeout-er-ikke-frys.md):
// wave.js brugte agent-TAVSHED inden for 60 min som eneste frys-signal. Begge
// boelger 11/9 stoppede paa levende spor - #4845 havde committet 12 min foer
// stoppet, #5159 seks minutter foer - og et "frys" stopper pr. design HELE
// boelgen. Et frys blev altsaa maalt paa det forkerte: agentens tavshed i
// stedet for branchens fremdrift. TIER WAVE-reglen (ejer 6/9) sagde allerede
// at frys maales paa BRANCH-aktivitet; her er den som kode.
//
// MODELLEN
//   - Et spor faar 120 min (haardt loft 180, override via trackTimeoutMinutes).
//   - Naar vinduet loeber ud, MAALES branchen foer der doemmes:
//       commit < 45 min gammel  -> sporet lever, vinduet forlaenges
//       commit >= 45 min gammel -> frys (og et frys stopper boelgen)
//       kan branchen ikke maales -> frys, konservativt: en frossen agent
//         holder sin plads i samtidigheds-loftet, og usynligt reduceret
//         kapacitet kostede 2,5 time 5-6/9.
//   - Naar det haarde loft rammes med en LEVENDE branch er det ikke et frys:
//     sporet er bare stort. Det stoppes, men boelgen koerer videre.
//   - Forlaengelsen er praecis saa lang tid der er tilbage foer den seneste
//     commit selv ville blive 45 min gammel. Saa maales der igen netop naar
//     der er noget nyt at maale, ikke paa et vilkaarligt interval.
//
// Brug (probe-agenten i wave.js kalder denne form):
//   node scripts/wave-freeze.mjs --last-commit-epoch 1757800000 \
//     --now-epoch 1757802000 --elapsed-minutes 120 [--dirty] [--unpushed 2]
//   -> {"verdict":"extend","reason":"branch-active", ...}  (JSON paa stdout)
//
// Selvtest: node --test scripts/wave-freeze.test.mjs
//
// VIGTIGT: .claude/workflows/wave.js SPEJLER konstanterne og classifyStall()
// herfra (den kan ikke importere). Aendrer du en konstant her, skal den samme
// vaerdi ind i wave.js - `node --test scripts/wave-freeze.test.mjs` har en
// drift-vagt der laeser wave.js og fejler hvis de to ikke stemmer.
//
// Refs #5178, #5142, #4918.

/** Konstanter. Spejles i .claude/workflows/wave.js - hold dem synkrone. */
export const WAVE_FREEZE = {
  /** Default-vindue pr. spor foer branchen maales foerste gang. */
  TRACK_TIMEOUT_MINUTES: 120,
  /** Absolut loft: summen af alle forlaengelser kan aldrig overstige dette. */
  TRACK_HARD_CAP_MINUTES: 180,
  /** Under-graensen for et fornuftigt spor-vindue (beskytter mod 0/negativ). */
  TRACK_MIN_TIMEOUT_MINUTES: 10,
  /** En branch uden commit i saa lang tid regnes som staaende stille. */
  BRANCH_STALL_MINUTES: 45,
  /** Korteste forlaengelse - undgaar en probe-storm lige under stall-graensen. */
  MIN_EXTENSION_MINUTES: 5,
  /** Reviewer har sit eget, kortere vindue. */
  REVIEW_TIMEOUT_MINUTES: 30,
  /** 1 foerste forsoeg + praecis EET automatisk gen-spawn. */
  REVIEW_MAX_ATTEMPTS: 2,
  /** Probe-agenten er read-only og maa ikke selv kunne haenge boelgen. */
  PROBE_TIMEOUT_MINUTES: 5,
  /** Graceful stop-agenten der redder ucommittet arbejde. */
  STOP_TIMEOUT_MINUTES: 15,
  /**
   * #5220: et undersoegelsesspor (kind: "investigate") bygger intet og har
   * maaske slet ingen commits at maale branch-frys paa. Det faar derfor et
   * FAST, IKKE-forlaengeligt vindue i stedet for TRACK_TIMEOUT_MINUTES +
   * probe-extend - ingen frys-maaling, bare et timeout hvis det ikke naar at
   * levere sin dom.
   */
  INVESTIGATE_TIMEOUT_MINUTES: 60,
  /**
   * #5220: hvor laenge en branch maa staa uden commit, mens boelgen stadig er
   * aktiv, foer lane-vagten sender en PRIK (besked) - IKKE et frys. Frys-
   * graensen (BRANCH_STALL_MINUTES, 45 min) er uaendret; dette er et tidligt,
   * harmloest tegn-tjek et godt stykke under den.
   */
  POKE_MINUTES: 15,
};

/**
 * Alderen paa seneste commit i minutter.
 * @returns {number|null} null naar tallene ikke kan bruges (ingen commits paa
 *   branchen, eller uret kunne ikke laeses) - kaldere skal behandle null som
 *   "kan ikke maales", ikke som 0.
 */
export function commitAgeMinutes(lastCommitEpochSeconds, nowEpochSeconds) {
  const last = Number(lastCommitEpochSeconds);
  const now = Number(nowEpochSeconds);
  if (!Number.isFinite(last) || !Number.isFinite(now) || last <= 0 || now <= 0) return null;
  // Et negativt resultat betyder skaev ur eller en commit dateret frem i tiden;
  // klem til 0 i stedet for at melde frys paa et spor der lige har committet.
  return Math.max(0, (now - last) / 60);
}

/**
 * Loeser det oenskede spor-vindue mod det haarde loft.
 * @param {number|undefined} requested minutter, fx args.trackTimeoutMinutes
 */
export function resolveTrackTimeoutMinutes(requested) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return WAVE_FREEZE.TRACK_TIMEOUT_MINUTES;
  return Math.min(
    WAVE_FREEZE.TRACK_HARD_CAP_MINUTES,
    Math.max(WAVE_FREEZE.TRACK_MIN_TIMEOUT_MINUTES, Math.round(n)),
  );
}

/**
 * Doemmer et spor der lige har ramt sit vindue.
 *
 * @param {object} p
 * @param {boolean} p.probeOk       kunne branchen overhovedet maales?
 * @param {number|null} p.lastCommitAgeMinutes
 * @param {number} p.elapsedMinutes hvor laenge sporet har koert i alt
 * @param {number} [p.hardCapMinutes]
 * @param {number} [p.stallMinutes]
 * @returns {{verdict:'frozen'|'extend'|'hard-cap', reason:string,
 *   extendMinutes:number, stopsWave:boolean, lastCommitAgeMinutes:number|null}}
 */
export function classifyStall(p) {
  const stall = Number.isFinite(Number(p && p.stallMinutes))
    ? Number(p.stallMinutes)
    : WAVE_FREEZE.BRANCH_STALL_MINUTES;
  const hardCap = Number.isFinite(Number(p && p.hardCapMinutes))
    ? Number(p.hardCapMinutes)
    : WAVE_FREEZE.TRACK_HARD_CAP_MINUTES;
  const elapsed = Number((p && p.elapsedMinutes) || 0);
  const age = p && p.lastCommitAgeMinutes;
  // null/undefined/"" er "kunne ikke maales" - og maa IKKE glide igennem som 0
  // via Number(null) === 0, for saa ville en umaalelig branch se helt frisk ud.
  const ageOk =
    age !== null && age !== undefined && age !== '' && Number.isFinite(Number(age)) && Number(age) >= 0;

  if (!p || p.probeOk !== true || !ageOk) {
    return {
      verdict: 'frozen',
      reason: 'probe-failed',
      extendMinutes: 0,
      stopsWave: true,
      lastCommitAgeMinutes: ageOk ? Number(age) : null,
    };
  }

  const ageMin = Number(age);
  if (ageMin >= stall) {
    return {
      verdict: 'frozen',
      reason: 'branch-stall',
      extendMinutes: 0,
      stopsWave: true,
      lastCommitAgeMinutes: ageMin,
    };
  }

  // Branchen lever. Er der budget tilbage under det haarde loft, forlaenges
  // vinduet; ellers stoppes sporet - men det er en STOERRELSES-graense, ikke
  // et frys, saa boelgen koerer videre med de oevrige laner.
  const remaining = hardCap - elapsed;
  if (remaining <= 0) {
    return {
      verdict: 'hard-cap',
      reason: 'hard-cap-reached',
      extendMinutes: 0,
      stopsWave: false,
      lastCommitAgeMinutes: ageMin,
    };
  }

  const wanted = Math.max(stall - ageMin, WAVE_FREEZE.MIN_EXTENSION_MINUTES);
  return {
    verdict: 'extend',
    reason: 'branch-active',
    // Rund til hele tiendedele: vinduet bliver et setTimeout i wave.js, og
    // 11,666666666666664 minutter i en log-linje hjaelper ingen.
    extendMinutes: Math.round(Math.min(wanted, remaining) * 10) / 10,
    stopsWave: false,
    lastCommitAgeMinutes: ageMin,
  };
}

/**
 * Reviewer-forsoeg nr. `attempt` (1-baseret).
 * @returns {{attempt:number, timeoutMinutes:number, respawn:boolean, final:boolean}}
 */
export function planReviewAttempt(attempt) {
  const n = Math.max(1, Math.round(Number(attempt) || 1));
  return {
    attempt: n,
    timeoutMinutes: WAVE_FREEZE.REVIEW_TIMEOUT_MINUTES,
    respawn: n < WAVE_FREEZE.REVIEW_MAX_ATTEMPTS,
    final: n >= WAVE_FREEZE.REVIEW_MAX_ATTEMPTS,
  };
}

/**
 * Skal der koeres en graceful stop-agent der redder ucommittet arbejde?
 * Kan tilstanden ikke maales, koeres den - et dirty worktree der bliver
 * liggende er dyrere end et overfloedigt agent-kald.
 *
 * UNDTAGELSEN er 'hard-cap': dér er branchen pr. definition LEVENDE, saa
 * lane-agenten arbejder stadig i worktreet (en timeout i workflowet afbryder
 * ikke agenten - se .claude/learnings/2026-09-06-frozen-workflow-agents-hold-
 * concurrency-slots.md). To agenter der committer i samme worktree giver
 * index.lock-kamp, en WIP-commit af halvskrevne filer eller et afvist push.
 * Den levende agent pusher selv hvert 15. minut; dér skal vi holde fingrene
 * vaek og i stedet raabe op i rapporten.
 */
export function needsGracefulStop(p) {
  if (!p) return true;
  if (p.verdict === 'hard-cap') return false;
  if (p.probeOk !== true) return true;
  if (p.dirty === true) return true;
  // Et umaaleligt tal (-1, NaN, mangler) er IKKE "nul upushede": netop naar
  // `git rev-list --count @{u}..HEAD` fejler, fordi branchen aldrig er pushet
  // og ingen upstream har, ligger HVER commit kun lokalt.
  // null/undefined/"" glider ellers igennem som 0 via Number(null) === 0.
  const raw = p.unpushed;
  if (raw === null || raw === undefined || raw === '') return true;
  const unpushed = Number(raw);
  return !Number.isFinite(unpushed) || unpushed !== 0;
}

/** Commit-beskeden den graceful stop-agent skal bruge (ordret, jf. #5178). */
export function wipCommitMessage(issue) {
  return `wip(#${issue}): boelge-timeout, ucommittet arbejde gemt`;
}

/**
 * Er sporet "let" (kan koere paa faa ressourcer, ingen tung verifikation)?
 * #5220: bruges til at sortere koeen saa laner starter paa lette spor.
 */
export function isLightTrack(t) {
  return Boolean(t) && t.model === "sonnet" && t.tier === "TARGETED";
}

/**
 * #5220: udtraekker undersoegelssporets TVUNGNE dom fra slutrapporten.
 * CodeRabbit (denne PR): wave.js accepterede foer dette ethvert svar
 * ubetinget - en rapport der endte i "ved ikke" ville stille blive
 * behandlet som en gyldig undersoegelse. Nu skal en af de to ordrette
 * fraser vaere til stede, og kun EEN af dem - begge (modstridende) eller
 * ingen giver null, som kalderen skal behandle som "ufuldstaendig
 * aflevering", ALDRIG som en gaettet dom.
 * @returns {'bekraeftet'|'afvist'|null}
 */
export function extractInvestigateVerdict(reportText) {
  const text = String(reportText || "");
  const hasConfirmed = /bekraeftet\s*\+\s*fix-plan/i.test(text);
  const hasRejected = /afvist\s*\+\s*bevis-test/i.test(text);
  if (hasConfirmed && !hasRejected) return "bekraeftet";
  if (hasRejected && !hasConfirmed) return "afvist";
  return null;
}

/**
 * Blandet koe (#5220): stabil sortering der stiller lette spor (isLightTrack)
 * forrest, uden at aendre den indbyrdes raekkefoelge inden for hver gruppe -
 * orkestratorens oprindelige raekkefoelge bevares som tie-breaker. Formaal:
 * hver af de 4 laner traekker med stor sandsynlighed et let spor foerst, saa
 * verifikations-semaforen (maks 2 tunge koersler) ikke bliver flaskehalsen
 * fra minut eet, hvis koeen tilfaeldigvis starter med 4 tunge spor.
 *
 * SPEJLING i .claude/workflows/wave.js - hold dem identiske.
 */
export function sortMixedQueue(list) {
  return (Array.isArray(list) ? list : [])
    .map((t, i) => ({ t, i, light: isLightTrack(t) ? 0 : 1 }))
    .sort((a, b) => a.light - b.light || a.i - b.i)
    .map((x) => x.t);
}

import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------- CLI
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const age = commitAgeMinutes(a['last-commit-epoch'], a['now-epoch']);
  const probeOk = age !== null && a['probe-failed'] !== true;
  const decision = classifyStall({
    probeOk,
    lastCommitAgeMinutes: age,
    elapsedMinutes: Number(a['elapsed-minutes'] || 0),
    hardCapMinutes: a['hard-cap-minutes'] !== undefined ? Number(a['hard-cap-minutes']) : undefined,
    stallMinutes: a['stall-minutes'] !== undefined ? Number(a['stall-minutes']) : undefined,
  });
  const dirty = a.dirty === true || a.dirty === 'true';
  // Uden --unpushed ved vi det ikke; -1 (ukendt) er det aerlige svar, og
  // needsGracefulStop behandler det som "der kan ligge lokalt arbejde".
  const unpushed = Number.isFinite(Number(a.unpushed)) && a.unpushed !== true ? Number(a.unpushed) : -1;
  process.stdout.write(
    `${JSON.stringify(
      {
        ...decision,
        lastCommitAgeMinutes:
          decision.lastCommitAgeMinutes === null
            ? null
            : Math.round(decision.lastCommitAgeMinutes * 10) / 10,
        dirty,
        unpushed,
        gracefulStop: needsGracefulStop({ verdict: decision.verdict, probeOk, dirty, unpushed }),
      },
      null,
      2,
    )}\n`,
  );
}

// Koer kun main() naar scriptet koeres direkte (ikke ved import i testen).
// pathToFileURL (ikke en manuel "file://"-streng) for korrekt Windows-sti-encoding.
function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}
if (isMain()) {
  main();
}
