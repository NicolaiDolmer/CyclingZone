// #2647 — daglig READ-ONLY invariant-vagt for rytter-ejerskab på auktioner.
//
// BAGGRUND: incidenten 2026-07-18 — 16 hold-ejede ryttere endte på ungdoms-
// auktioner (skulle være umuligt: ungdomsauktioner er forbeholdt FRI ryttere).
// Root cause var upstream; DENNE vagt er et bagvedliggende safety-net der
// detekterer hvis invarianten nogensinde brydes igen, uanset årsag — den
// reparerer INTET, den alarmerer.
//
// FEM invarianter der aldrig må være sande:
//   A. En aktiv/extended UNGDOMSauktion hvor rytteren er hold-ejet
//      (team_id NOT NULL eller pending_team_id NOT NULL).
//   B. En aktiv/extended auktion UDEN sælger (seller_team_id IS NULL) der
//      ikke er en ungdomsauktion, hvor rytteren er hold-ejet. KRITISK: scopet
//      til status IN ('active','extended') — auctionFinalization.js sætter
//      seller_team_id=NULL på COMPLETED rækker (se finalizeYouthAuction), så
//      et uscoped query ville false-positive på EVERY completed sale.
//   C. En stale 'offered' academy_intake-række for en allerede-ejet rytter
//      (samme detektion som academyIntakeReconcile.js #1756 — genbrugt, ikke
//      duplikeret).
//   D. (#2257) En STRANDET akademi-fri-agent: is_academy=true men INTET
//      tilhørsforhold (team_id, ai_team_id og pending_team_id alle NULL, ikke
//      pensioneret). Klassen opstod ved fair-play-remediationen (#2221, 6/7:
//      annulleret auktion + "managed in your academy"-afvisning på frie ryttere)
//      og igen 20/7 (3 ryttere, datarepareret 30/7). Rytteren afvises af
//      auktions-gaten (#1824, rider_is_academy) men er ikke i noget akademi —
//      kan hverken hentes, auktioneres eller handles. Gaten må IKKE lempes
//      (frie AI-akademi-prospekter med ai_team_id skal fortsat blokeres), så
//      vagten fanger klassen i stedet, uanset hvilken frigivelses-sti der
//      skabte den.
//   E. (#3330) En STALE parkeret transfer: pending_team_id NOT NULL i mere end
//      PENDING_TRANSFER_STALE_HOURS OG rytteren er IKKE længere i et aktivt
//      fleretape-løb (CYCLINGZONE-48 — se PENDING_TRANSFER_STALE_HOURS for
//      hvorfor alderen alene gav falske positiver på lovlige, lange løb).
//      stageRaceTransferDefer.js parkerer et
//      holdskifte på pending_team_id når en rytter handles midt i et aktivt
//      fleretape-løb (#1995); flushen kaldes KUN ved løbs-finalisering for DET
//      løbs deltagere (raceRunner.js). Falder flushen på gulvet (løbet
//      finaliseres ad en anden vej, admin-genkørsel springer over) hænger
//      rytteren i limbo for evigt — og INDTIL denne invariant blev tilføjet
//      blev pending_team_id != null aktivt regnet som "gyldigt ejet" (se
//      isOwned nedenfor, som STADIG er korrekt til invariant A/B: en rytter
//      der reelt er midt i en aktiv handel skal ikke kunne komme på en
//      ungdoms-/sælgerløs auktion). Prod-evidens: Vasco Fernandes stod
//      parkeret 22/6→4/8 (>40 dage) med en betalt, aldrig-leveret handel —
//      rapporteret af en spiller i Discord. #3330's heal-sweep
//      (deferredTransferHealSweep.js) reparerer nu proaktivt; DENNE invariant
//      er backstoppet for hvis den heal-sweep selv fejler/er slukket.
//
// READ-ONLY: ingen DB-writes, ingen ny tabel, ingen migration. Én Sentry-
// capture pr. invariant pr. tick med FAST fingerprint (mirror ai-trim-
// invariant-guard #2407/#2434-mønstret i cron.js) — ét Sentry-issue pr.
// invariant uanset findings-antal, aldrig ét issue pr. rytter.

import { fetchAllRows } from "./supabasePagination.js";
import { findStaleOfferedIntake } from "./academyIntakeReconcile.js";
import { getRidersInActiveStageRace } from "./stageRaceTransferDefer.js";
import { TEAM_BOARD_MEMBERS_COUNT } from "./boardMembers.js";

