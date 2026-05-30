import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL;

export default function BetaToolsSection({ getAuth, onMsg }) {
  const [betaResult, setBetaResult] = useState(null);
  const [betaClearTransactions, setBetaClearTransactions] = useState(false);
  const [loading, setLoading] = useState({});
  const [boardTestMode, setBoardTestMode] = useState(null); // null = ukendt

  function setLoad(k, v) { setLoading(l => ({ ...l, [k]: v })); }

  async function handleBeta(endpoint, confirmMsg, body = {}) {
    if (!confirm(confirmMsg)) return;
    setLoad(`beta_${endpoint}`, true);
    setBetaResult(null);
    try {
      const res = await fetch(`${API}/api/admin/beta/${endpoint}`, {
        method: "POST", headers: await getAuth(), body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) { setBetaResult({ endpoint, ...data }); onMsg(`✅ beta/${endpoint} udført`); }
      else { onMsg(`❌ ${data.error}`, "error"); }
    } catch (e) {
      onMsg(`❌ Netværksfejl: ${e.message}`, "error");
    }
    setLoad(`beta_${endpoint}`, false);
  }

  // #805 · Board-test-mode status + toggle (egen route-prefix /api/admin/board/).
  async function loadBoardTestStatus() {
    try {
      const res = await fetch(`${API}/api/admin/board/test-status`, { headers: await getAuth() });
      const data = await res.json();
      if (res.ok) setBoardTestMode(data.board_test_mode === true);
    } catch { /* status er best-effort */ }
  }

  useEffect(() => { loadBoardTestStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBoardTest(action, confirmMsg) {
    if (!confirm(confirmMsg)) return;
    setLoad(`board_${action}`, true);
    setBetaResult(null);
    try {
      const res = await fetch(`${API}/api/admin/board/${action}`, {
        method: "POST", headers: await getAuth(), body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        setBetaResult({ endpoint: `board/${action}`, ...data });
        setBoardTestMode(data.board_test_mode === true);
        onMsg(`✅ board/${action} udført`);
      } else {
        onMsg(`❌ ${data.error}`, "error");
      }
    } catch (e) {
      onMsg(`❌ Netværksfejl: ${e.message}`, "error");
    }
    setLoad(`board_${action}`, false);
  }

  return (
    <>
      <div className="mb-4 flex items-start gap-2 bg-cz-accent/10 border border-cz-accent/30 rounded-lg p-3 text-xs text-cz-accent-t">
        <span className="text-base leading-none mt-0.5">⚠️</span>
        <span>Disse handlinger er destruktive og irreversible. Brug kun under testperioden. AI-holds, bank-hold og frosne hold påvirkes ikke af manager-resettene.</span>
      </div>
      {/* #805 · Board-test-tilstand: åbn bestyrelsen for test med frosset økonomi */}
      <div className="mb-4 bg-cz-subtle border border-cz-border rounded-lg p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-xs font-semibold text-cz-2">Bestyrelse — test med frosset økonomi</p>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${
            boardTestMode === true
              ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/40"
              : "bg-cz-subtle text-cz-3 border-cz-border"
          }`}>
            {boardTestMode === null ? "status ukendt" : boardTestMode ? "TEST AKTIV" : "test inaktiv"}
          </span>
        </div>
        <p className="text-xs text-cz-3 mb-3">
          Åbner bestyrelsen for alle testere uden reelle pengekonsekvenser (sponsor-modifier
          tvinges 1.0, ingen board-bonus-udbetalinger, tvangssalg/pullout suppress). Hard-blocks
          (salary cap / signing restriction) håndhæves stadig. Ryddes automatisk ved sæson-skift.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleBoardTest("open-test", "Åbn bestyrelsen for test med frosset økonomi?\n\n• Nulstiller board-profiler til ren baseline (signerede planer ryddes)\n• Åbner onboarding-forhandling (5yr→3yr→1yr) for alle testere\n• Fryser board-økonomien (ingen rigtige penge flytter sig)\n\nHandlingen kan ikke fortrydes (board-profiler nulstilles).")}
            disabled={loading["board_open-test"]}
            className="px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
            {loading["board_open-test"] ? "..." : "Åbn board for test"}
          </button>
          <button
            onClick={() => handleBoardTest("close-test", "Luk board-test-tilstanden?\n\nØkonomi-frysningen ophæves (board_test_mode=false). Board-data og window-state efterlades urørt.")}
            disabled={loading["board_close-test"]}
            className="px-3 py-2 text-xs bg-cz-subtle text-cz-2 border border-cz-border rounded-lg hover:bg-cz-hover disabled:opacity-50 transition-all">
            {loading["board_close-test"] ? "..." : "Luk board-test"}
          </button>
        </div>
      </div>
      <label className="mb-4 inline-flex items-center gap-2 text-xs text-cz-2 select-none">
        <input
          type="checkbox"
          checked={betaClearTransactions}
          onChange={e => setBetaClearTransactions(e.target.checked)}
          className="rounded border-cz-border text-cz-accent focus:ring-cz-accent"
        />
        Ryd finance-transaktioner for manager-hold ved balance/full reset
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-2 mb-4">
        <button onClick={() => handleBeta("cancel-market", "Annuller ALLE åbne auktioner, transfers, swaps og låneaftaler?\n\nHandlingen kan ikke fortrydes.")}
          disabled={loading["beta_cancel-market"]}
          className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
          {loading["beta_cancel-market"] ? "..." : "Annuller marked"}
        </button>
        <button onClick={() => handleBeta("reset-rosters", "Returner ALLE manager-ejede ryttere til deres AI-hold?\n\nHandlingen kan ikke fortrydes.")}
          disabled={loading["beta_reset-rosters"]}
          className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
          {loading["beta_reset-rosters"] ? "..." : "Nulstil trupper"}
        </button>
        <button onClick={() => handleBeta("reset-balances", `Sæt balance = 800.000 CZ$ på alle manager-holds?${betaClearTransactions ? "\n\nFinance-transaktioner for manager-hold ryddes også." : ""}\n\nHandlingen kan ikke fortrydes.`, { clear_transactions: betaClearTransactions })}
          disabled={loading["beta_reset-balances"]}
          className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
          {loading["beta_reset-balances"] ? "..." : "Nulstil balancer"}
        </button>
        <button onClick={() => handleBeta("reset-divisions", "Sæt ALLE aktive managerhold tilbage til 3. division?\n\nHandlingen kan ikke fortrydes.")}
          disabled={loading["beta_reset-divisions"]}
          className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
          {loading["beta_reset-divisions"] ? "..." : "Nulstil divisioner"}
        </button>
        <button onClick={() => handleBeta("reset-board", "Nulstil bestyrelsesprofiler, snapshots og board requests til baseline?\n\nHandlingen kan ikke fortrydes.")}
          disabled={loading["beta_reset-board"]}
          className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
          {loading["beta_reset-board"] ? "..." : "Nulstil bestyrelse"}
        </button>
        <button onClick={() => handleBeta("reset-transfer-archive", "Slet HELE transferarkivet — alle listings, tilbud og swap-tilbud for manager-hold?\n\nHandlingen kan ikke fortrydes.")}
          disabled={loading["beta_reset-transfer-archive"]}
          className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
          {loading["beta_reset-transfer-archive"] ? "..." : "Nulstil transferarkiv"}
        </button>
        <button onClick={() => handleBeta("reset-rider-history", "Slet ALL rytter-handelshistorik (auktioner, transfers, swaps, leje-aftaler) på ALLE ryttere?\n\n• Alle ryttersider får ren tavle uden alpha-historik\n• Ønskelister bevares\n• Rytter-roster, balancer og sæsoner påvirkes IKKE\n\nHandlingen kan ikke fortrydes.")}
          disabled={loading["beta_reset-rider-history"]}
          className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
          {loading["beta_reset-rider-history"] ? "..." : "Nulstil rytter-historik"}
        </button>
        <button onClick={() => handleBeta("reset-loans", "Slet alle aktive finanslån (inkl. renter) for manager-hold?\n\nHandlingen kan ikke fortrydes.")}
          disabled={loading["beta_reset-loans"]}
          className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
          {loading["beta_reset-loans"] ? "..." : "Nulstil lån"}
        </button>
        <button onClick={() => handleBeta("reset-notifications", "Ryd indbakken for alle manager-brugere?\n\nHandlingen kan ikke fortrydes.")}
          disabled={loading["beta_reset-notifications"]}
          className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
          {loading["beta_reset-notifications"] ? "..." : "Nulstil indbakke"}
        </button>
        <button onClick={() => handleBeta("reset-calendar", "Ryd løbskalender, pending resultater, race results, standings og præmiepenge-bonus?\n\nHandlingen kan ikke fortrydes.")}
          disabled={loading["beta_reset-calendar"]}
          className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
          {loading["beta_reset-calendar"] ? "..." : "Nulstil løbskalender"}
        </button>
        <button onClick={() => handleBeta("reset-seasons", "Ryd ALLE sæsoner?\n\nKør typisk løbskalender-reset først. Handlingen kan ikke fortrydes.")}
          disabled={loading["beta_reset-seasons"]}
          className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
          {loading["beta_reset-seasons"] ? "..." : "Nulstil sæsoner"}
        </button>
        <button onClick={() => handleBeta("reset-manager-progress", "Nulstil manager XP og level til baseline?\n\nHandlingen kan ikke fortrydes.")}
          disabled={loading["beta_reset-manager-progress"]}
          className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
          {loading["beta_reset-manager-progress"] ? "..." : "Nulstil XP/level"}
        </button>
        <button onClick={() => handleBeta("reset-achievements", "Ryd alle manager achievement unlocks?\n\nAchievement-definitioner bevares. Handlingen kan ikke fortrydes.")}
          disabled={loading["beta_reset-achievements"]}
          className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
          {loading["beta_reset-achievements"] ? "..." : "Nulstil achievements"}
        </button>
        <button onClick={() => handleBeta("full-reset", `FULD TEST-NULSTILLING:\n• Alle åbne markedsaktiviteter annulleres\n• Al rytter-handelshistorik slettes (auktioner, transfers, swaps, leje-aftaler)\n• Hele transferarkivet slettes (listings, tilbud, swaps)\n• Alle finanslån og renter slettes\n• Indbakke ryddes for alle managers\n• Alle manager-ryttere returneres til AI-hold\n• Alle balancer sættes til 800.000 CZ$\n• Managerhold sættes i 3. division\n• Løbskalender, resultater, standings og præmiepenge-bonus ryddes\n• Sæsoner slettes\n• Board-profiler resettes til baseline\n• XP/level og achievement unlocks nulstilles${betaClearTransactions ? "\n• Finance-transaktioner for manager-hold ryddes" : ""}\n\nØnskelister bevares. Dette er en test-reset, ikke et live-reset. Handlingen kan ikke fortrydes. Fortsæt?`, { clear_transactions: betaClearTransactions, reset_mode: "test" })}
          disabled={loading["beta_full-reset"]}
          className="w-full lg:w-auto px-3 py-2 text-xs bg-cz-danger-bg text-cz-danger border border-red-300 rounded-lg hover:bg-cz-danger-bg disabled:opacity-50 transition-all font-semibold">
          {loading["beta_full-reset"] ? "..." : "Fuld nulstilling"}
        </button>
      </div>
      {betaResult && (
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3 text-xs text-cz-2 font-mono">
          <p className="font-semibold text-cz-2 mb-1">Kvittering — {betaResult.endpoint}</p>
          {betaResult.reset_mode && <p className="mb-1">Reset-type: {betaResult.reset_mode}</p>}
          {betaResult.cancelled && (
            <div className="mb-1">
              <p>Auktioner annulleret: {betaResult.cancelled.auctions}</p>
              <p>Transfer-opslag trukket: {betaResult.cancelled.transfer_listings}</p>
              <p>Transfer-tilbud afvist: {betaResult.cancelled.transfer_offers}</p>
              <p>Swap-tilbud afvist: {betaResult.cancelled.swap_offers}</p>
              <p>Låneaftaler annulleret: {betaResult.cancelled.loan_agreements}</p>
            </div>
          )}
          {betaResult.rider_history && (
            <p className="mb-1">Rytter-historik slettet: {betaResult.rider_history.auctions} auktioner ({betaResult.rider_history.auction_bids} bud) · {betaResult.rider_history.transfer_listings} listings · {betaResult.rider_history.transfer_offers} tilbud · {betaResult.rider_history.swap_offers} swaps · {betaResult.rider_history.loan_agreements} leje-aftaler</p>
          )}
          {betaResult.transfer_archive && (
            <p className="mb-1">Transferarkiv slettet: {betaResult.transfer_archive.transfer_listings} listings · {betaResult.transfer_archive.transfer_offers} tilbud · {betaResult.transfer_archive.swap_offers} swaps</p>
          )}
          {betaResult.loans != null && (
            <p className="mb-1">Finanslån slettet: {betaResult.loans?.loans ?? betaResult.loans}</p>
          )}
          {betaResult.notifications != null && (
            <p className="mb-1">Notifikationer slettet: {betaResult.notifications?.notifications ?? betaResult.notifications}</p>
          )}
          {betaResult.rosters != null && (
            <p className="mb-1">Ryttere flyttet: {betaResult.rosters?.moved ?? betaResult.moved} (til AI: {betaResult.rosters?.to_ai ?? betaResult.to_ai}, til NULL: {betaResult.rosters?.to_null ?? betaResult.to_null})</p>
          )}
          {betaResult.balances != null && (
            <p>Balancer nulstillet: {betaResult.balances?.reset ?? betaResult.reset} hold · finance ryddet: {String(betaResult.balances?.clear_transactions ?? betaResult.clear_transactions ?? false)}</p>
          )}
          {betaResult.divisions && (
            <p className="mb-1">Divisioner nulstillet: {betaResult.divisions.reset} hold til division {betaResult.divisions.division}</p>
          )}
          {betaResult.board_profiles && (
            <p className="mb-1">Bestyrelser reset: {betaResult.board_profiles.reset} · oprettet: {betaResult.board_profiles.created} · snapshots slettet: {betaResult.board_profiles.snapshots_deleted} · requests slettet: {betaResult.board_profiles.requests_deleted}</p>
          )}
          {betaResult.race_calendar && (
            <p className="mb-1">Løbskalender ryddet: {betaResult.race_calendar.races} løb · {betaResult.race_calendar.race_results} resultater · {betaResult.race_calendar.pending_race_results} pending · {betaResult.race_calendar.season_standings} standings</p>
          )}
          {betaResult.seasons && (
            <p className="mb-1">Sæsoner slettet: {betaResult.seasons.seasons}</p>
          )}
          {betaResult.manager_progress && (
            <p className="mb-1">Manager-progress reset: {betaResult.manager_progress.users} brugere · xp_log slettet: {betaResult.manager_progress.xp_log}</p>
          )}
          {betaResult.achievements && (
            <p className="mb-1">Achievement unlocks slettet: {betaResult.achievements.manager_achievements}</p>
          )}
          {betaResult.moved != null && betaResult.rosters == null && (
            <p>Ryttere flyttet: {betaResult.moved} (til AI: {betaResult.to_ai}, til NULL: {betaResult.to_null})</p>
          )}
          {betaResult.reset != null && betaResult.balances == null && (
            <p>Balancer nulstillet: {betaResult.reset} holds</p>
          )}
        </div>
      )}
    </>
  );
}
