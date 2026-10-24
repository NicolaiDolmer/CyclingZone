// #6855: forlæng flere kontrakter ad gangen, 1-3 sæsoner pr. rytter.
//
// INGEN NYE TAL (ejer 18/10). Alt her er en løkke over de regler der allerede
// gælder for én forlængelse (POST /riders/:id/extend-contract):
//   - løn og ny udløbssæson = computeContractExtension (contractSeed.js), kaldt
//     én gang pr. sæson, så N sæsoner i ét kald giver PRÆCIS det samme som N
//     enkelt-forlængelser i træk (lønnen afhænger kun af rytterens nuværende
//     produktion; udløbssæson og contract_length vokser ét trin pr. kald, og
//     contract_length clampes til CONTRACT.MAX_LENGTH inde i funktionen),
//   - loftet = maxAllowedContractEndSeason (nu + MAX_EXTENSION_SEASONS_AHEAD).
//     Beder spilleren om flere sæsoner end loftet tillader, får rytteren det
//     maksimale (grantedSeasons < requestedSeasons, UI viser "2 (maks)"). Har
//     han ingen sæsoner tilbage, afvises han med samme fejlkode som i dag,
//   - lønloftet = assertSalaryIncreaseAllowed (boardConsequences.js), kaldt på
//     den SAMLEDE lønsum for de valgte ryttere (gammel sum -> ny sum), så
//     holdets lønsum efter hele batchen er det der tjekkes,
//   - intet gebyr, ingen pengebevægelse.
//
// Atomisk (alt eller intet): alle ryttere valideres før der skrives. Fejler
// bare én, skrives intet, og svaret indeholder fejlen PR. RYTTER. Skrivningen
// er én betinget UPDATE pr. rytter (team_id + den gamle udløbssæson skal stadig
// matche, så et dobbeltklik ikke kan forlænge to gange). Går en af dem tabt
// undervejs, rulles de allerede skrevne tilbage til deres gamle værdier.
// Grænse: uden DB-transaktion (ingen migration i #6855) kan en samtidig
// ændring forhindre tilbagerulningen; så svarer vi contract_batch_partial med
// de berørte ryttere i stedet for at påstå at intet er ændret.
//
// Logikken bor her (ikke i api.js), så routen kun er en tynd kobling (#5997).

import {
  CONTRACT,
  computeContractExtension,
  maxAllowedContractEndSeason,
  contractExtensionCapInfo,
} from "./contractSeed.js";
import {
  assertSalaryIncreaseAllowed as defaultAssertSalaryIncreaseAllowed,
  getActiveConsequencesForTeam as defaultGetActiveConsequences,
  CONSEQUENCE_LAYERS,
} from "./boardConsequences.js";

// Et hold har højst et par dusin ryttere inkl. ungdomstrupper; loftet her er
// kun et værn mod misbrug af endpointet, ikke en spilregel.
export const MAX_BATCH_RIDERS = 100;
// Et hold har langt under 1000 ryttere; loftet gør forespørgslen begrænset
// (PostgREST-loftet, #3331), og rammes det, kastes der i stedet for at tælle forkert.
const TEAM_RIDER_LIMIT = 1000;
export const MAX_SEASONS_PER_REQUEST = CONTRACT.MAX_EXTENSION_SEASONS_AHEAD;

const RIDER_SELECT =
  "id, firstname, lastname, team_id, is_retired, salary, current_production_value, contract_length, contract_end_season";

/**
 * Validerer request-kroppen. Accepterer `{ items: [...] }` eller en bar liste.
 * Returnerer { items } eller { error: { errorCode, errorParams? } }.
 */