const CHUNK = 1000;
const SAMPLE_LIMIT = 50;

// #3330: hvor længe må pending_team_id stå parkeret før det er et invariant-
// brud i stedet for en legitim, igangværende deferral (#1995)? Valgt
// KONSERVATIVT (48t). ALDEREN ALENE ER IKKE NOK: antagelsen om at 48t var
// "længere end det længste fleretape-løb realistisk kan tage (typisk 1-3 dage)"
// holdt ikke i prod (CYCLINGZONE-48, 8/8): et 4-etape-løb spænder over flere
// game-days og tog 55t+ realtid, så en HELT legitim, igangværende deferral
// alarmerede dagligt — præcis den falsk-positiv-klasse tærsklen skulle undgå
// (samme lektie som STALE_BACKSTOP_HOURS i aiTeamTrimHealSweep.js: CYCLINGZONE-31
// lærte os at en for stram tærskel spammer Sentry på lovlige, langvarige
// tilstande). Derfor er alderen nu kun FØRSTE af TO betingelser — anden er
// "rytteren er ikke længere i et aktivt fleretape-løb", se runOwnershipInvariantWatch.
// Målt mod riders.updated_at, som
// #3330 nu stemples eksplicit ved HVER parkering (squadEnforcement.js,
// transferExecution.js, auctionFinalization.js — se deres #3330-kommentarer) —
// riders har ingen auto-touch-trigger, så uden den eksplicitte stempling ville
// updated_at bare være row-creation-tidspunktet og gøre denne invariant enten
// altid eller aldrig sand. En LEGACY parkeret række (stemplet FØR denne PR,
// fx Vasco selv) har en gammel updated_at og fanges derfor korrekt af samme
// tærskel uden nogen data-reparation.
export const PENDING_TRANSFER_STALE_HOURS = 48;

// CYCLINGZONE-4M (22/8): invariant A/B er TOCTOU-følsomme, fordi vagten læser
// auktioner og ryttere i TO separate, ikke-atomiske queries — og fordi
// auctionFinalization SKRIVER RYTTEREN FØR den lukker auktionen.
// tryPlaceYouthWinnerOnSenior sætter riders.team_id (auctionFinalization.js
// ~l.427) og først EFTER clearFutureRaceEntries + closeTransferListings +
// rider_ownership_events + debit + XP + Discord-DM til vinderen + DM til alle
// tabende budgivere kalder den closeAuction (~l.590). I hele den hale — som
// indeholder netværkskald og derfor let varer sekunder — er "ungdomsauktion er
// stadig active OG rytteren er hold-ejet" TRANSIENT SAND ved design.
// Prod-evidens: auktion 7ac6f845 (Jakob Sørensen) finaliserede 14:00:25.288;
// rytterens ejerskab landede 14:00:26.045, ownership-event 14:00:26.305,
// debiten 14:00:26.431 — og vagtens boot-run alarmerede 14:00:26.979, altså
// midt i halen. Data var HELE VEJEN korrekte: ét ejerskabsevent, én debit,
// ingen dobbeltbetaling. Alarmen var ren støj.
// Samme lektie som CYCLINGZONE-31/CYCLINGZONE-48: en vagt der alarmerer på en
// lovlig, forbigående tilstand bliver ignoreret og mister sin værdi.
// FIX: alarmér aldrig på FØRSTE observation af A/B. Vent SETTLE og genlæs BÅDE
// auktions-status og rytter-ejerskab; kun rækker hvor begge stadig holder er
// ægte brud. Et RIGTIGT brud er en persistent tilstand og overlever genlæsningen
// uændret — en finaliserings-hale gør ikke. Koster kun noget når der FAKTISK er
// et fund (dvs. stort set aldrig), så den daglige 0-fund-tick er uændret.
export const RECHECK_SETTLE_MS = 15_000;

// Alle aktive/extended auktioner — begge invariant A og B læser fra samme
// bagvedliggende population, så vi henter den én gang.
async function fetchActiveAuctions(supabase) {
  return fetchAllRows(() =>
    supabase
      .from("auctions")
      .select("id, rider_id, is_youth, seller_team_id, status")
      .in("status", ["active", "extended"])
      .order("id"));
}

