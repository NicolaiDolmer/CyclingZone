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
export const INTAKE_EXPIRY_MAX_PER_DAY = 30;

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
  const budget = INTAKE_EXPIRY_MAX_PER_DAY - (expiredToday ?? 0);
  if (budget <= 0) {
    return { ran: true, expired: 0, auctioned: 0, reconciled: 0, reason: "daily_budget_spent", cutoff: cutoffIso };
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
  };
}