export function normalizeBatchItems(body) {
  const raw = Array.isArray(body) ? body : body?.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: { errorCode: "contract_batch_empty" } };
  }
  if (raw.length > MAX_BATCH_RIDERS) {
    return { error: { errorCode: "contract_batch_too_large", errorParams: { max: MAX_BATCH_RIDERS } } };
  }
  const seen = new Set();
  const items = [];
  for (const entry of raw) {
    const riderId = typeof entry?.riderId === "string" ? entry.riderId.trim() : "";
    const seasons = Number(entry?.seasons);
    if (!riderId || !Number.isInteger(seasons) || seasons < 1 || seasons > MAX_SEASONS_PER_REQUEST) {
      return { error: { errorCode: "contract_batch_invalid", errorParams: { max: MAX_SEASONS_PER_REQUEST } } };
    }
    if (seen.has(riderId)) {
      return { error: { errorCode: "contract_batch_duplicate" } };
    }
    seen.add(riderId);
    items.push({ riderId, seasons });
  }
  return { items };
}

/**
 * Ren plan for ÉN rytter: kører computeContractExtension `seasons` gange i
 * træk (samme som N enkelt-forlængelser) og stopper ved loftet.
 * Returnerer { plan } eller { error }.
 */
export function planRiderExtension(rider, requestedSeasons, currentSeason) {
  const maxSeason = maxAllowedContractEndSeason(currentSeason);
  const capInfo = contractExtensionCapInfo(rider.contract_end_season, currentSeason);
  let state = {
    salary: rider.salary ?? null,
    contract_length: rider.contract_length ?? null,
    contract_end_season: rider.contract_end_season ?? null,
  };
  let granted = 0;
  for (let i = 0; i < requestedSeasons; i += 1) {
    const next = computeContractExtension({
      current_production_value: rider.current_production_value,
      contract_end_season: state.contract_end_season,
      contract_length: state.contract_length,
      currentSeason,
    });
    if (next.contract_end_season > maxSeason) break;
    state = next;
    granted += 1;
  }
  if (granted === 0) {
    return {
      error: {
        riderId: rider.id,
        errorCode: "contract_extension_cap_reached",
        errorParams: { maxSeason },
      },
    };
  }
  return {
    plan: {
      riderId: rider.id,
      firstname: rider.firstname ?? null,
      lastname: rider.lastname ?? null,
      requestedSeasons,
      grantedSeasons: granted,
      maxSeasons: capInfo.remainingExtensions,
      capped: granted < requestedSeasons,
      currentSalary: Number(rider.salary ?? 0),
      previousSalary: rider.salary ?? null,
      newSalary: state.salary,
      currentEndSeason: rider.contract_end_season ?? null,
      newEndSeason: state.contract_end_season,
      currentLength: rider.contract_length ?? null,
      newLength: state.contract_length,
    },
  };
}

/**
 * Ren plan for hele batchen ud fra allerede hentede ryttere.
 * `riders` = rækker hentet på id; ryttere der mangler eller ikke er holdets
 * egne afvises pr. rytter (samme fejlkoder som enkelt-forlængelsen).
 */
export function planBatchExtension({ riders, items, teamId, currentSeason }) {
  const byId = new Map((riders || []).map((r) => [r.id, r]));
  const plans = [];
  const errors = [];
  for (const item of items) {
    const rider = byId.get(item.riderId);
    if (!rider || rider.team_id !== teamId) {
      errors.push({ riderId: item.riderId, errorCode: "rider_not_owned" });
      continue;
    }
    if (rider.is_retired) {
      errors.push({ riderId: item.riderId, errorCode: "rider_retired" });
      continue;
    }
    const result = planRiderExtension(rider, item.seasons, currentSeason);
    if (result.error) errors.push(result.error);
    else plans.push(result.plan);
  }
  const oldSalarySum = plans.reduce((sum, p) => sum + Number(p.currentSalary || 0), 0);
  const newSalarySum = plans.reduce((sum, p) => sum + Number(p.newSalary || 0), 0);
  return { plans, errors, oldSalarySum, newSalarySum };
}

