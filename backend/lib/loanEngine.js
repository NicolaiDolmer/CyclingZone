/**
 * Cycling Zone — Loan Engine
 * Håndterer lån: oprettelse, ratebetaling, nødlån ved manglende løn, sæsonrenter
 *
 * SQL-funktion krævet i Supabase:
 *   CREATE OR REPLACE FUNCTION increment_balance(team_id uuid, amount integer)
 *   RETURNS void AS $$
 *     UPDATE teams SET balance = balance + amount WHERE id = team_id;
 *   $$ LANGUAGE sql;
 */
import { notifyTeamOwner as notifyTeamOwnerShared } from "./notificationService.js";

let defaultSupabaseClientPromise;

async function getDefaultSupabaseClient() {
  if (!defaultSupabaseClientPromise) {
    defaultSupabaseClientPromise = import("@supabase/supabase-js").then(({ createClient }) => (
      createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    ));
  }

  return defaultSupabaseClientPromise;
}

async function adjustBalance(teamId, amount, supabaseClient = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  const { data: team } = await client.from("teams").select("balance").eq("id", teamId).single();
  await client.from("teams").update({ balance: team.balance + amount }).eq("id", teamId);
}

export function shouldChargeLoanAgreementSeasonFee(loan, seasonNumber) {
  if (!loan || loan.status !== "active") return false;
  if ((loan.loan_fee || 0) <= 0) return false;
  if (!Number.isInteger(seasonNumber)) return false;

  // Activation already charges the first covered season, so season-start only
  // collects fees for later seasons that are still inside the agreement window.
  return seasonNumber > loan.start_season && seasonNumber <= loan.end_season;
}

export async function processLoanAgreementSeasonFees(
  teamId,
  seasonNumber,
  seasonId,
  supabaseClient = null
) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  const { data: loans, error } = await client
    .from("loan_agreements")
    .select("id, from_team_id, to_team_id, loan_fee, start_season, end_season, status, rider:rider_id(firstname, lastname)")
    .eq("to_team_id", teamId)
    .eq("status", "active");

  if (error) throw error;

  const chargeableLoans = (loans || []).filter((loan) =>
    shouldChargeLoanAgreementSeasonFee(loan, seasonNumber)
  );

  for (const loan of chargeableLoans) {
    const riderName = loan.rider
      ? `${loan.rider.firstname} ${loan.rider.lastname}`
      : "ukendt rytter";

    await adjustBalance(loan.to_team_id, -loan.loan_fee, client);
    await adjustBalance(loan.from_team_id, loan.loan_fee, client);

    await client.from("finance_transactions").insert([
      {
        team_id: loan.to_team_id,
        type: "transfer_out",
        amount: -loan.loan_fee,
        description: `Lejegebyr: ${riderName} (sæson ${seasonNumber})`,
        season_id: seasonId,
      },
      {
        team_id: loan.from_team_id,
        type: "transfer_in",
        amount: loan.loan_fee,
        description: `Lejegebyr modtaget: ${riderName} (sæson ${seasonNumber})`,
        season_id: seasonId,
      },
    ]);
  }

  return chargeableLoans.map((loan) => ({
    id: loan.id,
    loan_fee: loan.loan_fee,
  }));
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

// ── Opret lån (manager-initieret: short eller long) ───────────────────────────

