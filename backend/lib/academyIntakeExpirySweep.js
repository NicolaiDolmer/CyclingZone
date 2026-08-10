// backend/lib/academyIntakeExpirySweep.js
// #2627 — akademi-intake-tilbud udløber efter 7 dage; udløbne (team-løse) ryttere
// listes på 24-timers ungdomsauktion, drypvis. Se PR #2638 for baggrund/empiri.
//
// ⚠️ HÆNDELSE 18/7 (postmortem: 2026-07-18-intake-expiry-auctioned-owned-riders):
// Første version stolede på academy_intake.status='offered' som bevis for at
// rytteren var fri. FALSK: der findes FORÆLDEDE 'offered'-rækker hvis rytter
// siden er blevet ejet ad andre veje (#1756-reconcile-problemet) — 16 EJEDE
// ryttere (menneske-hold) blev sat på auktion. Auktionerne blev annulleret før
// bud; rækkerne afstemt. Lærdommen er kodificeret her i tre lag:
//
//   1. EJERSKABS-TJEK: kandidatens rytter SKAL være team-løs (team_id IS NULL)
//      og uden parkeret skifte (pending_team_id IS NULL) for at blive udløbet+
//      auktioneret. Forældede rækker med EJEDE ryttere udløbes ALDRIG — de
//      AFSTEMMES i stedet (samme regel som academyIntakeReconcile/#1756:
//      rider.team_id == intake.team_id → 'signed', ellers → 'rejected').
//   2. DAGSKVOTE, ikke pr.-boot-kvote: boot-run + genstarter/replicas gav 2×30
//      på én dag (Railway bootede to gange ved deploy 18/7). Kvoten tæller nu
//      allerede-udløbne i det rullende døgn og tager kun resten.
//   3. Defense-in-depth i youthMarket.listRejectedAsYouthAuction: nægter
//      hårdt at auktionere en rytter med team_id/pending_team_id sat.
//
// Flag intake_offer_expiry_enabled er fail-safe OFF og blev slukket under
// hændelsen — GEN-TÆNDING ER EJER-ONLY (jf. husreglen om live-systemer).
//
// #2648 (intake-udløb v2, ejer-beslutning 18/7): stemples HER, i selve
// udvælgelsen af ejerskabs-verificerede team-løse kandidater (efter lag 1
// ovenfor), hvilken manager der modtog netop den udløbne intake-rækkes
// tilbud — expiredIntakeTeamId videregives til youthMarket.listRejectedAsYouthAuction,
// som stempler den PÅ selve auktionsrækken (expired_intake_team_id). Sælges
// rytteren siden, krediteres salgssummen den manager (auctionFinalization.
// finalizeYouthAuctionRecord) — kompensation for inaktivitet. rejectAcademyCandidate
// (manager-initieret afvisning, IKKE udløb) kalder samme funktion UDEN denne
// parameter og udløser derfor aldrig kreditering.
import { isIntakeOfferExpiryEnabled } from "./academyIntakeExpiryFlag.js";
import { listRejectedAsYouthAuction } from "./youthMarket.js";

export const INTAKE_OFFER_EXPIRY_DAYS = 7;
export const INTAKE_EXPIRY_AUCTION_DURATION_HOURS = 24;