async function loadActiveSeasonNumber(supabase) {
  const { data, error } = await supabase
    .from("seasons").select("number").eq("status", "active").maybeSingle();
  if (error) throw new Error(`contractBatchExtension: could not load active season: ${error.message}`);
  return data?.number ?? 1;
}

async function loadTeamSalaryTotal(supabase, teamId) {
  const { data, error } = await supabase
    .from("riders").select("id, salary").eq("team_id", teamId).limit(TEAM_RIDER_LIMIT);
  if (error) throw new Error(`contractBatchExtension: could not load team salaries: ${error.message}`);
  if ((data || []).length >= TEAM_RIDER_LIMIT) throw new Error("contractBatchExtension: team salary list hit the row limit");
  return (data || []).reduce((sum, r) => sum + Number(r.salary || 0), 0);
}

async function loadRiders(supabase, riderIds) {
  const { data, error } = await supabase
    .from("riders").select(RIDER_SELECT).in("id", riderIds).limit(MAX_BATCH_RIDERS);
  if (error) throw new Error(`contractBatchExtension: could not load riders: ${error.message}`);
  return data || [];
}

function salaryCapBlockBody(block) {
  return {
    error: block.reason,
    code: block.code,
    layer: block.layer,
    errorCode: "contract_batch_salary_cap",
    errorParams: { cap: block.threshold },
  };
}

/**
 * Fælles forberedelse for quote og skrivning: hent, planlæg, tjek lønloft.
 * Returnerer { status, body } ved afvisning, ellers { ok: true, ... }.
 */
async function prepareBatch({ supabase, teamId, body, deps }) {
  const normalized = normalizeBatchItems(body);
  if (normalized.error) return { status: 400, body: normalized.error };
  const { items } = normalized;

  const [riders, currentSeason, teamSalaryBefore] = await Promise.all([
    loadRiders(supabase, items.map((i) => i.riderId)),
    loadActiveSeasonNumber(supabase),
    loadTeamSalaryTotal(supabase, teamId),
  ]);
  const plan = planBatchExtension({ riders, items, teamId, currentSeason });
  const teamSalaryAfter = teamSalaryBefore - plan.oldSalarySum + plan.newSalarySum;

  const assertCap = deps?.assertSalaryIncreaseAllowed ?? defaultAssertSalaryIncreaseAllowed;
  const capBlock = plan.errors.length === 0
    ? await assertCap({ supabase, teamId, oldSalary: plan.oldSalarySum, newSalary: plan.newSalarySum })
    : null;

  return { ok: true, items, currentSeason, plan, teamSalaryBefore, teamSalaryAfter, capBlock };
}

function summaryPayload(prepared) {
  const { plan, currentSeason, teamSalaryBefore, teamSalaryAfter } = prepared;
  return {
    currentSeason,
    maxSeason: maxAllowedContractEndSeason(currentSeason),
    riders: plan.plans,
    errors: plan.errors,
    totals: {
      selectedSalaryBefore: plan.oldSalarySum,
      selectedSalaryAfter: plan.newSalarySum,
      teamSalaryBefore,
      teamSalaryAfter,
    },
  };
}

/**
 * Quote til opsummeringsvinduet (skriver intet). Returnerer altid 200 med
 * pr.-rytter-fejl i `errors`, så vinduet kan vise dem; kun en ugyldig krop
 * giver 400. `salaryCap` siger om holdet holder sig under bestyrelsens lønloft.
 */
export async function quoteBatchExtension({ supabase, teamId, body, deps = {} }) {
  const prepared = await prepareBatch({ supabase, teamId, body, deps });
  if (!prepared.ok) return prepared;
  const getConsequences = deps.getActiveConsequencesForTeam ?? defaultGetActiveConsequences;
  const consequences = await getConsequences(supabase, teamId);
  const capActive = (consequences || []).some((c) => c.layer === CONSEQUENCE_LAYERS.SALARY_CAP);
  return {
    status: 200,
    body: {
      ...summaryPayload(prepared),
      salaryCap: {
        active: capActive,
        withinCap: !prepared.capBlock,
        cap: prepared.capBlock?.threshold ?? null,
      },
    },
  };
}