// CYCLINGZONE-4M: genlæs NETOP de auktioner der så ud til at bryde A/B, så vi
// kan se om de imens er lukket (= finaliserings-hale, ikke brud). Chunked af
// samme grund som fetchRidersOwnership. Bemærk at der IKKE filtreres på status
// her — vi vil netop kunne SE en status der har ændret sig.
async function fetchAuctionsByIds(supabase, auctionIds) {
  const byId = new Map();
  for (let i = 0; i < auctionIds.length; i += CHUNK) {
    const chunk = auctionIds.slice(i, i + CHUNK);
    const rows = await fetchAllRows(() =>
      supabase
        .from("auctions")
        .select("id, rider_id, is_youth, seller_team_id, status")
        .in("id", chunk)
        .order("id"));
    for (const a of rows) byId.set(a.id, a);
  }
  return byId;
}

// Rytter-ejerskab for et sæt rytter-id'er, chunked (.in() kan ramme 1000-
// loftet på en stor population, samme forsvar som academyIntakeReconcile.js).
async function fetchRidersOwnership(supabase, riderIds) {
  const byId = new Map();
  for (let i = 0; i < riderIds.length; i += CHUNK) {
    const chunk = riderIds.slice(i, i + CHUNK);
    const rows = await fetchAllRows(() =>
      supabase
        .from("riders")
        .select("id, team_id, pending_team_id")
        .in("id", chunk)
        .order("id"));
    for (const r of rows) byId.set(r.id, r);
  }
  return byId;
}

// Invariant F (#4664): menneskehold uden bestyrelsesmedlemmer. Rod-årsag:
// regenerateBoardMembersForTeam (boardMembers.js) slettede tidligere et holds
// team_board_members-rækker FØR den indsatte det nye sæt — to separate,
// ikke-transaktionelle Supabase-kald. Fejlede insert'et efter delete'et var
// committet, stod holdet permanent uden bestyrelse (DNA forbliver sat, så
// DNA-vælgeren — den eneste sti der (gen)tildeler — aldrig vises igen). Fixet
// (regenerateBoardMembersForTeam gendanner nu det gamle sæt best-effort hvis
// re-insert fejler); DENNE vagt er backstoppet for hvis den klasse alligevel
// opstår igen, eller hvis en ny oprettelses-/genforhandlings-sti springer
// tildelingen over. Reparerer INTET — alarmerer. Backfill: repairMissingBoardMembers.js.
//
// Scopet til hold der reelt SKAL have en bestyrelse: menneske- (ikke AI/bank),
// ikke-testkonto, ikke-frosne hold, hvor season_1_identity_basis er sat (dvs.
// holdet er forbi holddannelsens synkrone identitets-trin — se
// teamProfileEngine.js ensureSeasonIdentityBasis). Et helt nyt hold der endnu
// ikke har fået identity_basis er en transient millisekund-tilstand midt i
// signup, ikke et invariant-brud.
async function fetchHumanTeamsMissingBoardMembers(supabase) {
  const teams = await fetchAllRows(() =>
    supabase
      .from("teams")
      .select("id, name, season_1_identity_basis, team_dna_key")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false)
      .not("season_1_identity_basis", "is", null)
      .order("id"));

  if (teams.length === 0) return [];

  const memberCounts = new Map();
  for (let i = 0; i < teams.length; i += CHUNK) {
    const chunk = teams.slice(i, i + CHUNK);
    const rows = await fetchAllRows(() =>
      supabase
        .from("team_board_members")
        .select("team_id")
        .in("team_id", chunk.map((t) => t.id))
        .order("team_id"));
    for (const row of rows) {
      memberCounts.set(row.team_id, (memberCounts.get(row.team_id) || 0) + 1);
    }
  }

  return teams.filter((t) => (memberCounts.get(t.id) || 0) < TEAM_BOARD_MEMBERS_COUNT);
}

// Invariant D (#2257): strandede akademi-fri-agenter. Server-side filtreret —
// populationen forventes tom, så queryen er billig hver dag.
async function fetchStrandedAcademyFreeAgents(supabase) {
  return fetchAllRows(() =>
    supabase
      .from("riders")
      .select("id, firstname, lastname, contract_end_season, acquired_at")
      .eq("is_academy", true)
      .eq("is_retired", false)
      .is("team_id", null)
      .is("ai_team_id", null)
      .is("pending_team_id", null)
      .order("id"));
}

