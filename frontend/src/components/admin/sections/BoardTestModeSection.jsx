import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL;

// #805 · Board-test-tilstand: åbn bestyrelsen for test med frosset økonomi.
// Bevidst placeret UDEN for beta-tools-gaten (BETA_ENABLED) — dette er en
// admin-handling til at styre en live feature (beskyttet af requireAdmin på
// backend), ikke et destruktivt dev-reset. Skal være tilgængelig på prod.
export default function BoardTestModeSection({ getAuth, onMsg }) {
  const [boardTestMode, setBoardTestMode] = useState(null); // null = ukendt
  const [loading, setLoading] = useState({});
  const [result, setResult] = useState(null);

  function setLoad(k, v) { setLoading(l => ({ ...l, [k]: v })); }

  async function loadStatus() {
    try {
      const res = await fetch(`${API}/api/admin/board/test-status`, { headers: await getAuth() });
      const data = await res.json();
      if (res.ok) setBoardTestMode(data.board_test_mode === true);
    } catch { /* status er best-effort */ }
  }

  useEffect(() => { loadStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBoardTest(action, confirmMsg) {
    if (!confirm(confirmMsg)) return;
    setLoad(action, true);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/admin/board/${action}`, {
        method: "POST", headers: await getAuth(), body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ action, ...data });
        setBoardTestMode(data.board_test_mode === true);
        onMsg(`✅ board/${action} udført`);
      } else {
        onMsg(`❌ ${data.error}`, "error");
      }
    } catch (e) {
      onMsg(`❌ Netværksfejl: ${e.message}`, "error");
    }
    setLoad(action, false);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs text-cz-3">
          Åbner bestyrelsen for alle testere uden reelle pengekonsekvenser (sponsor-modifier
          tvinges 1.0, ingen board-bonus-udbetalinger, tvangssalg/pullout suppress). Hard-blocks
          (lønloft / indkøbsrestriktioner) håndhæves stadig. Ryddes automatisk ved sæson-skift.
        </p>
        <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full border ${
          boardTestMode === true
            ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/40"
            : "bg-cz-subtle text-cz-3 border-cz-border"
        }`}>
          {boardTestMode === null ? "status ukendt" : boardTestMode ? "TEST AKTIV" : "test inaktiv"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => handleBoardTest("open-test", "Åbn bestyrelsen for test med frosset økonomi?\n\n• Nulstiller board-profiler til ren baseline (signerede planer ryddes)\n• Åbner onboarding-forhandling (5yr→3yr→1yr) for alle testere\n• Fryser board-økonomien (ingen rigtige penge flytter sig)\n\nHandlingen kan ikke fortrydes (board-profiler nulstilles).")}
          disabled={loading["open-test"]}
          className="px-3 py-2 text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/40 rounded-lg hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
          {loading["open-test"] ? "..." : "Åbn board for test"}
        </button>
        <button
          onClick={() => handleBoardTest("close-test", "Luk board-test-tilstanden?\n\nØkonomi-frysningen ophæves (board_test_mode=false). Board-data og window-state efterlades urørt.")}
          disabled={loading["close-test"]}
          className="px-3 py-2 text-xs bg-cz-subtle text-cz-2 border border-cz-border rounded-lg hover:bg-cz-hover disabled:opacity-50 transition-all">
          {loading["close-test"] ? "..." : "Luk board-test"}
        </button>
      </div>
      {result && (
        <div className="mt-3 bg-cz-subtle border border-cz-border rounded-lg p-3 text-xs text-cz-2 font-mono">
          <p className="font-semibold mb-1">Kvittering — board/{result.action}</p>
          <p>board_test_mode: {String(result.board_test_mode)}{result.window_id ? ` · window: ${result.window_id}` : ""}</p>
          {result.board_profiles_reset && (
            <p className="mt-1">Bestyrelser reset: {result.board_profiles_reset.reset} · oprettet: {result.board_profiles_reset.created}</p>
          )}
          {result.negotiation && (
            <p className="mt-1">Onboarding åbnet: baseline-rows slettet {result.negotiation.baseline_rows_deleted} · window-state {result.negotiation.window_state}</p>
          )}
        </div>
      )}
    </>
  );
}
