// #6181 (dommer-fund 10/11): fyringens frikøbsgebyr må ikke betales med penge,
// der er reserveret til førende bud og autobud. De faste køb (scouting, anlæg,
// staff, akademi-signering) bruger allerede den fælles disponibel-saldo-gate
// (availableBalance.checkAvailableSpend); fyringen tjekkede kun den rå saldo.
//
// Gaten gælder kun med pengelåsen (market_commitment_6181) tændt. Slukket =
// uændret: null uden et eneste opslag ud over selve kontakten. Den rå saldo
// tjekkes stadig først i ruten (cannot_afford_release), så denne gate ser kun
// tilfældet "saldoen rækker, men en del af den er låst".
import { checkAvailableSpend, INSUFFICIENT_AVAILABLE_BALANCE } from "./availableBalance.js";
import { isMarketProtectionEnabled2176 } from "./marketBeta2176.ts";

/**
 * Senior- og akademi-fyring (POST /riders/:id/release og /academy-release).
 *
 * @param {any} supabase
 * @param {{ teamId: string, balance: number, fee: number }} args
 * @returns {Promise<{ status: number, body: Record<string, unknown> } | null>}
 */
export async function releaseFeeAvailableResponse6181(supabase, { teamId, balance, fee }) {
  if (!(Number(fee) > 0) || (Number(balance) || 0) < Number(fee)) return null;
  if (!(await isMarketProtectionEnabled2176(supabase, { teamId }))) return null;
  const issue = await checkAvailableSpend(supabase, { teamId, balance, cost: fee });
  if (issue?.error !== INSUFFICIENT_AVAILABLE_BALANCE) return null;
  return {
    status: 400,
    body: {
      error: "Not enough available money: part of your balance is locked in auction bids.",
      errorCode: "insufficient_available_balance",
      errorParams: { fee, available: issue.available, locked: issue.locked },
    },
  };
}
