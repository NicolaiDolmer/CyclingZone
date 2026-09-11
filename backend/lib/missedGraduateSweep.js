// #5133 — løbende redningssti for akademiryttere der faldt ud af graduerings-
// flowet.
//
// BAGGRUND (verificeret prod 11/9): én akademirytter (født 2006, sæsonalder 22 i
// S3) fik aldrig sin academy_graduation-række ved sæson-transitionen 23/8. Han
// stod derfor stille på et menneskehold som akademirytter over aldersgrænsen —
// manageren fik aldrig sit valg (promovér/sælg/slip), fordi VALGET aldrig blev
// oprettet.
//
// Den strukturelle fejl er ikke at han missede batchen, men at INGEN sti fangede
// ham igen:
//   - detectGraduates kører KUN ved sæson-transitionen (riderProgressionEngine).
//     Misser du den, er næste chance næste sæsonskifte — op mod fem uger.
//   - Graduerings-sweepet (academyGraduationSweep.js) selekterer kun
//     EKSISTERENDE status='pending'-rækker. Uden en række gør det intet.
//   - Ownership-vagten (invariant G) er READ-ONLY pr. kontrakt: den råber, den
//     reparerer ikke.
//
// DENNE fil lukker hullet: samme prædikat som vagten, men den ÅBNER vinduet i
// stedet for kun at rapportere det. Invariant G bliver dermed et sikkerhedsnet
// i stedet for den eneste opdagelse.
//
// AFGRÆNSNING (bevidst): kun ryttere UDEN nogen grad-række overhovedet — dem der
// aldrig fik et override-vindue. En rytter MED en resolveret række (fx 'sold'
// uden gennemført salg) er #4495's klasse, og dén ejes af
// academyGraduation.resolveUnsoldGraduate + repairStuckAcademyGraduates.js. To
// stier der skriver på den samme rytter med hver sin historie er præcis den
// slags dobbelt-reparation der gør en prod-hændelse uoverskuelig.
//
// UDFALDET er managerens valg, ikke systemets: vi opretter den pending-række +
// notifikation som sæson-transitionen ville have oprettet, med et fuldt
// GRADUATION.DEADLINE_DAYS-vindue fra nu. Først når dét vindue udløber tager
// det eksisterende sweep over med default-kæden. Ejer-beslutning i #5133:
// manageren skal have sit valg frem for at få udfaldet trukket ned over hovedet.

import { isAcademyEnabled } from "./academyFlag.js";
import { notifyTeamOwner } from "./notificationService.js";
import { graduationDeadlineFrom, openGraduationWindow } from "./academyGraduation.js";
import { findStuckAcademyGraduates, STUCK_GRADUATE_GRACE_HOURS } from "./stuckAcademyGraduates.js";

/**
 * Slå den aktive sæson op (id + nummer). Begge dele skal bruges: nummeret til
 * det sæson-diskrete aldersprædikat, id'et til grad-rækkens season_id.
 *
 * @returns {Promise<{id:string, number:number}|null>}
 */
export async function fetchActiveSeason(supabase) {
  const { data, error } = await supabase
    .from("seasons")
    .select("id, number")
    .eq("status", "active")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`fetchActiveSeason: ${error.message}`);
  if (!data?.id || !Number.isFinite(data?.number)) return null;
  return { id: data.id, number: data.number };
}

/**
 * Akademiryttere over gradueringsalderen som ALDRIG har fået en grad-række.
 *
 * Prædikatet er vagtens, uændret (findStuckAcademyGraduates) — dry-run og
 * apply må aldrig kunne vise forskellige ryttere (læring 3/9). Her filtreres
 * kun HISTORIEN: graduationStatuses tom = intet override-vindue nogensinde.
 *
 * @returns {Promise<{seasonNumber:number|null, checked:number, missed:object[]}>}
 */
export async function findMissedGraduates(supabase, {
  now = new Date(),
  seasonNumber = undefined,
  graceHours = STUCK_GRADUATE_GRACE_HOURS,
} = {}) {
  const { seasonNumber: season, checked, stuck } = await findStuckAcademyGraduates(supabase, { now, seasonNumber, graceHours });
  return { seasonNumber: season, checked, missed: stuck.filter((c) => c.graduationStatuses.length === 0) };
}

/**
 * Detektér-og-helbred: åbn override-vinduet for hver rytter der aldrig fik et.
 *
 * Idempotent på tre lag: (1) en rytter med en pending-række er ikke i
 * kandidatlisten, (2) dedupe sker på rytter+sæson via UNIQUE(rider_id,
 * season_id), og (3) en tabt insert-race giver "duplicate", ikke en fejl.
 * Gated på academy_enabled som alt andet akademi-maskineri.
 *
 * @param {{supabase:object, now?:Date, season?:{id:string,number:number}|null, dryRun?:boolean,
 *          isEnabled?:Function, notify?:Function, graceHours?:number}} args
 * @returns {Promise<{created:number, duplicates:number, failed:number, checked:number,
 *                    seasonNumber:number|null, candidates:object[], errors:object[], skipped?:string}>}
 */
export async function runMissedGraduateSweep({
  supabase,
  now = new Date(),
  season = null,
  dryRun = false,
  isEnabled = isAcademyEnabled,
  notify = notifyTeamOwner,
  graceHours = STUCK_GRADUATE_GRACE_HOURS,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const empty = { created: 0, duplicates: 0, failed: 0, checked: 0, seasonNumber: null, candidates: [], errors: [] };

  if (!(await isEnabled(supabase))) return { ...empty, skipped: "flag_off" };

  const active = season ?? await fetchActiveSeason(supabase);
  // Uden en aktiv sæson er både aldersprædikatet og season_id udefineret —
  // spring over i stedet for at gætte (samme valg som vagten).
  if (!active) return { ...empty, skipped: "no_active_season" };

  const { checked, missed } = await findMissedGraduates(supabase, { now, seasonNumber: active.number, graceHours });
  const deadline = graduationDeadlineFrom(now);
  const candidates = missed.map((c) => ({
    riderId: c.riderId,
    teamId: c.teamId,
    aiTeamId: c.aiTeamId,
    name: `${c.firstname} ${c.lastname}`,
    birthdate: c.birthdate,
    age: c.age,
    wouldCreate: { season_id: active.id, status: "pending", deadline },
  }));

  if (dryRun) {
    return { ...empty, checked, seasonNumber: active.number, candidates, dryRun: true };
  }

  let created = 0, duplicates = 0, failed = 0;
  const errors = [];
  // Per-rytter try/catch: én rytter med et ødelagt hold må ikke koste de andre
  // deres vindue (samme isolation som graduerings-sweepets resolve-loop).
  for (const c of missed) {
    try {
      const outcome = await openGraduationWindow(supabase, {
        rider: { id: c.riderId, team_id: c.teamId, firstname: c.firstname, lastname: c.lastname },
        seasonId: active.id,
        deadline,
        notify,
      });
      if (outcome === "created") created++; else duplicates++;
    } catch (err) {
      // best-effort pr. rytter: fejlen sluges IKKE, den bæres videre i
      // `errors` og captures aggregeret i cron.js (samme mønster som
      // graduerings-sweepets resolve-loop). En Sentry-capture her ville give
      // ét issue pr. rytter pr. tick for den samme, stående tilstand.
      failed++;
      errors.push({ riderId: c.riderId, teamId: c.teamId, message: err?.message || String(err) });
      console.error(`missed-graduate sweep failed (${c.riderId}):`, err?.message || err);
    }
  }

  return { created, duplicates, failed, checked, seasonNumber: active.number, candidates, errors };
}
