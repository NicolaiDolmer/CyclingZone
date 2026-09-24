// Passiv udviklings-motor (#1137) — DB-orchestrator for season-transition.
//
// Kører ÉN gang pr. (rytter, sæson) i processSeasonStart, EFTER payroll. Muterer
// rider_derived_abilities (current ability) mod et uforanderligt loft, re-beregner
// base_value, ældes ryttere (is_u25), og pensionerer semi-auto med notifikation.
//
// Idempotent + ATOMISK PR. RYTTER (#2361): dev-log-insert + ability-update +
// rider-update sker i ÉN Postgres-transaktion pr. rytter via RPC'en
// apply_rider_development (database/2026-07-20-rider-development-atomic-rpc.sql).
// rider_development_log(rider_id, season_id) er UNIQUE og fungerer som RPC'ens
// interne idempotens-guard (INSERT ... ON CONFLICT DO NOTHING → returnerer false
// hvis rækken allerede fandtes, UDEN at røre evner/rytter). Før #2361 blev
// dev-loggen skrevet FØRST for ALLE ryttere, dernæst evner/rytter i separate
// batch-loops — en fejl midtvejs i den sidste update-loop efterlod loggen skrevet
// men evnerne/pensionering aldrig anvendt for de resterende ryttere, og en re-run
// ville springe dem over (uoprettelig inkonsistens — loggen sagde "udviklet", men
// var det ikke). RPC'en gør "logget" og "anvendt" atomisk: fejler ét RPC-kald, er
// alle FORUDGÅENDE ryttere i loopet allerede committet korrekt, og en re-run
// behandler kun de reelt uafsluttede. Deterministisk: al variation seedes pr.
// (rider_id, sæson) i riderProgression.js — men KUN ift. INPUT (nuværende evner);
// da RPC'en forhindrer dobbelt-anvendelse rammes determinismen aldrig af en
// re-run (en allerede-committet rytter genudvikles aldrig fra sin NYE evne).

import { fetchAllRows } from "./supabasePagination.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { predictBaseValue } from "./riderValuation.js";
import { currentProductionValue } from "./riderCareerNpv.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { developRiderSeason, buildCapsForRider, sameCaps, resolveSeasonRetirement } from "./riderProgression.js";
import {
  RETIREMENT_NOTICE_COLUMNS,
  frozenNoticeFor,
  isInSeededWindow,
  noticeFreezePatch,
} from "./retirementNotice.js";
import { resolveTrainingModifier } from "./training.js";
import { notifyTeamOwner } from "./notificationService.js";
import { isDailyTrainingEnabled } from "./dailyTrainingFlag.js";
import { isAcademyEnabled } from "./academyFlag.js";
import { detectGraduates } from "./academyGraduation.js";
import { loadValuationModelStrict, loadProductionValueModelStrict } from "./riderValuationModelSelect.js";

// Sæson 1 = launch-året (2026). Alder er SÆSON-drevet (ikke real-world-tid), så
// ryttere ældes troværdigt over sæsoner. ageForSeason(birthdate, N) = år N − fødselsår.
//
// Formlen bor nu i riderSeasonAge.js (dependency-fri SSOT) og re-eksporteres her, så
// de fem eksisterende importører af denne fil er upåvirkede. Flytningen fjernede to
// duplikater der kun fandtes fordi DENNE fil trækker DB + node:fs med sig, og libs med
// en renheds-kontrakt derfor ikke kunne importere den. Se riderSeasonAge.js for de to
// bugs duplikaterne kostede (#3071, #3081).
export { LAUNCH_REFERENCE_YEAR, ageForSeason } from "./riderSeasonAge.js";
import { ageForSeason } from "./riderSeasonAge.js";