// Invariant E (#3330): alle parkerede holdskifter (pending_team_id NOT NULL).
// Server-side filtreret på pending_team_id (billig — kun 0-nogle-få rækker
// forventet i praksis); ALDER afgøres af kalderen (runOwnershipInvariantWatch)
// mod et Date-parset updated_at, ikke ved streng-sammenligning — Postgres/
// PostgREST's timestamp-format ("2026-06-22 13:48:45.599546+00") matcher ikke
// nødvendigvis en JS toISOString()-cutoff byte-for-byte.
async function fetchAllPendingTransfers(supabase) {
  return fetchAllRows(() =>
    supabase
      .from("riders")
      .select("id, firstname, lastname, team_id, pending_team_id, updated_at")
      .not("pending_team_id", "is", null)
      .order("id"));
}

// Fail-closed: en række uden (parsebar) updated_at har UKENDT alder, ikke en
// legitim frisk parkering — tæller derfor som stale. riders.updated_at er i
// praksis altid sat (DEFAULT now() ved row-creation), så dette rammer kun en
// teoretisk NULL/korrupt værdi, men fail-closed er den sikre retning her.
function pendingTransferAgeMs(rider, now) {
  const setAt = rider.updated_at ? new Date(rider.updated_at).getTime() : NaN;
  if (Number.isNaN(setAt)) return Infinity;
  return now.getTime() - setAt;
}

function isOwned(ridersById, riderId) {
  const rider = ridersById.get(riderId);
  if (!rider) return false;
  return rider.team_id != null || rider.pending_team_id != null;
}

// CYCLINGZONE-4M: bekræft et A/B-fund efter SETTLE. Et fund overlever kun hvis
// BEGGE ben stadig holder ved genlæsningen: auktionen er fortsat active/extended
// OG rytteren er fortsat hold-ejet. Falder ét af dem bort, var vi midt i
// auctionFinalizations hale (rytter skrevet, auktion endnu ikke lukket) — altså
// en lovlig, forbigående tilstand, ikke et invariant-brud.
//
// Returnerer BÅDE de bekræftede auktioner og et opdateret rytter-map, så
// Sentry-samplet viser ejerskabet som det ser ud EFTER genlæsningen (ellers
// ville vi rapportere et team_id der nåede at ændre sig).
async function confirmAuctionBreaches({ supabase, auctions, sleepFn, settleMs }) {
  if (auctions.length === 0) return { confirmed: [], ridersById: new Map() };

  await sleepFn(settleMs);

  const freshAuctions = await fetchAuctionsByIds(supabase, auctions.map((a) => a.id));
  const stillOpen = auctions.filter((a) =>
    ["active", "extended"].includes(freshAuctions.get(a.id)?.status)
  );
  if (stillOpen.length === 0) return { confirmed: [], ridersById: new Map() };

  const freshRiders = await fetchRidersOwnership(
    supabase,
    [...new Set(stillOpen.map((a) => a.rider_id))]
  );
  return {
    confirmed: stillOpen.filter((a) => isOwned(freshRiders, a.rider_id)),
    ridersById: freshRiders,
  };
}

function auctionFindingSample(auctions, ridersById) {
  return auctions.slice(0, SAMPLE_LIMIT).map((a) => {
    const rider = ridersById.get(a.rider_id) || {};
    return {
      auctionId: a.id,
      riderId: a.rider_id,
      teamId: rider.team_id ?? null,
      pendingTeamId: rider.pending_team_id ?? null,
    };
  });
}

/**
 * Kør de fem ownership-invariant-tjek. Pure I/O + notify — INGEN writes.
 *
 * @param {object}   args
 * @param {object}   args.supabase
 * @param {(err:Error, ctx:object) => void} [args.captureExceptionFn]
 * @param {Date}     [args.now]  DI-hook — bruges nu af invariant E (#3330) til
 *                                pending-transfer-alderstjekket; de øvrige fire
 *                                tjek forbliver nutids-øjebliksbilleder.
 * @param {number}   [args.pendingTransferStaleHours] override af PENDING_TRANSFER_STALE_HOURS (tests).
 * @param {(supabase:object, riderIds:string[]) => Promise<string[]>} [args.getRidersInActiveStageRaceFn]
 *        DI-hook (CYCLINGZONE-48) — invariant E's andet kriterie. Default er den
 *        ÆGTE getRidersInActiveStageRace, dvs. samme diskriminator som heal-sweepen.
 * @param {number}   [args.recheckSettleMs] override af RECHECK_SETTLE_MS (tests).
 * @param {(ms:number) => Promise<void>} [args.sleepFn] DI-hook (CYCLINGZONE-4M) —
 *        settle-ventetiden før A/B genlæses. Stubbes i tests, så suiten ikke
 *        bruger 15 sekunder på at bevise en race.
 * @returns {Promise<{checked:number, findings:{youthOwned:number, sellerlessOwned:number, staleIntake:number, strandedAcademy:number, stalePendingTransfer:number}, alerted:boolean}>}
 */