export async function createLoan(teamId, loanType, principalAmount, supabaseClient = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  const configs = await getLoanConfig(teamId, client);
  const config = configs.find(c => c.loan_type === loanType);
  if (!config) throw new Error("Ugyldig låntype");

  const currentDebt = await getTotalDebt(teamId, client);
  if (currentDebt + principalAmount > config.debt_ceiling) {
    throw new Error(`Gældsloft på ${config.debt_ceiling} CZ$ nået for denne division`);
  }

  const fee = Math.round(principalAmount * config.origination_fee_pct);
  const totalOwed = principalAmount + fee;

  const { data: loan, error } = await client.from("loans").insert({
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

  await adjustBalance(teamId, principalAmount, client);

  await client.from("finance_transactions").insert({
    team_id: teamId,
    type: "loan_received",
    amount: principalAmount,
    description: `${loanType === "short" ? "Kort" : "Langt"} lån optaget (gebyr: ${fee} CZ$)`,
  });

  await notifyManager(teamId, "loan_created",
    "Lån oprettet",
    `Du har optaget et ${loanType === "short" ? "kort" : "langt"} lån på ${principalAmount} CZ$. Gebyr: ${fee} CZ$. Samlet tilbagebetaling: ${totalOwed} CZ$.`,
    client
  );

  return loan;
}

// ── Nødlån — oprettes automatisk hvis holdet ikke kan betale løn ───────────────

export async function createEmergencyLoan(teamId, amountNeeded, supabaseClient = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  const configs = await getLoanConfig(teamId, client);
  const config = configs.find(c => c.loan_type === "emergency");

  const feeRate = config?.origination_fee_pct ?? 0.15;
  const interestRate = config?.interest_rate_pct ?? 0.15;

  const fee = Math.round(amountNeeded * feeRate);
  const totalOwed = amountNeeded + fee;

  const { data: loan, error } = await client.from("loans").insert({
    team_id: teamId,
    loan_type: "emergency",
    principal: amountNeeded,
    origination_fee: fee,
    interest_rate: interestRate,
    seasons_total: 1,
    seasons_remaining: 1,
    amount_remaining: totalOwed,
    status: "active",
  }).select().single();

  if (error) throw error;

  await adjustBalance(teamId, amountNeeded, client);

  await client.from("finance_transactions").insert({
    team_id: teamId,
    type: "emergency_loan",
    amount: amountNeeded,
    description: `Nødlån oprettet automatisk (gebyr: ${fee} CZ$, rente: ${(interestRate * 100).toFixed(0)}%/sæson)`,
  });

  await notifyManager(teamId, "emergency_loan",
    "⚠️ Nødlån oprettet",
    `Dit hold havde ikke midler til at betale løn. Der er automatisk oprettet et nødlån på ${amountNeeded} CZ$ med ${(feeRate * 100).toFixed(0)}% gebyr og ${(interestRate * 100).toFixed(0)}% rente. Samlet gæld: ${totalOwed} CZ$.`,
    client
  );

  return loan;
}

// ── Betal rate på et lån ──────────────────────────────────────────────────────

export async function repayLoan(loanId, teamId, amount, supabaseClient = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  const { data: loan } = await client.from("loans").select("*").eq("id", loanId).single();
  if (!loan || loan.team_id !== teamId) throw new Error("Lån ikke fundet");
  if (loan.status === "paid_off") throw new Error("Lånet er allerede betalt");

  const { data: team } = await client.from("teams").select("balance").eq("id", teamId).single();
  if (team.balance < amount) throw new Error("Ikke nok midler");

  const actualAmount = Math.min(amount, loan.amount_remaining);
  const newRemaining = loan.amount_remaining - actualAmount;
  const isPaidOff = newRemaining <= 0;

  await client.from("loans").update({
    amount_remaining: isPaidOff ? 0 : newRemaining,
    status: isPaidOff ? "paid_off" : "active",
    updated_at: new Date().toISOString(),
  }).eq("id", loanId);

  await adjustBalance(teamId, -actualAmount, client);

  await client.from("finance_transactions").insert({
    team_id: teamId,
    type: "loan_repayment",
    amount: -actualAmount,
    description: `Lånrate betalt${isPaidOff ? " — lån fuldt tilbagebetalt! 🎉" : ` (resterende: ${newRemaining} CZ$)`}`,
  });

  if (isPaidOff) {
    await notifyManager(teamId, "loan_paid_off",
      "✅ Lån tilbagebetalt",
      "Tillykke! Du har fuldt tilbagebetalt dit lån.",
      client
    );
  }

  return { paid: actualAmount, remaining: isPaidOff ? 0 : newRemaining, paid_off: isPaidOff };
}

// ── Tilskriv renter ved sæsonafslutning ───────────────────────────────────────

export async function processLoanInterest(teamId, seasonId, supabaseClient = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  const { data: loans } = await client
    .from("loans")
    .select("*")
    .eq("team_id", teamId)
    .eq("status", "active");

  for (const loan of loans || []) {
    const interest = Math.round(loan.amount_remaining * loan.interest_rate);
    const newRemaining = loan.amount_remaining + interest;
    const newSeasonsRemaining = loan.seasons_remaining - 1;

    await client.from("loans").update({
      amount_remaining: newRemaining,
      seasons_remaining: newSeasonsRemaining,
      updated_at: new Date().toISOString(),
    }).eq("id", loan.id);

    await client.from("finance_transactions").insert({
      team_id: teamId,
      type: "loan_interest",
      amount: -interest,
      description: `Lånerenter tilskrevet (${(loan.interest_rate * 100).toFixed(0)}%)`,
      season_id: seasonId,
    });
  }
}

// ── Intern helper ─────────────────────────────────────────────────────────────

async function notifyManager(teamId, type, title, message, supabaseClient = null) {
  const client = supabaseClient ?? await getDefaultSupabaseClient();
  await notifyTeamOwnerShared({
    supabase: client,
    teamId,
    type,
    title,
    message,
  });
}