// ── Dagskvote (ejer-godkendt 10/8) ───────────────────────────────────────────
// Kvoten stod på 30/dag og var STRUKTURELT for lav: målt 10/8 kommer der ~345 nye
// tilbud om ugen (søndags-drip 192 hold × 2 + signups), hvoraf managerne kun
// besvarer ~45. De resterende ~300 skal udløbe — altså 43/dag — mod en kapacitet
// på 210/uge. Køen voksede derfor ~90/uge af sig selv: 327 af 368 ventende tilbud
// var over 7-dages-grænsen, det ældste fra 25/7, og sweep'en havde kørt 30/30
// hver eneste dag siden 1/8.
//
// STEADY dækker den normale tilgang med lidt luft. CATCHUP bruges så længe der er
// et efterslæb, så en pukkel (fx kompensations-kuldets 762 ekstra tilbud, #3576)
// afvikles i stedet for at lægge sig oven i køen permanent.
//
// Hvorfor adaptiv og ikke "sæt 60 nu, husk at sænke til 45 om en måned": ingen
// husker det. Kvoten læser efterslæbet ved hver kørsel og falder selv tilbage til
// STEADY når puklen er væk — samme princip som FLAG_GATED_EMPTY_TABLES i
// audit-feature-liveness.js, hvor en selv-korrigerende regel afløste en statisk
// liste nogen skulle vedligeholde.
//
// Prisen ved at hæve: udløbne tilbud bliver til 24-timers ungdomsauktioner, og det
// marked er allerede mættet — budprocenten faldt fra 53-82 % (ved 17 udløb/dag i
// juli) til 20-30 % ved 30/dag, og ungdomsauktioner udgør pt. 30 af 31 aktive
// auktioner. Flere udløb betyder derfor flere USOLGTE. Det er acceptabelt, fordi en
// usolgt ungdomsrytter bliver fri agent og dermed synlig på markedet, i stedet for
// at ligge skjult i et akademi-tilbud ingen svarer på. Går budprocenten under ~15 %,
// er det signalet om at udbuddet — ikke kvoten — er problemet.
export const INTAKE_EXPIRY_STEADY_PER_DAY = 45;
export const INTAKE_EXPIRY_CATCHUP_PER_DAY = 60;
// Over dette antal overmodne tilbud regnes køen som et efterslæb, ikke som normal
// gennemstrømning. ~2 dages steady-kapacitet.
export const INTAKE_EXPIRY_BACKLOG_THRESHOLD = 100;

// Bevaret som eksport: cron-monitor og tests importerer den. Peger nu på
// steady-satsen, så en læser ikke tror kvoten stadig er 30.
export const INTAKE_EXPIRY_MAX_PER_DAY = INTAKE_EXPIRY_STEADY_PER_DAY;

/**
 * Dagens kvote: CATCHUP hvis der er et efterslæb af overmodne tilbud, ellers STEADY.
 * Tæller kun tilbud der FAKTISK er over grænsen — ikke hele køen.
 */
export async function resolveDailyQuota(supabase, cutoffIso) {
  const { count, error } = await supabase
    .from("academy_intake")
    .select("id", { count: "exact", head: true })
    .eq("status", "offered")
    .lt("created_at", cutoffIso);
  if (error) throw new Error(`academy_intake backlog count: ${error.message}`);
  const overdue = count ?? 0;
  return {
    quota: overdue > INTAKE_EXPIRY_BACKLOG_THRESHOLD
      ? INTAKE_EXPIRY_CATCHUP_PER_DAY
      : INTAKE_EXPIRY_STEADY_PER_DAY,
    overdue,
  };
}