export async function runOwnershipInvariantWatch({
  supabase,
  captureExceptionFn,
  now = new Date(),
  pendingTransferStaleHours = PENDING_TRANSFER_STALE_HOURS,
  getRidersInActiveStageRaceFn = getRidersInActiveStageRace,
  recheckSettleMs = RECHECK_SETTLE_MS,
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const activeAuctions = await fetchActiveAuctions(supabase);
  const youthAuctions = activeAuctions.filter((a) => a.is_youth === true);
  const sellerlessAuctions = activeAuctions.filter(
    (a) => a.is_youth === false && a.seller_team_id == null
  );

  const riderIds = [
    ...new Set([...youthAuctions, ...sellerlessAuctions].map((a) => a.rider_id)),
  ];
  const ridersById = await fetchRidersOwnership(supabase, riderIds);

  // FØRSTE observation — endnu IKKE et brud. CYCLINGZONE-4M: A/B skal bekræftes
  // efter settle, ellers alarmerer vi på auctionFinalizations hale (se
  // RECHECK_SETTLE_MS). Genlæsningen kører kun når der er noget at bekræfte.
  const youthSuspects = youthAuctions.filter((a) => isOwned(ridersById, a.rider_id));
  const sellerlessSuspects = sellerlessAuctions.filter((a) => isOwned(ridersById, a.rider_id));

  const youthConfirm = await confirmAuctionBreaches({
    supabase, auctions: youthSuspects, sleepFn, settleMs: recheckSettleMs,
  });
  // Sælgerløse fund er allerede settlet af ovenstående vent når begge er sat;
  // er kun B brudt, betaler vi ventetiden her i stedet. Ingen af delene rammer
  // den normale 0-fund-tick.
  const sellerlessConfirm = await confirmAuctionBreaches({
    supabase,
    auctions: sellerlessSuspects,
    sleepFn: youthSuspects.length > 0 ? async () => {} : sleepFn,
    settleMs: recheckSettleMs,
  });

  const youthOwned = youthConfirm.confirmed;
  const sellerlessOwned = sellerlessConfirm.confirmed;
  // Samplet skal vise ejerskabet EFTER genlæsningen, jf. confirmAuctionBreaches.
  const sampleRiders = new Map([
    ...youthConfirm.ridersById,
    ...sellerlessConfirm.ridersById,
  ]);
  const staleIntake = await findStaleOfferedIntake(supabase);
  const strandedAcademy = await fetchStrandedAcademyFreeAgents(supabase);

  // Invariant E (#3330): pending_team_id parkeret længere end den konservative
  // grænse — se PENDING_TRANSFER_STALE_HOURS for begrundelsen af tærsklen.
  //
  // CYCLINGZONE-48 (8/8): alder alene gav falske positiver. En parkering er
  // LOVLIG så længe rytteren stadig er i et aktivt fleretape-løb — uanset hvor
  // længe det løb tager — fordi flushen først kan køre ved løbs-finalisering
  // (#1995). Vi bruger derfor SAMME diskriminator som heal-sweepen selv
  // (deferredTransferHealSweep.js → getRidersInActiveStageRace): et brud er
  // "gammel parkering MEN løbet er ovre", altså præcis den tilstand hvor
  // heal-sweepen burde have repareret rytteren og ikke gjorde det. Det gør
  // vagten til et ægte backstop for en fejlende heal-sweep i stedet for en
  // wall-clock-timer på lovlige, langvarige løb. Vasco-klassen (parkeret 40+
  // dage, intet aktivt løb) fanges uændret.
  const pendingStaleMs = pendingTransferStaleHours * 60 * 60 * 1000;
  const allPending = await fetchAllPendingTransfers(supabase);
  const agedPending = allPending.filter(
    (r) => pendingTransferAgeMs(r, now) > pendingStaleMs
  );
  // Kun slå op når der FAKTISK er alders-kandidater — vagten kører dagligt og
  // skal ikke koste to ekstra queries på den normale 0-kandidat-tick.
  const stillRacingIds = agedPending.length
    ? new Set(await getRidersInActiveStageRaceFn(supabase, agedPending.map((r) => r.id)))
    : new Set();
  const stalePendingTransfer = agedPending.filter((r) => !stillRacingIds.has(r.id));

  // Invariant F (#4664): menneskehold uden bestyrelsesmedlemmer.
  const teamsMissingBoardMembers = await fetchHumanTeamsMissingBoardMembers(supabase);

  let alerted = false;

  if (youthOwned.length > 0) {
    alerted = true;
    captureExceptionFn?.(
      new Error(
        `Ownership-invariant-brud: ${youthOwned.length} hold-ejet rytter på aktiv ungdomsauktion (#2647)`
      ),
      {
        tags: { cron: "ownership-invariant-watch" },
        fingerprint: ["owned-rider-on-youth-auction"],
        extra: { count: youthOwned.length, sample: auctionFindingSample(youthOwned, sampleRiders) },
      }
    );
  }

  if (sellerlessOwned.length > 0) {
    alerted = true;
    captureExceptionFn?.(
      new Error(
        `Ownership-invariant-brud: ${sellerlessOwned.length} hold-ejet rytter på sælgerløs auktion (#2647)`
      ),
      {
        tags: { cron: "ownership-invariant-watch" },
        fingerprint: ["owned-rider-on-sellerless-auction"],
        extra: { count: sellerlessOwned.length, sample: auctionFindingSample(sellerlessOwned, sampleRiders) },
      }
    );
  }

  if (staleIntake.length > 0) {
    alerted = true;
    captureExceptionFn?.(
      new Error(
        `Ownership-invariant-brud: ${staleIntake.length} stale 'offered' intake-række for ejet rytter (#2647)`
      ),
      {
        tags: { cron: "ownership-invariant-watch" },
        fingerprint: ["stale-offered-intake-owned-rider"],
        extra: { count: staleIntake.length, sample: staleIntake.slice(0, SAMPLE_LIMIT) },
      }
    );
  }

  if (strandedAcademy.length > 0) {
    alerted = true;
    captureExceptionFn?.(
      new Error(
        `Ownership-invariant-brud: ${strandedAcademy.length} strandet akademi-fri-agent (is_academy uden tilhørsforhold) (#2257)`
      ),
      {
        tags: { cron: "ownership-invariant-watch" },
        fingerprint: ["stranded-academy-free-agent"],
        extra: { count: strandedAcademy.length, sample: strandedAcademy.slice(0, SAMPLE_LIMIT) },
      }
    );
  }

  if (stalePendingTransfer.length > 0) {
    alerted = true;
    captureExceptionFn?.(
      new Error(
        `Ownership-invariant-brud: ${stalePendingTransfer.length} rytter med pending_team_id parkeret > ${pendingTransferStaleHours}t UDEN aktivt etapeløb (#3330)`
      ),
      {
        tags: { cron: "ownership-invariant-watch" },
        fingerprint: ["stale-pending-team-id-transfer"],
        extra: {
          count: stalePendingTransfer.length,
          sample: stalePendingTransfer.slice(0, SAMPLE_LIMIT).map((r) => ({
            riderId: r.id,
            teamId: r.team_id ?? null,
            pendingTeamId: r.pending_team_id,
            updatedAt: r.updated_at ?? null,
          })),
        },
      }
    );
  }

  if (teamsMissingBoardMembers.length > 0) {
    alerted = true;
    captureExceptionFn?.(
      new Error(
        `Ownership-invariant-brud: ${teamsMissingBoardMembers.length} menneskehold uden ${TEAM_BOARD_MEMBERS_COUNT} bestyrelsesmedlemmer (#4664)`
      ),
      {
        tags: { cron: "ownership-invariant-watch" },
        fingerprint: ["human-team-without-board-members"],
        extra: {
          count: teamsMissingBoardMembers.length,
          sample: teamsMissingBoardMembers.slice(0, SAMPLE_LIMIT).map((t) => ({
            teamId: t.id,
            name: t.name,
            teamDnaKey: t.team_dna_key ?? null,
          })),
        },
      }
    );
  }

  return {
    checked: activeAuctions.length,
    findings: {
      youthOwned: youthOwned.length,
      sellerlessOwned: sellerlessOwned.length,
      staleIntake: staleIntake.length,
      strandedAcademy: strandedAcademy.length,
      stalePendingTransfer: stalePendingTransfer.length,
      teamsMissingBoardMembers: teamsMissingBoardMembers.length,
    },
    alerted,
  };
}