// #3345: valuation_type er med — sæson-progressionen genberegner
// base_value/current_production_value for HVER aktiv rytter HVER sæson. Uden det
// frosne felt ville denne sti stille revaluere hele populationen efter enhver
// primary_type-reklassificering (#3325/#3343), på den allerførste
// sæson-transition efter merge — præcis det #3345 fryser mod.
// #5443: eksporteret, så vagten kan bevise at sæson-transitionen henter de
// samme værdi-relevante felter som søndagskørslen (valuationRatingParity.test.js).
export const SEASON_RIDER_COLUMNS =
  "id, primary_type, secondary_type, valuation_type, potentiale, birthdate, base_value, is_u25, is_retired, team_id, firstname, lastname";

// #5073: varsel-kolonnerne SKAL med — cutover læser det svar spilleren allerede
// har set i stedet for at rulle et nyt (se resolveSeasonRetirement).
//
// Men de må ikke kunne vælte hele sæsonskiftet: er migrationen ikke applied endnu
// (deploy før auto-migrate, eller en database uden migrationen), fejler selectet,
// developRidersForSeason kaster, og economyEngine's try/catch sluger fejlen og
// gennemfører sæsonskiftet UDEN nogen rytterudvikling og uden en eneste
// pensionering — tavst, og først synligt en hel sæson senere. Fallbacken koster
// ét ekstra kald i præcis det tilfælde og gør adfærden identisk med før #5073
// (alt rulles, intet fryses; RPC'ens eksplicitte kolonneliste ignorerer bare
// varsel-nøglerne i patchen). Fejlen logges så railway-log-watch kan se den.
// schema-columns-ok: retirement_notice_* tilfoejes af
// database/2026-09-10-5073-retirement-notice-column.sql i SAMME PR; snapshottet
// opdateres foerst efter merge.
async function fetchRidersForSeason(supabase) {
  const load = (columns) => fetchAllRows(() => supabase
    .from("riders")
    .select(columns)
    .eq("is_retired", false)
    .order("id"));
  try {
    return await load(`${SEASON_RIDER_COLUMNS}, ${RETIREMENT_NOTICE_COLUMNS}`);
  } catch (err) {
    const message = err?.message || String(err);
    if (!/retirement_notice/.test(message)) throw err;
    console.error(
      "[retirement-notice] cutover koerer UDEN varsel-kolonnerne (migration 2026-09-10-5073 ikke applied):",
      message,
    );
    return load(SEASON_RIDER_COLUMNS);
  }
}

/**
 * #4153 · Motorens pensions-input for ÉN rytter ved sæsonstart `seasonNumber`.
 * Det ENESTE sted input'et sammensættes: developRidersForSeason bruger det selv,
 * og willRetireAtSeasonStart (sæson-payrollens spørgsmål) bruger det også.
 *
 * Returnerer null når motoren springer rytteren over (mangler type, potentiale
 * eller en alder) — en sådan rytter pensioneres ikke i skiftet.
 *
 * `endingSeason` er null ved kald uden sæsonnummer (tests/orchestrator), og så
 * er der intet frosset varsel at læse (#5073).
 */
export function seasonStartRetirementInputs(riderRow, seasonNumber) {
  if (!riderRow?.primary_type || riderRow.potentiale == null) return null;
  const age = ageForSeason(riderRow.birthdate, seasonNumber);
  if (age == null) return null;
  const endingSeason = seasonNumber != null ? Number(seasonNumber) - 1 : null;
  const frozenRetirementNotice = endingSeason != null ? frozenNoticeFor(riderRow, endingSeason) : null;
  return { age, endingSeason, frozenRetirementNotice };
}

/**
 * #4153 · Pensioneres rytteren af motoren, når sæson `seasonNumber` starter?
 * Samme input (seasonStartRetirementInputs) og samme regel
 * (riderProgression.resolveSeasonRetirement) som developRiderSeason bruger i
 * developRidersForSeason — ingen kopi af reglen.
 */
export function willRetireAtSeasonStart(riderRow, seasonNumber) {
  const inputs = seasonStartRetirementInputs(riderRow, seasonNumber);
  if (!inputs) return false;
  return resolveSeasonRetirement(
    { id: riderRow.id, frozenRetirementNotice: inputs.frozenRetirementNotice },
    inputs.age,
    seasonNumber,
  ).retire;
}

