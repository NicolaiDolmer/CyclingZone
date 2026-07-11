/**
 * Cycling Zone — Loan Engine
 * Håndterer lån: oprettelse, ratebetaling, nødlån ved manglende løn, sæsonrenter.
 *
 * Slice 07c: alle balance-mutationer går nu via increment_balance_with_audit-RPC
 * (database/2026-05-09-balance-rpc.sql) — atomic UPDATE+INSERT i én DB-transaktion
 * pr. team. Eliminerer lost-update-races mellem concurrent calls på samme team.
 */
import { computeWorstCaseCommitment } from "./auctionRules.js";
import { notifyTeamOwner as notifyTeamOwnerShared } from "./notificationService.js";
import { incrementBalanceWithAudit } from "./balanceRpc.js";
import {
  FINANCE_ACTOR_TYPE,
  FINANCE_REASON,
  FINANCE_RELATED_ENTITY,
} from "./economyConstants.js";

// #44: hent manager's worst-case commitment fra aktive auktioner (leading +
// proxies). Bruges af repayLoan + andre lån-paths så manageren ikke kan betale
// gæld med penge der er låst i bud.
async function fetchTeamCommitment(client, teamId) {
  if (!teamId) return 0;
  const [leadingRes, proxiesRes] = await Promise.all([
    client
      .from("auctions")
      .select("id, current_price")
      .in("status", ["active", "extended"])
      .eq("current_bidder_id", teamId),
    client
      .from("auction_proxy_bids")
      .select("auction_id, max_amount, auction:auction_id(status)")
      .eq("team_id", teamId),
  ]);

  const leadingAuctions = leadingRes.data || [];
  const allMyProxies = (proxiesRes.data || [])
    .filter((row) => ["active", "extended"].includes(row.auction?.status))
    .map((row) => ({ auction_id: row.auction_id, max_amount: row.max_amount }));

  return computeWorstCaseCommitment({ leadingAuctions, allMyProxies });
}

let defaultSupabaseClientPromise;

async function getDefaultSupabaseClient() {
  if (!defaultSupabaseClientPromise) {
    defaultSupabaseClientPromise = import("@supabase/supabase-js").then(({ createClient }) => (
      createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    ));
  }

  return defaultSupabaseClientPromise;
}