export async function runIntakeOfferExpirySweep({
  supabase,
  now = new Date(),
  isEnabled = isIntakeOfferExpiryEnabled,
  listYouthAuctionFn = listRejectedAsYouthAuction,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!(await isEnabled(supabase))) return { ran: false, reason: "flag_off" };

  const cutoffIso = new Date(now.getTime() - INTAKE_OFFER_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const resolvedAtIso = now.toISOString();
  const dayAgoIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // Lag 2 — dagskvote: tæl allerede-udløbne i det rullende døgn, tag kun resten.
  // Gør boot-run + genstarter/replicas budget-neutrale i stedet for additive.
  const { count: expiredToday, error: cntError } = await supabase
    .from("academy_intake")
    .select("id", { count: "exact", head: true })
    .eq("status", "expired")
    .gt("resolved_at", dayAgoIso);
  if (cntError) throw new Error(`academy_intake expiry day-count: ${cntError.message}`);
  // Dagens kvote afhænger af om der er et efterslæb (se konstanterne ovenfor).
  const { quota, overdue } = await resolveDailyQuota(supabase, cutoffIso);
  const budget = quota - (expiredToday ?? 0);
  if (budget <= 0) {
    return { ran: true, expired: 0, auctioned: 0, reconciled: 0, reason: "daily_budget_spent", cutoff: cutoffIso, quota, overdue };
  }

  // Ældste først. Hent budget + buffer, så afstemte (ejede) rækker ikke æder
  // hele udvælgelsen uden at der er team-løse kandidater tilbage.
  const { data: candidates, error: selError } = await supabase
    .from("academy_intake")
    .select("id, rider_id, team_id")
    .eq("status", "offered")
    .lt("created_at", cutoffIso)
    .order("created_at", { ascending: true })
    .limit(budget * 2);
  if (selError) throw new Error(`academy_intake expiry select: ${selError.message}`);
  if (!candidates?.length) return { ran: true, expired: 0, auctioned: 0, reconciled: 0, cutoff: cutoffIso };

  // #2648: candidate.team_id er den manager der MODTOG intake-tilbuddet (kun
  // NOT NULL-feltet på academy_intake-rækken selv) — den mistede rytteren, hvis
  // rytteren viser sig faktisk team-løs nedenfor (lag 1). Stemples på selve
  // auktionsrækken (expired_intake_team_id) som kreditering-target, se
  // youthMarket.listRejectedAsYouthAuction + auctionFinalization.
  const teamIdByCandidateId = new Map(candidates.map((c) => [c.id, c.team_id]));

  // Lag 1 — ejerskabs-sandheden bor på RYTTEREN, ikke på intake-rækken.
  const riderIds = [...new Set(candidates.map((c) => c.rider_id))];
  const { data: riderRows, error: riderError } = await supabase
    .from("riders")
    .select("id, team_id, pending_team_id")
    .in("id", riderIds);
  if (riderError) throw new Error(`academy_intake expiry rider lookup: ${riderError.message}`);
  const riderById = new Map((riderRows ?? []).map((r) => [r.id, r]));

  const freeCandidates = [];
  const staleOwned = [];
  for (const c of candidates) {
    const rider = riderById.get(c.rider_id);
    if (!rider) continue; // rytter slettet — reconcile-sweepet (#1756) ejer den klasse
    if (rider.team_id === null && rider.pending_team_id === null) {
      if (freeCandidates.length < budget) freeCandidates.push(c);
    } else {
      staleOwned.push({ ...c, riderTeamId: rider.team_id });
    }
  }

  // Forældede rækker med ejede ryttere: AFSTEM (aldrig udløb/auktion) — #1756-reglen.
  let reconciled = 0;
  for (const row of staleOwned) {
    const targetStatus = row.riderTeamId === row.team_id ? "signed" : "rejected";
    const { error: recError } = await supabase
      .from("academy_intake")
      .update({ status: targetStatus, resolved_at: resolvedAtIso })
      .eq("id", row.id)
      .eq("status", "offered");
    if (recError) throw new Error(`academy_intake stale reconcile: ${recError.message}`);
    reconciled += 1;
  }

  if (!freeCandidates.length) {
    return { ran: true, expired: 0, auctioned: 0, reconciled, cutoff: cutoffIso };
  }

  // Status-flip for team-løse — .eq(status,'offered') er re-guarden mod samtidigt sign/reject.
  const { data: flipped, error: updError } = await supabase
    .from("academy_intake")
    .update({ status: "expired", resolved_at: resolvedAtIso })
    .in("id", freeCandidates.map((c) => c.id))
    .eq("status", "offered")
    .select("id, rider_id");
  if (updError) throw new Error(`academy_intake expiry update: ${updError.message}`);

  // 24h-ungdomsauktion pr. udløbet rytter (lag 3-guarden i youthMarket dobbelt-tjekker ejerskab).
  let auctioned = 0;
  const auctionErrors = [];
  for (const row of flipped ?? []) {
    try {
      const auction = await listYouthAuctionFn(supabase, {
        riderId: row.rider_id,
        now,
        durationHours: INTAKE_EXPIRY_AUCTION_DURATION_HOURS,
        // #2648: kompensations-target — udelukkende den manager der modtog
        // NETOP DENNE intake-rækkes tilbud (allerede ejerskabs-verificeret ovenfor).
        expiredIntakeTeamId: teamIdByCandidateId.get(row.id) ?? null,
      });
      if (auction) auctioned += 1;
    } catch (e) {
      // best-effort: én fejlet auktions-listning må ikke vælte resten af batchen —
      // fejlen SLUGES ikke reelt: den samles i auctionErrors, som returneres til
      // cron-handleren og dermed lander i Railway-loggen/Sentry-cron-monitoren.
      auctionErrors.push(`${row.rider_id}: ${e?.message ?? e}`);
    }
  }

  return {
    ran: true,
    expired: flipped?.length ?? 0,
    auctioned,
    reconciled,
    ...(auctionErrors.length ? { auctionErrors } : {}),
    cutoff: cutoffIso,
    // Med i svaret så cron-loggen viser HVILKEN kvote der var i brug og hvor stort
    // efterslæbet var — ellers kan man ikke se om sweep'en er i indhentning eller
    // normal drift uden at forespørge databasen selv.
    quota,
    overdue,
  };
}