/**
 * #4153 · Id'erne på de ryttere developRidersForSeason vil pensionere ved
 * sæsonstart `seasonNumber`. Samme rytter-grundlag som motoren
 * (fetchRidersForSeason: aktive ryttere + varsel-kolonnerne, med samme
 * fallback) og samme spring-over-regel for ryttere uden evne-række.
 * Kun ryttere på et hold er relevante for lønnen.
 *
 * Read-only. Kaldes af sæson-payrollen FØR motoren kører, så en rytter der
 * pensioneres i skiftet ikke får den nye sæsons løn trukket.
 *
 * @returns {Promise<Set<string>>}
 */
export async function loadRetiringRiderIds({ supabase, seasonNumber }) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const [riders, abilityRows] = await Promise.all([
    fetchRidersForSeason(supabase),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("rider_id").order("rider_id")),
  ]);
  const hasAbilities = new Set(abilityRows.map((a) => a.rider_id));
  return new Set(
    riders
      .filter((r) => r.team_id != null && hasAbilities.has(r.id) && willRetireAtSeasonStart(r, seasonNumber))
      .map((r) => r.id),
  );
}

async function runBatched(items, concurrency, fn) {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn));
  }
}

/**
 * Udvikl alle aktive ryttere én sæson frem. Idempotent + deterministisk.
 *
 * @param {object}  args
 * @param {object}  args.supabase       — service-role client
 * @param {string}  args.seasonId       — UUID på den NYE sæson (udviklingen hører til)
 * @param {number}  args.seasonNumber   — sæson-nummer (alder + seed)
 * @param {string}  [args.trainingSeasonId] — UUID på den AFSLUTTEDE sæson hvis træningsfokus
 *                  (#1163) skal biase udviklingen. Udeladt → ingen træningsbias (ren passiv).
 * @param {object}  [args.model]        — base_value-model. Udeladt ⇒ den model
 *                  app_config peger på (#5443, riderValuationModelSelect.js);
 *                  defaulten dér er v4, så adfærden er uændret indtil ejeren
 *                  flipper nøglen. Sæson-cutoveren SKAL regne med samme model
 *                  som søndagskørslen — ellers revalueres hele populationen
 *                  forkert timer efter en model-begivenhed.
 * @param {object}  [args.productionModel] — model for current_production_value
 *                  (løngrundlaget). Udeladt ⇒ app_config-nøglen
 *                  `rider_production_value_model` (#5443 ejer-beslutning 2,
 *                  20/9 aften), som seedes 'v4'. Prisen og løngrundlaget vælger
 *                  model hver for sig, så en v5-pris ikke flytter lønkrav.
 * @param {boolean} [args.notify=true]  — send retirement-notifikationer
 * @param {Date}    [args.now]          — til notifikations-dedup (default new Date())
 * @param {boolean} [args.dailyTrainingEnabled] — injiceret flag (test/orchestrator); udefineret →
 *                  slår isDailyTrainingEnabled(supabase) op. Når true: menneskelige holds
 *                  vækst-trin springes over (anti-double-dip #1305); AI-hold er upåvirket.
 * @returns {Promise<object>} summary
 */