// 07d Fase B / #240: Slå aktiv sæson op, så api-callsites til createLoan/repayLoan
// kan stamp'e season_id eksplicit i payload. DB-trigger fill_finance_tx_season()
// er en safety-net, men callsites skal være selv-dokumenterende.
async function fetchActiveSeasonId(client) {
  const { data } = await client
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

// ── Konfiguration ─────────────────────────────────────────────────────────────

export async function getLoanConfig(teamId, supabaseClient = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  const { data: team } = await client.from("teams").select("division").eq("id", teamId).single();
  const { data: configs } = await client.from("loan_config").select("*").eq("division", team.division);
  return configs || [];
}

export async function getTotalDebt(teamId, supabaseClient = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  const { data: loans } = await client
    .from("loans")
    .select("amount_remaining")
    .eq("team_id", teamId)
    .eq("status", "active");
  return (loans || []).reduce((sum, l) => sum + l.amount_remaining, 0);
}

// ── Gebyr + max-lånbart (delt formel — #1012) ─────────────────────────────────
//
// computeLoanFee + computeMaxLoanPrincipal er den ENESTE kilde til gebyr- og
// loft-matematikken. Både createLoan/createEmergencyLoan (validering) og
// GET /api/finance/loans (UI'ets "max lånbart") bruger samme funktioner, så
// det viste max aldrig kan drifte fra serverens faktiske afvisningsgrænse.

export function computeLoanFee(principalAmount, originationFeePct) {
  return Math.round(principalAmount * (originationFeePct || 0));
}

/**
 * Max principal et hold kan låne lige nu, givet at gebyret lægges oveni gælden:
 * størst mulige P hvor currentDebt + P + computeLoanFee(P) <= debtCeiling.
 * Samme grænse som createLoans loft-tjek (inkl. Math.round-afrunding af gebyret).
 *
 * @returns {{ principal: number, fee: number, totalDebt: number, headroom: number }|null}
 *   null hvis der ikke er konfigureret et gældsloft (ubegrænset).
 */
export function computeMaxLoanPrincipal({ currentDebt, debtCeiling, originationFeePct }) {
  if (debtCeiling == null) return null;
  const headroom = Math.max(0, debtCeiling - (currentDebt || 0));
  const feePct = originationFeePct || 0;
  // Startgæt uden afrunding; justér derefter for Math.round i computeLoanFee.
  let principal = Math.max(0, Math.floor(headroom / (1 + feePct)));
  while (principal > 0 && principal + computeLoanFee(principal, feePct) > headroom) {
    principal -= 1;
  }
  while (principal + 1 + computeLoanFee(principal + 1, feePct) <= headroom) {
    principal += 1;
  }
  const fee = computeLoanFee(principal, feePct);
  return { principal, fee, totalDebt: principal + fee, headroom };
}

// ── Opret lån (manager-initieret: short eller long) ───────────────────────────

export async function createLoan(teamId, loanType, principalAmount, supabaseClient = null, auditCtx = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  const configs = await getLoanConfig(teamId, client);
  const config = configs.find(c => c.loan_type === loanType);
  if (!config) throw new Error("Ugyldig låntype");

  const fee = computeLoanFee(principalAmount, config.origination_fee_pct);
  const totalOwed = principalAmount + fee;

  // Slice 07b · TOCTOU-fix: brug create_loan_atomic Postgres-RPC når tilgængelig.
  // RPC'en serialiserer concurrent calls på samme team_id via pg_advisory_xact_lock
  // og fanger ceiling-overskridelser i samme transaktion som INSERT'en.
  // Falder tilbage til app-niveau check hvis RPC ikke findes (legacy/test-mocks).
  let loan;
  if (typeof client.rpc === "function") {
    const { data: rpcLoan, error: rpcError } = await client.rpc("create_loan_atomic", {
      p_team_id: teamId,
      p_loan_type: loanType,
      p_principal: principalAmount,
      p_origination_fee: fee,
      p_interest_rate: config.interest_rate_pct,
      p_seasons: config.seasons,
      p_debt_ceiling: config.debt_ceiling,
    });
    if (rpcError) {
      if (rpcError.code === "check_violation" || /Gældsloft/.test(rpcError.message || "")) {
        {
        const err = new Error(`Debt cap of ${config.debt_ceiling} CZ$ reached for this division`);
        err.code = "error.debtCapReached";
        err.params = { ceiling: config.debt_ceiling };
        throw err;
      }
      }
      // PostgREST returnerer 404 (PGRST202) hvis funktionen mangler — fald tilbage.
      if (rpcError.code !== "PGRST202" && !/function .* does not exist/i.test(rpcError.message || "")) {
        throw rpcError;
      }
    } else if (rpcLoan) {
      loan = Array.isArray(rpcLoan) ? rpcLoan[0] : rpcLoan;
    }
  }

  if (!loan) {
    const currentDebt = await getTotalDebt(teamId, client);
    if (currentDebt + totalOwed > config.debt_ceiling) {
      {
        const err = new Error(`Debt cap of ${config.debt_ceiling} CZ$ reached for this division`);
        err.code = "error.debtCapReached";
        err.params = { ceiling: config.debt_ceiling };
        throw err;
      }
    }

    const { data: insertedLoan, error } = await client.from("loans").insert({
      team_id: teamId,
      loan_type: loanType,
      principal: principalAmount,
      origination_fee: fee,
      interest_rate: config.interest_rate_pct,
      seasons_total: config.seasons,
      seasons_remaining: config.seasons,
      amount_remaining: totalOwed,
      status: "active",
    }).select().single();

    if (error) throw error;
    loan = insertedLoan;
  }

  const activeSeasonId = await fetchActiveSeasonId(client);
  await incrementBalanceWithAudit(client, {
    teamId,
    delta: principalAmount,
    payload: {
      type: "loan_received",
      amount: principalAmount,
      description: null,
      season_id: activeSeasonId,
      actor_type: auditCtx?.actorType || FINANCE_ACTOR_TYPE.API,
      actor_id: auditCtx?.actorId || null,
      source_path: "loanEngine.createLoan",
      reason_code: FINANCE_REASON.LOAN_PRINCIPAL_RECEIVED,
      related_entity_type: FINANCE_RELATED_ENTITY.LOAN,
      related_entity_id: loan.id,
      metadata: {
        code: loanType === "short" ? "tx.loanReceivedShort" : "tx.loanReceivedLong",
        params: { fee },
      },
    },
  });

  await notifyManager(teamId, "loan_created",
    "Loan created",
    `You took out a ${loanType === "short" ? "short-term" : "long-term"} loan of ${principalAmount} CZ$. Fee: ${fee} CZ$. Total repayment: ${totalOwed} CZ$.`,
    client,
    {
      titleCode: loanType === "short" ? "notif.loanCreatedShort.title" : "notif.loanCreatedLong.title",
      titleParams: {},
      messageCode: loanType === "short" ? "notif.loanCreatedShort.message" : "notif.loanCreatedLong.message",
      messageParams: { principal: principalAmount, fee, totalOwed },
    }
  );

  return loan;
}

// ── Nødlån — oprettes automatisk hvis holdet ikke kan betale løn ───────────────

export async function createEmergencyLoan(teamId, amountNeeded, supabaseClient = null, seasonId = null, auditCtx = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();

  // #2301 · App-guard: maks ét emergency-lån pr. (team, season). Tjekkes FØR
  // config/RPC/balance-kreditering — cron-genkørsel af season-start (fx løn
  // sprunget over pga. idempotent debitTeam, men balance stadig < løn) må
  // IKKE udstede et nyt lån oveni. No-op: returnér det eksisterende lån.
  // Kun håndhævet når seasonId er kendt — ældre/manuelle call-sites uden
  // seasonId falder tilbage til gammel adfærd (ingen per-sæson-nøgle at tjekke mod).
  if (seasonId) {
    const { data: existingLoan, error: existingError } = await client
      .from("loans")
      .select("*")
      .eq("team_id", teamId)
      .eq("loan_type", "emergency")
      .eq("season_id", seasonId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existingLoan) {
      console.log(`  ↩️  Emergency-lån for team ${teamId} sæson ${seasonId} findes allerede — no-op (idempotent)`);
      return existingLoan;
    }
  }

  const configs = await getLoanConfig(teamId, client);
  const config = configs.find(c => c.loan_type === "emergency");

  if (!config) {
    throw new Error(
      `loan_config mangler emergency-row for team ${teamId} (division-baseret) — DB-seed-fejl, kan ikke fortsætte`
    );
  }

  const feeRate = config.origination_fee_pct;
  const interestRate = config.interest_rate_pct;

  // B2: HARD clamp — divisionsloft afledt robust fra short/long-rækken (post-B1
  // er emergency-rækken aligned, men short/long er primær SSOT for loftet).
  // Clamp-not-throw: nødlån udstedes automatisk af cron til løndækning — et kast
  // ville crashe payroll. Udsted hvad der passer, eller null (0 headroom).
  const effectiveCeiling =
    configs.find(c => c.loan_type === "short")?.debt_ceiling ??
    configs.find(c => c.loan_type === "long")?.debt_ceiling ??
    config.debt_ceiling;

  // Prøv atomisk RPC først (serialiserer concurrent calls via pg_advisory_xact_lock).
  // RPC returnerer clamped loans-row, eller NULL hvis ingen headroom.
  // Falder tilbage til JS-clamp ved PGRST202 / "function does not exist" (legacy/test-mocks).
  let loan;
  if (typeof client.rpc === "function") {
    const { data: rpcLoan, error: rpcError } = await client.rpc("create_emergency_loan_atomic", {
      p_team_id: teamId,
      p_amount_needed: amountNeeded,
      p_origination_fee_pct: feeRate,
      p_interest_rate: interestRate,
      p_debt_ceiling: effectiveCeiling ?? null,
      p_season_id: seasonId ?? null,
    });
    if (rpcError) {
      // PGRST202 = funktion ikke eksponeret (migration ikke kørt / test-mock) → JS-fallback.
      if (rpcError.code !== "PGRST202" && !/function .* does not exist/i.test(rpcError.message || "")) {
        throw rpcError;
      }
    } else if (rpcLoan) {
      // RPC returnerer NULL når 0 headroom — afspejl det.
      loan = Array.isArray(rpcLoan) ? rpcLoan[0] : rpcLoan;
    } else {
      // RPC-sti lykkedes men returnerede null = ingen headroom.
      return null;
    }
  }

  // JS-fallback clamp (RPC ikke tilgængelig).
  let issuedPrincipal;
  if (!loan) {
    if (effectiveCeiling != null) {
      const currentDebt = await getTotalDebt(teamId, client);
      const maxResult = computeMaxLoanPrincipal({
        currentDebt,
        debtCeiling: effectiveCeiling,
        originationFeePct: feeRate,
      });
      // maxResult er null hvis intet loft — ubegrænset.
      issuedPrincipal = maxResult != null
        ? Math.min(amountNeeded, maxResult.principal)
        : amountNeeded;
    } else {
      issuedPrincipal = amountNeeded;
    }

    if (issuedPrincipal <= 0) return null;

    const { data: insertedLoan, error } = await client.from("loans").insert({
      team_id: teamId,
      loan_type: "emergency",
      principal: issuedPrincipal,
      origination_fee: computeLoanFee(issuedPrincipal, feeRate),
      interest_rate: interestRate,
      seasons_total: 1,
      seasons_remaining: 1,
      amount_remaining: issuedPrincipal + computeLoanFee(issuedPrincipal, feeRate),
      status: "active",
      season_id: seasonId ?? null,
    }).select().single();

    if (error) throw error;
    loan = insertedLoan;
  } else {
    issuedPrincipal = loan.principal;
  }

  const issuedFee = computeLoanFee(issuedPrincipal, feeRate);
  const issuedTotalOwed = issuedPrincipal + issuedFee;
  const residual = amountNeeded - issuedPrincipal; // >= 0; > 0 = løn delvist udækket

  // #2301 · idempotency_key + allowDuplicate: forsvar-i-dybden mod double-credit
  // hvis en race (to samtidige payroll-kørsler) begge passerer app-guarden ovenfor
  // FØR den ene har skrevet loans-rowet — DB-unique på finance_transactions
  // fanger den anden kreditering og ruller den tilbage (skipped=true).
  const creditResult = await incrementBalanceWithAudit(client, {
    teamId,
    delta: issuedPrincipal,
    payload: {
      type: "emergency_loan",
      amount: issuedPrincipal,
      description: null,
      season_id: seasonId,
      actor_type: auditCtx?.actorType || FINANCE_ACTOR_TYPE.CRON,
      actor_id: auditCtx?.actorId || null,
      source_path: "loanEngine.createEmergencyLoan",
      reason_code: FINANCE_REASON.EMERGENCY_LOAN_RECEIVED,
      related_entity_type: FINANCE_RELATED_ENTITY.LOAN,
      related_entity_id: loan.id,
      idempotency_key: seasonId ? `emergency_loan:${teamId}:${seasonId}` : null,
      metadata: {
        code: "tx.emergencyLoan",
        params: {
          feeRate: Math.round(feeRate * 100),
          interestRate: Math.round(interestRate * 100),
        },
      },
    },
  }, { allowDuplicate: !!seasonId });

  if (creditResult.skipped) {
    console.warn(`  ↩️  emergency_loan-kreditering allerede skrevet for team ${teamId} sæson ${seasonId} — skip (race-defense)`);
    return loan;
  }

  await notifyManager(teamId, "emergency_loan",
    "⚠️ Emergency loan opened",
    `Your team couldn't cover wages. An emergency loan of ${issuedPrincipal} CZ$ was opened automatically with a ${(feeRate * 100).toFixed(0)}% fee and ${(interestRate * 100).toFixed(0)}% interest. Total debt: ${issuedTotalOwed} CZ$.`,
    client,
    {
      titleCode: "notif.emergencyLoan.title",
      titleParams: {},
      messageCode: "notif.emergencyLoan.message",
      messageParams: {
        amount: issuedPrincipal,
        feeRate: Math.round(feeRate * 100),
        interestRate: Math.round(interestRate * 100),
        totalOwed: issuedTotalOwed,
      },
    }
  );

  // residual > 0 = lønnen er delvist udækket (hård clamp nåede loftet).
  // B3-escalation opdager dette via getTotalDebt — men manageren adviseres nu.
  if (residual > 0) {
    await notifyManager(teamId, "emergency_loan_breach",
      "🚨 Wages partially uncovered — debt cap reached",
      `Your emergency loan was capped at ${issuedPrincipal} CZ$ (division ceiling ${effectiveCeiling} CZ$ reached). ${residual} CZ$ of wages could not be covered. Sell riders or reduce costs immediately.`,
      client,
      {
        titleCode: "notif.emergencyLoanBreach.title",
        titleParams: {},
        messageCode: "notif.emergencyLoanBreach.message",
        messageParams: { breachAmount: residual, ceiling: effectiveCeiling },
      }
    );
  }

  return loan;
}

// ── Betal rate på et lån ──────────────────────────────────────────────────────

export async function repayLoan(loanId, teamId, amount, supabaseClient = null, auditCtx = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();

  // #2302: pre-flight lookup for friendly "not found"/"already paid off"
  // errors + the bid-commitment check below. NOT the source of truth for the
  // actual mutation — repay_loan_atomic re-validates loan ownership/status/
  // balance itself, under an advisory lock + FOR UPDATE, so a concurrent
  // repay or a stale read here can never create money or double-spend debt.
  const { data: loan } = await client.from("loans").select("*").eq("id", loanId).single();
  if (!loan || loan.team_id !== teamId) throw new Error("Lån ikke fundet");
  if (loan.status === "paid_off") throw new Error("Lånet er allerede betalt");

  const { data: team } = await client.from("teams").select("balance").eq("id", teamId).single();
  if (!team || team.balance < amount) throw new Error("Ikke nok midler");

  // #44: penge låst i aktive bud/autobud kan ikke bruges til at betale gæld.
  // Eksempel fra issue: balance 500K, gæld 200K, 400K i bud → kun 100K kan betales.
  // Worst-case commitment = MAX(current_price, proxy_max) for leading + proxy_max
  // for ikke-leading auktioner. Klamper repay til (balance - commitment).
  const commitment = await fetchTeamCommitment(client, teamId);
  const availableForRepay = Math.max(0, team.balance - commitment);
  if (amount > availableForRepay) {
    // #666: throw'en boble til api.js der mapper code → http response. Frontend
    // viser via t() i errors-namespace. Behold EN fallback i Error.message så
    // logs + ikke-coded clients ser noget meningsfuldt.
    const err = new Error(
      `You only have ${availableForRepay} CZ$ available — the rest is locked in active bids or autobids`,
    );
    err.code = "error.repayInsufficient";
    err.params = { available: availableForRepay };
    throw err;
  }

  // #2302: hele mutationen (lås → validér balance+amount_remaining → debitér
  // teams.balance + skriv finance_transactions-ledger + opdatér loans) sker nu
  // i ÉN Postgres-transaktion (repay_loan_atomic, database/2026-07-10-repay-
  // loan-atomic.sql). Fjerner det gamle "opdatér loan FØRST, debitér balance
  // BAGEFTER i separat kald"-hul (fejl mellem de to trin slettede gæld uden
  // betaling) + tilføjer row-level lås mod concurrent repayments.
  const repaySeasonId = await fetchActiveSeasonId(client);
  const { data: rpcData, error: rpcError } = await client.rpc("repay_loan_atomic", {
    p_loan_id: loanId,
    p_team_id: teamId,
    p_amount: amount,
    p_finance_payload: {
      season_id: repaySeasonId,
      actor_type: auditCtx?.actorType || FINANCE_ACTOR_TYPE.API,
      actor_id: auditCtx?.actorId || null,
      source_path: "loanEngine.repayLoan",
      reason_code: FINANCE_REASON.LOAN_REPAYMENT,
      related_entity_type: FINANCE_RELATED_ENTITY.LOAN,
      related_entity_id: loanId,
    },
  });

  if (rpcError) {
    // repay_loan_atomic RAISE'r med præcis de samme beskeder som de gamle
    // JS-checks kastede (se pre-flight ovenfor) — forward message'n uændret
    // så API-fejl-kontrakten (message-only, ingen .code) er bevaret uden at
    // duplikere strengene her (i18n-leak-ratchet, #1068).
    throw new Error(rpcError.message || "Loan repayment failed");
  }

  const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  const actualAmount = result.paid;
  const newRemaining = result.remaining;
  const isPaidOff = result.paid_off;

  if (isPaidOff) {
    await notifyManager(teamId, "loan_paid_off",
      "✅ Loan repaid",
      "Congratulations! You've fully repaid your loan.",
      client,
      {
        titleCode: "notif.loanPaidOff.title",
        titleParams: {},
        messageCode: "notif.loanPaidOff.message",
        messageParams: {},
      }
    );
  }

  // #2326: interest-first split fra RPC'en (interest_paid/principal_paid).
  // Nullish-fallback: en endnu ikke opdateret RPC (pre-#2326-migration)
  // returnerer ikke nøglerne — behold da undefined i stedet for at gætte.
  return {
    paid: actualAmount,
    remaining: isPaidOff ? 0 : newRemaining,
    paid_off: isPaidOff,
    interest_paid: result.interest_paid,
    principal_paid: result.principal_paid,
  };
}

// ── Tvunget afdrag fra tvangssalg (forced debt sale, #2303) ───────────────────
//
// Finance-audit 10/7 fund: tvangssalg ved gældsbrud (economyEngine.processTeam-
// SeasonPayroll, debt-breach-streak-blokken) krediterede salgsprovenuet til
// balancen, men rørte aldrig loans.amount_remaining — loopet stoppede på et
// fiktivt runningDebt-estimat, så den reelle gæld var uændret næste sæson og
// bruddet gentog sig. Fix: afdrag lånene DIREKTE med provenuet, ældste lån
// først, via repay_loan_atomic (samme atomiske RPC som repayLoan()).
//
// Kalder RPC'en DIREKTE i stedet for at genbruge repayLoan(): repayLoan's
// bid-commitment-preflight (fetchTeamCommitment) beskytter en MANAGER mod at
// betale gæld med penge der er låst i aktive bud — irrelevant her, da
// provenuet lige er krediteret FRA selve salget (season-start-cron-kontekst,
// ingen spiller-handling), og en preflight-fejl her ville forhindre selve
// gældsafdraget bruddet skal løse. Springer også repayLoan's loan_paid_off
// "Congratulations!"-notifikation over — uegnet tone under et tvangssalg.
//
// metadata_code_final/metadata_code_remaining lader RPC'en (se
// database/2026-07-10-repay-loan-atomic-forced-sale-metadata.sql) skrive
// tx.forcedDebtRepaymentFinal/Remaining i stedet for de almindelige
// tx.loanRepaymentFinal/Remaining-koder, så spillerens historik kan skelne
// et tvangsafdrag fra en frivillig repayLoan()-betaling.
export async function repayLoansFromForcedSale(teamId, creditAmount, supabaseClient = null, seasonId = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  if (!creditAmount || creditAmount <= 0) return { totalRepaid: 0, loans: [] };

  const { data: loans, error } = await client
    .from("loans")
    .select("id, amount_remaining")
    .eq("team_id", teamId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw error;

  let remainingCredit = creditAmount;
  const repaid = [];

  for (const loan of loans || []) {
    if (remainingCredit <= 0) break;
    if (!loan.amount_remaining || loan.amount_remaining <= 0) continue;
    const amount = Math.min(remainingCredit, loan.amount_remaining);

    const { data: rpcData, error: rpcError } = await client.rpc("repay_loan_atomic", {
      p_loan_id: loan.id,
      p_team_id: teamId,
      p_amount: amount,
      p_finance_payload: {
        season_id: seasonId,
        actor_type: FINANCE_ACTOR_TYPE.CRON,
        actor_id: null,
        source_path: "loanEngine.repayLoansFromForcedSale",
        reason_code: FINANCE_REASON.FORCED_DEBT_REPAYMENT,
        related_entity_type: FINANCE_RELATED_ENTITY.LOAN,
        related_entity_id: loan.id,
        metadata_code_final: "tx.forcedDebtRepaymentFinal",
        metadata_code_remaining: "tx.forcedDebtRepaymentRemaining",
      },
    });
    if (rpcError) throw new Error(rpcError.message || "Forced debt repayment failed");

    const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    remainingCredit -= result.paid;
    repaid.push({
      loan_id: loan.id,
      paid: result.paid,
      remaining: result.remaining,
      paid_off: result.paid_off,
      // #2326: interest-first split (undefined hvis RPC'en er pre-#2326).
      interest_paid: result.interest_paid,
      principal_paid: result.principal_paid,
    });
  }

  return { totalRepaid: creditAmount - remainingCredit, loans: repaid };
}

// ── Tilskriv renter ved sæsonafslutning ───────────────────────────────────────

// #2304 (finance-audit 10/7): renten kapitaliseres IKKE længere som en
// kontant-lignende finance_transactions-post — den blev dobbelttalt (én gang
// her, én gang inde i den efterfølgende loan_repayment-debitering) og
// hero-cashflow-nettet i sæsonrapporten matchede ikke den faktiske
// balanceændring (der sker jo ingen debitering af teams.balance ved
// kapitalisering). Renten akkumuleres nu synligt på selve lånet
// (loans.accrued_interest, database/2026-07-10-loans-accrued-interest.sql) —
// UI viser tallet direkte i stedet for at læne sig på en ledger-linje.
//
// #535: Returnerer { charged: [{ loan_id, interest, skipped }] } så
// payroll-summary kan aggregere counts + totaler. Charged-array er backward
// compatible — callers der ignorerer return-værdien påvirkes ikke.
export async function processLoanInterest(teamId, seasonId, supabaseClient = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  const { data: loans, error: loansError } = await client
    .from("loans")
    .select("*")
    .eq("team_id", teamId)
    .eq("status", "active");
  if (loansError) throw loansError;

  const charged = [];

  for (const loan of loans || []) {
    const interest = Math.round(loan.amount_remaining * loan.interest_rate);
    const newRemaining = loan.amount_remaining + interest;
    const newAccruedInterest = (loan.accrued_interest || 0) + interest;
    const newSeasonsRemaining = loan.seasons_remaining - 1;

    // Idempotency: betinget UPDATE (erstatter det gamle unique-index-på-
    // finance_transactions-mønster, som forudsatte en INSERT). Kun rows hvor
    // last_interest_season_id enten er NULL eller afviger fra denne sæson
    // opdateres — en 2. cron-kørsel for samme sæson rammer 0 rows og skipper
    // stille i stedet for at dobbelt-charge.
    const { data: updatedRows, error: updateError } = await client
      .from("loans")
      .update({
        amount_remaining: newRemaining,
        accrued_interest: newAccruedInterest,
        last_interest_season_id: seasonId,
        seasons_remaining: newSeasonsRemaining,
        updated_at: new Date().toISOString(),
      })
      .eq("id", loan.id)
      .or(`last_interest_season_id.is.null,last_interest_season_id.neq.${seasonId}`)
      .select("id");
    if (updateError) throw updateError;

    if (!updatedRows || updatedRows.length === 0) {
      console.warn(
        `[economy] loan-interest already charged for loan ${loan.id} season ${seasonId} — skip`
      );
      charged.push({ loan_id: loan.id, interest, skipped: true });
      continue;
    }

    charged.push({ loan_id: loan.id, interest, skipped: false });
  }

  return { charged };
}

// ── Intern helper ─────────────────────────────────────────────────────────────

async function notifyManager(teamId, type, title, message, supabaseClient = null, metadata = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  await notifyTeamOwnerShared({
    supabase: client,
    teamId,
    type,
    title,
    message,
    metadata,
  });
}