function eqOrIs(query, column, value) {
  return value == null ? query.is(column, null) : query.eq(column, value);
}

/**
 * Selve forlængelsen. Alt eller intet: valideringsfejl pr. rytter -> 409 uden
 * skrivning; lønloft -> 403 uden skrivning; en rytter der skifter tilstand
 * midt i skrivningen -> de allerede skrevne rulles tilbage og 409.
 */
export async function applyBatchExtension({ supabase, teamId, body, deps = {} }) {
  const prepared = await prepareBatch({ supabase, teamId, body, deps });
  if (!prepared.ok) return prepared;
  const { plan } = prepared;

  if (plan.errors.length > 0) {
    return {
      status: 409,
      body: {
        error: "Some contracts can't be extended. Nothing was changed",
        errorCode: "contract_batch_rejected",
        errors: plan.errors,
      },
    };
  }
  if (prepared.capBlock) {
    return { status: 403, body: salaryCapBlockBody(prepared.capBlock) };
  }

  const applied = [];
  for (const p of plan.plans) {
    let query = supabase
      .from("riders")
      .update({
        salary: p.newSalary,
        contract_length: p.newLength,
        contract_end_season: p.newEndSeason,
      })
      .eq("id", p.riderId)
      .eq("team_id", teamId);
    query = eqOrIs(query, "contract_end_season", p.currentEndSeason);
    const { data, error } = await query.select("id");
    if (error || !data || data.length === 0) {
      const notRolledBack = await rollbackApplied({ supabase, teamId, applied });
      const failed = { riderId: p.riderId, errorCode: error ? "contract_batch_write_failed" : "rider_state_changed" };
      if (notRolledBack.length > 0) {
        // Uden en DB-transaktion (ingen migration i #6855) kan en samtidig
        // ændring forhindre tilbagerulningen. Så siger svaret det ærligt og
        // navngiver de ryttere der stadig er forlænget, i stedet for at love
        // at intet er ændret. Logges til Sentry via writeError.
        return {
          status: 409,
          body: {
            error: "Some contracts changed while extending, and not every change could be undone",
            errorCode: "contract_batch_partial",
            errors: [failed, ...notRolledBack.map((riderId) => ({ riderId, errorCode: "contract_batch_partial" }))],
          },
          writeError: error ?? new Error(`rollback incomplete for ${notRolledBack.length} rider(s)`),
        };
      }
      return {
        status: error ? 500 : 409,
        body: {
          error: "A contract changed while extending. Nothing was changed",
          errorCode: "contract_batch_rejected",
          errors: [failed],
        },
        writeError: error ?? null,
      };
    }
    applied.push(p);
  }

  return {
    status: 200,
    body: { success: true, ...summaryPayload(prepared) },
  };
}

// Kompenserende tilbagerulning: sæt de allerede forlængede ryttere tilbage til
// deres gamle værdier, betinget på at det stadig er VORES nye udløbssæson der
// står der. Returnerer de rytter-id'er der IKKE kunne rulles tilbage (fejl,
// eller en samtidig ændring så ingen række matchede).
async function rollbackApplied({ supabase, teamId, applied }) {
  const notRolledBack = [];
  for (const p of applied) {
    const { data, error } = await supabase
      .from("riders")
      .update({
        salary: p.previousSalary,
        contract_length: p.currentLength,
        contract_end_season: p.currentEndSeason,
      })
      .eq("id", p.riderId)
      .eq("team_id", teamId)
      .eq("contract_end_season", p.newEndSeason)
      .select("id");
    if (error || !data || data.length === 0) notRolledBack.push(p.riderId);
  }
  return notRolledBack;
}