export async function developRidersForSeason({
  supabase, seasonId, seasonNumber, trainingSeasonId = null,
  model: modelArg = null, productionModel: productionModelArg = null,
  notify = true, now = new Date(),
  notifyTeamOwnerFn = notifyTeamOwner,
  dailyTrainingEnabled: dailyTrainingEnabledArg,
  detectGraduatesFn = detectGraduates,
}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!seasonId) throw new Error("seasonId required");

  // #5443: samme model-valg som søndagskørslen (app_config, default v4).
  // STRIKS af samme grund: sæson-transitionen skriver hele populationen, så en
  // ulæselig nøgle skal stoppe kørslen, ikke gætte en model.
  const model = modelArg || await loadValuationModelStrict(supabase);
  // #5443 ejer-beslutning 2: løngrundlaget har sin egen nøgle. Læses ÉN gang
  // pr. transition, præcis som prisens model — hele populationen skal regnes
  // med det samme par.
  //
  // Har kalderen PINNET prismodellen (tests, harnesses, cutover-værktøjet),
  // følger løngrundlaget den model — præcis som før de to nøgler fandtes. Et
  // halvt app_config-opslag i en pinned kørsel ville gøre resultatet
  // afhængigt af prod-tilstand, hvilket er det modsatte af at pinne.
  const productionModel = productionModelArg
    || modelArg
    || await loadProductionValueModelStrict(supabase);

  // ── Idempotens: hvilke ryttere er allerede udviklet for denne sæson? ──────────
  const alreadyRows = await fetchAllRows(() =>
    supabase.from("rider_development_log").select("rider_id").eq("season_id", seasonId).order("id"));
  const alreadyDeveloped = new Set(alreadyRows.map((r) => r.rider_id));

  // ── Anti-double-dip (#1305): når daglig træning er aktiv springer menneskelige ──
  //    holds vækst over (de vokser allerede via den daglige tick). Fald + retirement
  //    kører sæsonbaseret for alle. AI-hold er upåvirket (full L0 som hidtil).
  //    Flag-opslag: injiceret boolean fra caller (test/orchestrator), ellers live-lookup.
  const dailyTrainingActive = dailyTrainingEnabledArg !== undefined
    ? dailyTrainingEnabledArg
    : await isDailyTrainingEnabled(supabase);

  // Human-team id-sæt: kun nødvendig når flaget er aktivt (ingen forespørgsel ellers).
  const humanTeamIds = new Set();
  if (dailyTrainingActive) {
    const teamRows = await fetchAllRows(() => supabase
      .from("teams")
      .select("id")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false)
      .order("id"));
    for (const t of teamRows) humanTeamIds.add(t.id);
  }

  // ── Træningsfokus (#1163): planer fra den afsluttede sæson biaser udviklingen.
  //    Keyet (team,rider) så kun rytterens NUVÆRENDE holds plan tæller. Gated:
  //    uden trainingSeasonId køres ren passiv udvikling (uændret #1137-adfærd).
  const trainingByTeamRider = new Map();
  if (trainingSeasonId) {
    const planRows = await fetchAllRows(() => supabase
      .from("training_plans")
      .select("team_id, rider_id, focus, intensity")
      .eq("season_id", trainingSeasonId)
      .order("id"));
    for (const p of planRows) {
      trainingByTeamRider.set(`${p.team_id}:${p.rider_id}`, { focus: p.focus, intensity: p.intensity });
    }
  }

  // ── Load aktive ryttere + abilities (+ loft) ──────────────────────────────────
  const [riders, abilityRows] = await Promise.all([
    // Kolonnelisten (og fallbacken når varsel-kolonnerne mangler) bor i
    // fetchRidersForSeason ovenfor — se dér for #3345 og #5073.
    fetchRidersForSeason(supabase),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const abilityByRider = new Map(abilityRows.map((a) => [a.rider_id, a]));

  const perRider = [];         // { id, abilityPatch, riderPatch, logPayload } → apply_rider_development RPC
  const notifications = [];    // { teamId, riderId, name }
  const summary = {
    season_id: seasonId, season_number: seasonNumber,
    candidates: 0, skipped_already_done: 0, developed: 0,
    grew: 0, declined: 0, retired: 0, caps_initialised: 0,
    trained: 0,
    growth_skipped: 0,  // ryttere hvis vækst-trin springes over (anti-double-dip #1305)
    retirement_notice_frozen: 0,  // ryttere hvis pensionsvarsel blev skrevet ned her (#5073)
    retirement_notice_read: 0,    // ryttere hvor cutover LÆSTE et allerede frosset varsel (#5073)
  };

  for (const r of riders) {
    if (alreadyDeveloped.has(r.id)) { summary.skipped_already_done++; continue; }
    // #4153: alder + frosset varsel sammensættes ét sted (seasonStartRetirementInputs),
    // så sæson-payroll kan spørge "pensioneres han i dette skifte?" med præcis
    // samme input som motoren selv bruger nedenfor.
    const retirementInputs = seasonStartRetirementInputs(r, seasonNumber);
    if (!retirementInputs) continue;
    const { age, endingSeason, frozenRetirementNotice } = retirementInputs;
    const abRow = abilityByRider.get(r.id);
    if (!abRow) continue;

    summary.candidates++;

    const abilities = {};
    for (const k of VISIBLE_ABILITIES) if (abRow[k] != null) abilities[k] = Number(abRow[k]);

    // Livstidsloftet genberegnes hver sæson (ikke lazy-initeret) — ren funktion af
    // potentiale + anlæg + nuværende evne, så en forkert persisteret værdi ikke kan
    // overleve. Se buildCapsForRider for hvorfor lazy-init var selve fejlen.
    // age medsendes (#2472, 16/7) så buildCapsForRider kan aftrappe det absolutte
    // loft efter peakAge — uden den ville post-peak-ryttere ikke aldres (blocker-fund).
    const caps = buildCapsForRider(abilities, { ...r, age }, r.primary_type, r.secondary_type);
    const capsChanged = !sameCaps(abRow.ability_caps, caps);
    if (capsChanged) summary.caps_initialised++;

    // Anti-double-dip (#1305): menneskelige holds ryttere i vækstfasen spring over;
    // AI/bank/frozen/test-hold + team_id=null kører fuld L0 som hidtil.
    const skipGrowth = dailyTrainingActive && r.team_id != null && humanTeamIds.has(r.team_id);
    if (skipGrowth) summary.growth_skipped++;

    // Træningsbias: rytterens nuværende holds plan fra den afsluttede sæson.
    // For skipGrowth-ryttere er den sæsonbaserede bias irrelevant (vækst hoppes over),
    // så vi sætter training=undefined for at undgå en stille bias der intet gør.
    const plan = (!skipGrowth && r.team_id) ? trainingByTeamRider.get(`${r.team_id}:${r.id}`) : null;
    const training = resolveTrainingModifier(plan, r.id, seasonNumber);
    if (training) summary.trained++;

    // #5073: pensionen for den AFSLUTTEDE sæson (seasonNumber − 1) er et løfte
    // rytterkortet allerede har vist. Er svaret frosset for netop den sæson,
    // læses det (frozenRetirementNotice ovenfor); ellers rulles som hidtil — og
    // resultatet skrives ned nedenfor, så det aldrig kan flytte sig igen.
    if (frozenRetirementNotice !== null) summary.retirement_notice_read++;

    const { next, retirement } = developRiderSeason(
      { id: r.id, primary_type: r.primary_type, potentiale: r.potentiale, age, frozenRetirementNotice },
      abilities, caps, seasonNumber, undefined, training, { skipGrowth }
    );

    // Vækst/fald-tælling (signaturen er den højeste evne-bevægelse).
    const before = abilitySum(abilities);
    const after = abilitySum(next);
    if (after > before) summary.grew++; else if (after < before) summary.declined++;

    // #2594: v4 kræver alder + potentiale (karriere-NPV) — begge er i scope her.
    // Alder-leddet betyder at sæson-reconcilen nu også flytter værdi ved aldring
    // (ønsket, #1364 §Symmetri). current_production_value (løn-basen) følger med.
    // #3345: valuation_type medsendes så predictBaseValue/currentProductionValue
    // bruger den FROSNE type (se riderValuation.js) — primary_type ovenfor er kun
    // fallback for rækker uden valuation_type sat.
    // #5443: secondary_type SKAL med. Søndagskørslen (riderValueRefresh
    // `withType`) sender hele rytter-rækken videre til værdi-funktionerne,
    // inklusive sekundær-typen; sæson-transitionen byggede sit eget lille
    // objekt UDEN den. De to kaldeveje skriver til de samme kolonner, så et
    // grundlag der ikke er identisk er en tavs divergens der først ses som
    // "min rytter skiftede værdi ved sæsonskiftet uden grund". Ingen nuværende
    // model læser feltet, så rettelsen er værdi-neutral i dag — den lukker
    // hullet før en model der gør. Vagt: valuationRatingParity.test.js
    // ("de to kaldeveje sender det samme rytter-grundlag").
    const valueRider = {
      primary_type: r.primary_type,
      secondary_type: r.secondary_type,
      valuation_type: r.valuation_type,
      potentiale: r.potentiale,
      age,
    };
    const newBaseValue = predictBaseValue(valueRider, next, model);
    // #5443: løngrundlaget regnes med SIN egen model (default v4), ikke prisens.
    const newCpv = currentProductionValue(valueRider, next, productionModel);

    const abilityPatch = { ...next };
    if (capsChanged) abilityPatch.ability_caps = caps;

    // U25 = UCI-reglen (ejer-beslutning 2/9-2026): sæson-alder ≤ 25 (ikke < 25).
    // `age` er allerede sæson-korrekt (ageForSeason ovenfor); grænsen selv bor
    // i riderSeasonAge.isU25ForReferenceYear (samme "≥ referenceår-25"-formel).
    const riderPatch = { is_u25: age <= 25 };
    if (newBaseValue != null) riderPatch.base_value = newBaseValue;
    if (newCpv != null) riderPatch.current_production_value = newCpv;
    if (retirement.retire) { riderPatch.is_retired = true; summary.retired++; }

    // #5073: rullede motoren selv (intet frosset svar fandtes), skrives svaret
    // ned nu — men KUN for ryttere i det seedede vindue, hvor der overhovedet er
    // et rul der kan flytte sig. Uden for vinduet er svaret en ren alders-regel,
    // og en frysning dér ville bare skjule en fremtidig bevidst ændring af
    // windowStartAge/guaranteedAge. `apply_rider_development` skriver felterne
    // i samme transaktion som pensioneringen selv (migration 2026-09-10-5073).
    if (retirement.source === "rolled" && endingSeason != null
        && isInSeededWindow(r, endingSeason)) {
      Object.assign(riderPatch, noticeFreezePatch(endingSeason, retirement.retire));
      summary.retirement_notice_frozen++;
    }

    perRider.push({
      id: r.id,
      abilityPatch,
      riderPatch,
      logPayload: { age, abilities: next, base_value: newBaseValue ?? null, retired_this_season: retirement.retire },
    });

    if (retirement.retire && r.team_id) {
      notifications.push({ teamId: r.team_id, riderId: r.id, name: `${r.firstname} ${r.lastname}`.trim(), age });
    }
    summary.developed++;
  }

  // ── Skriv (ATOMISK PR. RYTTER, #2361) ─────────────────────────────────────────
  // apply_rider_development committer dev-log-insert + ability-update + rider-update
  // i ÉN transaktion pr. rytter. RPC returnerer false hvis dev-log-rækken allerede
  // fandtes (INSERT ... ON CONFLICT (rider_id,season_id) DO NOTHING) — i så fald har
  // RPC'en GARANTERET ikke rørt evner/rytter, så det tælles som allerede-udviklet i
  // stedet for developed. Dette er kun en race (fx en samtidig anden kørsel) — det
  // indledende alreadyDeveloped-filter fanger den almindelige re-run-sti. Fejler et
  // RPC-kald, kaster vi straks: alle FORUDGÅENDE ryttere i dette loop er allerede
  // committet atomisk (logget OG anvendt sammen), så en re-run kun genoptager de
  // reelt uafsluttede — ingen dobbelt-udvikling, ingen "logget men ikke anvendt".
  const appliedForHistory = [];
  await runBatched(perRider, 25, async ({ id, abilityPatch, riderPatch, logPayload }) => {
    const { data, error } = await supabase.rpc("apply_rider_development", {
      p_rider_id: id,
      p_season_id: seasonId,
      p_season_number: seasonNumber ?? null,
      p_ability_patch: abilityPatch,
      p_rider_patch: riderPatch,
      p_log: logPayload,
    });
    if (error) throw new Error(`apply_rider_development ${id}: ${error.message}`);
    if (data === false) {
      summary.skipped_already_done++;
      summary.developed--;
      return;
    }
    appliedForHistory.push({ rider_id: id, abilities: logPayload.abilities });
  });

  // #2000 Udvikling-fane: season-snapshot af evnevektoren for ALLE FAKTISK udviklede
  // ryttere (dækker AI/free-agents + giver ejede ryttere et rent sæson-grænsepunkt).
  // Kører EFTER RPC-loopet og KUN for appliedForHistory (ikke race-skippede — deres
  // evner blev aldrig anvendt, et snapshot ville være vildledende). Best-effort: en
  // historik-fejl må ALDRIG kaste her (season-transition er kritisk spil-state;
  // historik er afledt visning). Idempotent via UNIQUE(rider_id,snapshot_date,source).
  if (appliedForHistory.length) {
    const snapshotDate = copenhagenDateString(now);
    const historyRows = appliedForHistory.map((lr) => {
      const abilities = {};
      for (const k of VISIBLE_ABILITIES) abilities[k] = lr.abilities?.[k];
      return {
        rider_id: lr.rider_id,
        snapshot_date: snapshotDate,
        source: "season_transition",
        season_number: seasonNumber ?? null,
        abilities,
      };
    });
    try {
      for (let i = 0; i < historyRows.length; i += 500) {
        const { error } = await supabase
          .from("rider_derived_ability_history")
          .upsert(historyRows.slice(i, i + 500), { onConflict: "rider_id,snapshot_date,source", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      }
    } catch (histErr) {
      console.error(`  ⚠️ ability-history snapshot (season) fejlede:`, histErr.message);
    }
  }

  // ── Retirement-notifikationer (fire-and-forget pr. ejer) ──────────────────────
  if (notify && notifications.length) {
    await runBatched(notifications, 10, ({ teamId, riderId, name, age }) =>
      notifyTeamOwnerFn({
        supabase, teamId, type: "rider_retired", relatedId: riderId, now,
        title: `${name} has retired`,
        // #2748: pensionen frigiver nu OGSÅ trup-pladsen (retirementRelease.js kører
        // som egen fase lige efter denne motor) — beskeden skal sige det, ellers
        // gætter manageren på om han selv skal rydde op.
        message: `${name} has retired from professional cycling at age ${age}. His place in your squad is now free.`,
        metadata: {
          // Koderne hed før `notification.rider_retired.*`, som IKKE følger
          // `notif.`-konventionen i backendMessages-namespacet — de fandtes derfor
          // ikke som nøgler, og renderBackendMessage faldt altid tilbage til den
          // engelske råtekst. Danske managere fik aldrig en oversat besked.
          titleCode: "notif.riderRetired.title",
          titleParams: { name },
          messageCode: "notif.riderRetired.message",
          messageParams: { name, age },
        },
      }).catch(() => { /* notifikation må aldrig vælte transitionen */ }));
  }

  // ── Akademi-graduering (#932): akademiryttere der har passeret 21 sættes i
  //    pending-valg (promover/sælg/slip). Gated på academy_enabled (no-op uden
  //    akademi). Kører efter aldring så ageForSeason afspejler den nye sæson.
  if (await isAcademyEnabled(supabase)) {
    await detectGraduatesFn(supabase, { seasonId, seasonNumber, now });
  }

  return summary;
}

function abilitySum(abilities) {
  let s = 0;
  for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) s += Number(abilities[k]);
  return s;
}
