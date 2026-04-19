import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import RiderFilters from "../components/RiderFilters";
import { useClientRiderFilters } from "../lib/useRiderFilters";
import { statBg } from "../lib/statBg";
import { ConfettiModal } from "../components/ConfettiModal";

const API = import.meta.env.VITE_API_URL;

function timeAgo(d) {
  if (!d) return "—";
  const diff = new Date() - new Date(d);
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (m < 1) return "Lige nu";
  if (m < 60) return `${m}m siden`;
  if (h < 24) return `${h}t siden`;
  return `${day}d siden`;
}

const STATUS_CONFIG = {
  pending:                { label: "Afventer svar",        color: "text-[#e8c547]",  bg: "bg-[#e8c547]/10 border-[#e8c547]/20" },
  countered:              { label: "Modbud sendt",          color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" },
  awaiting_confirmation:  { label: "Afventer bekræftelse",  color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/20" },
  accepted:               { label: "Accepteret",            color: "text-green-400",  bg: "bg-green-500/10 border-green-500/20" },
  rejected:               { label: "Afvist",                color: "text-red-400",    bg: "bg-red-500/10 border-red-500/20" },
  withdrawn:              { label: "Trukket tilbage",       color: "text-white/30",   bg: "bg-white/5 border-white/10" },
};

// ── Modtaget tilbud ──────────────────────────────────────────────────────────
function ReceivedOfferCard({ offer, onAction }) {
  const [counterAmt, setCounterAmt] = useState(offer.offer_amount || 0);
  const [msg, setMsg] = useState("");
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);

  const isPending = offer.status === "pending";
  const isAwaiting = offer.status === "awaiting_confirmation";
  const isActive = isPending || isAwaiting;
  const cfg = STATUS_CONFIG[offer.status] || STATUS_CONFIG.pending;
  const price = (offer.counter_amount || offer.offer_amount)?.toLocaleString("da-DK");

  async function doAction(action, extra = {}) {
    setLoading(true);
    await onAction(offer.id, action, extra);
    setMode(null);
    setLoading(false);
  }

  return (
    <div className={`bg-[#0f0f18] border rounded-xl p-5 transition-all
      ${isAwaiting ? "border-blue-500/30" : isPending ? "border-[#e8c547]/20" : "border-white/5 opacity-70"}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-white font-semibold">{offer.rider?.firstname} {offer.rider?.lastname}</p>
          <p className="text-white/30 text-xs">Fra: {offer.buyer?.name} · Runde {offer.round || 1} · {timeAgo(offer.created_at)}</p>
        </div>
        <span className={`text-[10px] uppercase px-2 py-1 rounded-full border font-medium ${cfg.bg} ${cfg.color}`}>
          {cfg.label}
        </span>
      </div>

      <div className="bg-white/3 rounded-lg px-4 py-3 mb-3 flex items-center justify-between">
        <div>
          <p className="text-white/30 text-xs uppercase tracking-wider mb-0.5">
            {offer.status === "countered" ? "Dit modbud" : "Tilbud"}
          </p>
          <p className="text-[#e8c547] font-mono font-bold text-xl">
            {(offer.status === "countered" ? offer.counter_amount : offer.offer_amount)?.toLocaleString("da-DK")} CZ$
          </p>
        </div>
        <div className="text-right">
          <p className="text-white/30 text-xs">UCI-pris</p>
          <p className="text-white/50 font-mono text-sm">{offer.rider?.uci_points?.toLocaleString("da-DK")} CZ$</p>
        </div>
      </div>

      {offer.message && (
        <div className="bg-white/3 rounded-lg px-3 py-2 mb-3 text-white/50 text-xs italic">
          "{offer.message}"
        </div>
      )}

      {isPending && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button onClick={() => doAction("accept")} disabled={loading}
              className="flex-1 py-2 bg-green-500/15 text-green-400 border border-green-500/25 rounded-lg text-sm font-medium hover:bg-green-500/25 transition-all disabled:opacity-50">
              ✓ Accepter
            </button>
            <button onClick={() => setMode(mode === "counter" ? null : "counter")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all
                ${mode === "counter"
                  ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                  : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10"}`}>
              ↔ Modbud
            </button>
            <button onClick={() => doAction("reject")} disabled={loading}
              className="flex-1 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-all disabled:opacity-50">
              ✕ Afvis
            </button>
          </div>

          {mode === "counter" && (
            <div className="bg-white/3 rounded-lg p-3 flex flex-col gap-2">
              <label className="text-white/30 text-xs uppercase tracking-wider">Dit modbud (CZ$)</label>
              <div className="flex gap-2">
                <input type="number" value={counterAmt}
                  onChange={e => setCounterAmt(parseInt(e.target.value) || 0)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-[#e8c547]/50" />
                <button onClick={() => doAction("counter", { counter_amount: counterAmt, message: msg })}
                  disabled={loading || counterAmt <= 0}
                  className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-50">
                  Send
                </button>
              </div>
              <input type="text" value={msg} onChange={e => setMsg(e.target.value)}
                placeholder="Valgfri besked til køber..."
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none" />
            </div>
          )}
        </div>
      )}

      {isAwaiting && (
        <div className="flex flex-col gap-2">
          {offer.seller_confirmed ? (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3 text-center">
              <p className="text-blue-300 text-sm font-medium">Du har accepteret — afventer købers bekræftelse</p>
              <p className="text-white/30 text-xs mt-1">{price} CZ$ · {offer.buyer?.name}</p>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => doAction("confirm")} disabled={loading}
                className="flex-1 py-2 bg-blue-500/15 text-blue-400 border border-blue-500/25 rounded-lg text-sm font-medium hover:bg-blue-500/25 transition-all disabled:opacity-50">
                ✓ Bekræft handel ({price} CZ$)
              </button>
            </div>
          )}
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="w-full py-2 bg-red-500/5 text-red-400/70 border border-red-500/15 rounded-lg text-sm
              hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all disabled:opacity-50">
            Annuller handel
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sendt tilbud ─────────────────────────────────────────────────────────────
function SentOfferCard({ offer, onAction }) {
  const [newAmt, setNewAmt] = useState(offer.counter_amount || offer.offer_amount || 0);
  const [msg, setMsg] = useState("");
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);

  const isCountered = offer.status === "countered";
  const isPending = offer.status === "pending";
  const isAwaiting = offer.status === "awaiting_confirmation";
  const isActive = isCountered || isPending || isAwaiting;
  const cfg = STATUS_CONFIG[offer.status] || STATUS_CONFIG.pending;
  const price = (offer.counter_amount || offer.offer_amount)?.toLocaleString("da-DK");

  async function doAction(action, extra = {}) {
    setLoading(true);
    await onAction(offer.id, action, extra);
    setMode(null);
    setLoading(false);
  }

  return (
    <div className={`bg-[#0f0f18] border rounded-xl p-5 transition-all
      ${isAwaiting ? "border-blue-500/30" : isCountered ? "border-orange-500/20" : isActive ? "border-white/10" : "border-white/5 opacity-60"}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-white font-semibold">{offer.rider?.firstname} {offer.rider?.lastname}</p>
          <p className="text-white/30 text-xs">Til: {offer.seller?.name} · Runde {offer.round || 1} · {timeAgo(offer.updated_at)}</p>
        </div>
        <span className={`text-[10px] uppercase px-2 py-1 rounded-full border font-medium ${cfg.bg} ${cfg.color}`}>
          {cfg.label}
        </span>
      </div>

      <div className="bg-white/3 rounded-lg px-4 py-3 mb-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white/30 text-xs uppercase tracking-wider mb-0.5">Dit bud</p>
            <p className="text-white font-mono font-bold text-lg">{offer.offer_amount?.toLocaleString("da-DK")} CZ$</p>
          </div>
          {isCountered && offer.counter_amount && (
            <div className="text-right">
              <p className="text-white/30 text-xs uppercase tracking-wider mb-0.5">Modbud</p>
              <p className="text-orange-400 font-mono font-bold text-lg">{offer.counter_amount?.toLocaleString("da-DK")} CZ$</p>
            </div>
          )}
        </div>
      </div>

      {offer.message && (
        <div className="bg-white/3 rounded-lg px-3 py-2 mb-3 text-white/50 text-xs italic">
          "{offer.message}"
        </div>
      )}

      {isCountered && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button onClick={() => doAction("accept_counter")} disabled={loading}
              className="flex-1 py-2 bg-green-500/15 text-green-400 border border-green-500/25 rounded-lg text-sm font-medium hover:bg-green-500/25 disabled:opacity-50">
              ✓ Accepter ({offer.counter_amount?.toLocaleString("da-DK")} CZ$)
            </button>
            <button onClick={() => setMode(mode === "new_offer" ? null : "new_offer")}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all
                ${mode === "new_offer"
                  ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                  : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10"}`}>
              Nyt bud
            </button>
            <button onClick={() => doAction("withdraw")} disabled={loading}
              className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm font-medium hover:bg-red-500/20 disabled:opacity-50">
              Træk tilbage
            </button>
          </div>

          {mode === "new_offer" && (
            <div className="bg-white/3 rounded-lg p-3 flex flex-col gap-2">
              <label className="text-white/30 text-xs uppercase tracking-wider">Nyt tilbud (CZ$)</label>
              <div className="flex gap-2">
                <input type="number" value={newAmt}
                  onChange={e => setNewAmt(parseInt(e.target.value) || 0)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-[#e8c547]/50" />
                <button onClick={() => doAction("new_offer", { counter_amount: newAmt, message: msg })}
                  disabled={loading || newAmt <= 0}
                  className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-50">
                  Send
                </button>
              </div>
              <input type="text" value={msg} onChange={e => setMsg(e.target.value)}
                placeholder="Valgfri besked..."
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none" />
            </div>
          )}
        </div>
      )}

      {isPending && (
        <button onClick={() => doAction("withdraw")} disabled={loading}
          className="w-full py-2 bg-white/5 text-white/30 border border-white/8 rounded-lg text-sm
            hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all disabled:opacity-50">
          Træk tilbud tilbage
        </button>
      )}

      {isAwaiting && (
        <div className="flex flex-col gap-2">
          {offer.buyer_confirmed ? (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3 text-center">
              <p className="text-blue-300 text-sm font-medium">Du har bekræftet — afventer sælgers bekræftelse</p>
              <p className="text-white/30 text-xs mt-1">{price} CZ$ · {offer.seller?.name}</p>
            </div>
          ) : (
            <button onClick={() => doAction("confirm")} disabled={loading}
              className="w-full py-2 bg-blue-500/15 text-blue-400 border border-blue-500/25 rounded-lg text-sm font-medium hover:bg-blue-500/25 transition-all disabled:opacity-50">
              ✓ Bekræft handel ({price} CZ$)
            </button>
          )}
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="w-full py-2 bg-red-500/5 text-red-400/70 border border-red-500/15 rounded-lg text-sm
              hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all disabled:opacity-50">
            Annuller handel
          </button>
        </div>
      )}
    </div>
  );
}

// ── Swap offer card ──────────────────────────────────────────────────────────
function SwapCard({ swap, myTeamId, onAction }) {
  const [counterCash, setCounterCash] = useState(swap.counter_cash ?? swap.cash_adjustment ?? 0);
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);

  const isProposing  = swap.proposing?.id === myTeamId;
  const isReceiving  = swap.receiving?.id === myTeamId;
  const isPending    = swap.status === "pending";
  const isCountered  = swap.status === "countered";
  const isAwaiting   = swap.status === "awaiting_confirmation";
  const cfg = STATUS_CONFIG[swap.status] || STATUS_CONFIG.pending;

  const effectiveCash = isCountered ? swap.counter_cash : swap.cash_adjustment;
  const cashLabel = effectiveCash === 0 ? "Ren bytte"
    : effectiveCash > 0 ? `+${effectiveCash.toLocaleString("da-DK")} CZ$ fra ${swap.proposing?.name}`
    : `+${Math.abs(effectiveCash).toLocaleString("da-DK")} CZ$ fra ${swap.receiving?.name}`;

  async function doAction(action, extra = {}) {
    setLoading(true);
    await onAction(swap.id, action, extra);
    setMode(null);
    setLoading(false);
  }

  return (
    <div className={`bg-[#0f0f18] border rounded-xl p-5 transition-all
      ${isAwaiting ? "border-blue-500/30" : isCountered ? "border-orange-500/20" : isPending ? "border-white/10" : "border-white/5 opacity-60"}`}>

      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-white/30 text-xs">
            {isProposing ? `Til: ${swap.receiving?.name}` : `Fra: ${swap.proposing?.name}`}
          </p>
        </div>
        <span className={`text-[10px] uppercase px-2 py-1 rounded-full border font-medium ${cfg.bg} ${cfg.color}`}>
          {cfg.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        {[
          { label: isProposing ? "Du tilbyder" : "De tilbyder", rider: swap.offered },
          { label: isProposing ? "Du ønsker"  : "De ønsker",   rider: swap.requested },
        ].map(({ label, rider }) => (
          <div key={rider?.id} className="bg-white/3 rounded-lg px-3 py-2">
            <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">{label}</p>
            <p className="text-white text-sm font-semibold">{rider?.firstname} {rider?.lastname}</p>
            <div className="flex gap-2 mt-1">
              {[["BJ", "stat_bj"], ["SP", "stat_sp"], ["TT", "stat_tt"], ["FL", "stat_fl"]].map(([l, k]) => (
                <span key={k} className="text-[10px] text-white/30">{l}<span className="text-white/60 ml-0.5">{rider?.[k] ?? "—"}</span></span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={`rounded-lg px-3 py-2 mb-3 text-xs text-center font-medium
        ${effectiveCash === 0 ? "bg-white/3 text-white/40" : "bg-[#e8c547]/8 text-[#e8c547]/80"}`}>
        {cashLabel}
        {isCountered && <span className="text-orange-400 ml-2">(modbud)</span>}
      </div>

      {swap.message && (
        <div className="bg-white/3 rounded-lg px-3 py-2 mb-3 text-white/50 text-xs italic">
          "{swap.message}"
        </div>
      )}

      {isPending && isReceiving && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button onClick={() => doAction("accept")} disabled={loading}
              className="flex-1 py-2 bg-green-500/15 text-green-400 border border-green-500/25 rounded-lg text-sm font-medium hover:bg-green-500/25 disabled:opacity-50">
              ✓ Accepter
            </button>
            <button onClick={() => setMode(mode === "counter" ? null : "counter")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all
                ${mode === "counter" ? "bg-orange-500/20 text-orange-400 border-orange-500/30" : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10"}`}>
              ↔ Modbud
            </button>
            <button onClick={() => doAction("reject")} disabled={loading}
              className="flex-1 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm font-medium hover:bg-red-500/20 disabled:opacity-50">
              ✕ Afvis
            </button>
          </div>
          {mode === "counter" && (
            <div className="bg-white/3 rounded-lg p-3 flex flex-col gap-2">
              <label className="text-white/30 text-xs uppercase tracking-wider">Kontantbetaling (CZ$) · positiv = du modtager, negativ = du betaler</label>
              <div className="flex gap-2">
                <input type="number" value={counterCash}
                  onChange={e => setCounterCash(parseInt(e.target.value) || 0)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-[#e8c547]/50" />
                <button onClick={() => doAction("counter", { counter_cash: -counterCash })}
                  disabled={loading}
                  className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-50">
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isPending && isProposing && (
        <button onClick={() => doAction("withdraw")} disabled={loading}
          className="w-full py-2 bg-white/5 text-white/30 border border-white/8 rounded-lg text-sm
            hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all disabled:opacity-50">
          Træk forslag tilbage
        </button>
      )}

      {isCountered && isProposing && (
        <div className="flex gap-2">
          <button onClick={() => doAction("accept_counter")} disabled={loading}
            className="flex-1 py-2 bg-green-500/15 text-green-400 border border-green-500/25 rounded-lg text-sm font-medium hover:bg-green-500/25 disabled:opacity-50">
            ✓ Accepter modbud
          </button>
          <button onClick={() => doAction("withdraw")} disabled={loading}
            className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm hover:bg-red-500/20 disabled:opacity-50">
            Afvis
          </button>
        </div>
      )}

      {isAwaiting && (
        <div className="flex flex-col gap-2">
          {(isProposing ? swap.proposing_confirmed : swap.receiving_confirmed) ? (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3 text-center">
              <p className="text-blue-300 text-sm font-medium">Du har bekræftet — afventer den anden part</p>
            </div>
          ) : (
            <button onClick={() => doAction("confirm")} disabled={loading}
              className="w-full py-2 bg-blue-500/15 text-blue-400 border border-blue-500/25 rounded-lg text-sm font-medium hover:bg-blue-500/25 disabled:opacity-50">
              ✓ Bekræft byttehandel
            </button>
          )}
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="w-full py-2 bg-red-500/5 text-red-400/70 border border-red-500/15 rounded-lg text-sm
              hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all disabled:opacity-50">
            Annuller handel
          </button>
        </div>
      )}
    </div>
  );
}

// ── New swap form ─────────────────────────────────────────────────────────────
function NewSwapForm({ myRiders, onSubmit, onCancel }) {
  const [offeredId, setOfferedId]   = useState("");
  const [requestedId, setRequestedId] = useState("");
  const [cash, setCash]             = useState(0);
  const [msg, setMsg]               = useState("");
  const [search, setSearch]         = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedRequested, setSelectedRequested] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [searching, setSearching]   = useState(false);

  async function runSearch(q) {
    if (q.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("riders")
      .select("id, firstname, lastname, uci_points, team_id, team:team_id(name)")
      .ilike("lastname", `%${q}%`)
      .not("team_id", "is", null)
      .limit(20);
    setSearchResults((data || []).filter(r => !myRiders.find(m => m.id === r.id)));
    setSearching(false);
  }

  function pickRequested(rider) {
    setSelectedRequested(rider);
    setRequestedId(rider.id);
    setSearch(`${rider.firstname} ${rider.lastname}`);
    setSearchResults([]);
  }

  async function handleSubmit() {
    if (!offeredId || !requestedId) return;
    setLoading(true);
    await onSubmit({ offered_rider_id: offeredId, requested_rider_id: requestedId, cash_adjustment: cash, message: msg });
    setLoading(false);
  }

  return (
    <div className="bg-[#0f0f18] border border-white/10 rounded-xl p-5 flex flex-col gap-4">
      <h3 className="text-white font-semibold">Foreslå byttehandel</h3>

      <div>
        <label className="text-white/30 text-xs uppercase tracking-wider mb-1 block">Din rytter du tilbyder</label>
        <select value={offeredId} onChange={e => setOfferedId(e.target.value)}
          className="w-full bg-[#1a1a2e] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50">
          <option value="">— Vælg rytter —</option>
          {myRiders.map(r => (
            <option key={r.id} value={r.id}>{r.firstname} {r.lastname} (UCI {r.uci_points?.toLocaleString("da-DK")})</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-white/30 text-xs uppercase tracking-wider mb-1 block">Rytter du ønsker (søg på efternavn)</label>
        <div className="relative">
          <input type="text" value={search}
            onChange={e => { setSearch(e.target.value); runSearch(e.target.value); }}
            placeholder="Efternavn..."
            className="w-full bg-[#1a1a2e] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50" />
          {searching && <span className="absolute right-3 top-2.5 text-white/30 text-xs">...</span>}
          {searchResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-[#1a1a2e] border border-white/15 rounded-lg overflow-hidden shadow-lg">
              {searchResults.map(r => (
                <button key={r.id} onClick={() => pickRequested(r)}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 text-white text-sm border-b border-white/5 last:border-0">
                  {r.firstname} {r.lastname}
                  <span className="text-white/30 text-xs ml-2">{r.team?.name} · UCI {r.uci_points?.toLocaleString("da-DK")}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {selectedRequested && (
          <p className="text-[#e8c547]/70 text-xs mt-1">Valgt: {selectedRequested.firstname} {selectedRequested.lastname} ({selectedRequested.team?.name})</p>
        )}
      </div>

      <div>
        <label className="text-white/30 text-xs uppercase tracking-wider mb-1 block">
          Kontantbetaling fra dig (CZ$) · 0 = ren bytte · negativt = du modtager
        </label>
        <input type="number" value={cash} onChange={e => setCash(parseInt(e.target.value) || 0)}
          className="w-full bg-[#1a1a2e] border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-[#e8c547]/50" />
      </div>

      <div>
        <label className="text-white/30 text-xs uppercase tracking-wider mb-1 block">Besked (valgfri)</label>
        <input type="text" value={msg} onChange={e => setMsg(e.target.value)}
          placeholder="Fx. begrundelse eller kommentar..."
          className="w-full bg-[#1a1a2e] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none" />
      </div>

      <div className="flex gap-2">
        <button onClick={handleSubmit} disabled={loading || !offeredId || !requestedId}
          className="flex-1 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-40">
          {loading ? "Sender..." : "Send forslag"}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 bg-white/5 text-white/50 border border-white/10 rounded-lg text-sm hover:bg-white/10">
          Annuller
        </button>
      </div>
    </div>
  );
}

// ── Loan agreement card ───────────────────────────────────────────────────────
const LOAN_STATUS_CONFIG = {
  pending:   { label: "Afventer svar",  color: "text-[#e8c547]",   bg: "bg-[#e8c547]/10 border-[#e8c547]/20" },
  active:    { label: "Aktiv",          color: "text-purple-400",  bg: "bg-purple-500/10 border-purple-500/20" },
  buyout:    { label: "Købt",           color: "text-green-400",   bg: "bg-green-500/10 border-green-500/20" },
  cancelled: { label: "Annulleret",     color: "text-white/30",    bg: "bg-white/5 border-white/10" },
  rejected:  { label: "Afvist",         color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20" },
};

function LoanCard({ loan, myTeamId, onAction }) {
  const [loading, setLoading] = useState(false);
  const isLender   = loan.from_team?.id === myTeamId;
  const isBorrower = loan.to_team?.id   === myTeamId;
  const cfg = LOAN_STATUS_CONFIG[loan.status] || LOAN_STATUS_CONFIG.pending;

  async function doAction(action) {
    setLoading(true);
    await onAction(loan.id, action);
    setLoading(false);
  }

  const seasons = loan.start_season === loan.end_season
    ? `Sæson ${loan.start_season}`
    : `Sæson ${loan.start_season}–${loan.end_season}`;

  return (
    <div className={`bg-[#0f0f18] border rounded-xl p-5 transition-all
      ${loan.status === "active" ? "border-purple-500/20" : loan.status === "pending" ? "border-[#e8c547]/20" : "border-white/5 opacity-70"}`}>

      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-white font-semibold">{loan.rider?.firstname} {loan.rider?.lastname}</p>
          <p className="text-white/30 text-xs">
            {isLender ? `Til: ${loan.to_team?.name}` : `Fra: ${loan.from_team?.name}`} · {seasons}
          </p>
        </div>
        <span className={`text-[10px] uppercase px-2 py-1 rounded-full border font-medium ${cfg.bg} ${cfg.color}`}>
          {cfg.label}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-white/3 rounded-lg px-3 py-2 text-center">
          <p className="text-white/25 text-[10px] uppercase tracking-wider mb-0.5">Lejegebyr/sæson</p>
          <p className="text-white font-mono text-sm font-bold">{loan.loan_fee?.toLocaleString("da-DK")} CZ$</p>
        </div>
        <div className="bg-white/3 rounded-lg px-3 py-2 text-center">
          <p className="text-white/25 text-[10px] uppercase tracking-wider mb-0.5">UCI-værdi</p>
          <p className="text-[#e8c547] font-mono text-sm font-bold">{loan.rider?.uci_points?.toLocaleString("da-DK")}</p>
        </div>
        <div className="bg-white/3 rounded-lg px-3 py-2 text-center">
          <p className="text-white/25 text-[10px] uppercase tracking-wider mb-0.5">Købsoption</p>
          <p className="text-white/50 font-mono text-sm">
            {loan.buy_option_price ? `${loan.buy_option_price.toLocaleString("da-DK")} CZ$` : "—"}
          </p>
        </div>
      </div>

      {loan.status === "pending" && isLender && (
        <div className="flex gap-2">
          <button onClick={() => doAction("accept")} disabled={loading}
            className="flex-1 py-2 bg-green-500/15 text-green-400 border border-green-500/25 rounded-lg text-sm font-medium hover:bg-green-500/25 disabled:opacity-50">
            ✓ Accepter
          </button>
          <button onClick={() => doAction("reject")} disabled={loading}
            className="flex-1 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm font-medium hover:bg-red-500/20 disabled:opacity-50">
            ✕ Afvis
          </button>
        </div>
      )}
      {loan.status === "pending" && isBorrower && (
        <button onClick={() => doAction("cancel")} disabled={loading}
          className="w-full py-2 bg-white/5 text-white/30 border border-white/8 rounded-lg text-sm
            hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all disabled:opacity-50">
          Træk forslag tilbage
        </button>
      )}
      {loan.status === "active" && (
        <div className="flex flex-col gap-2">
          {isBorrower && loan.buy_option_price && (
            <button onClick={() => doAction("buyout")} disabled={loading}
              className="w-full py-2 bg-green-500/15 text-green-400 border border-green-500/25 rounded-lg text-sm font-medium hover:bg-green-500/25 disabled:opacity-50">
              Udnyt købsoption ({loan.buy_option_price?.toLocaleString("da-DK")} CZ$)
            </button>
          )}
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="w-full py-2 bg-red-500/5 text-red-400/70 border border-red-500/15 rounded-lg text-sm
              hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all disabled:opacity-50">
            Annuller lejeaftale
          </button>
        </div>
      )}
    </div>
  );
}

// ── New loan form ─────────────────────────────────────────────────────────────
function NewLoanForm({ myTeamId, onSubmit, onCancel }) {
  const [search, setSearch]           = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedRider, setSelectedRider] = useState(null);
  const [loanFee, setLoanFee]         = useState(0);
  const [startSeason, setStartSeason] = useState("");
  const [endSeason, setEndSeason]     = useState("");
  const [buyOption, setBuyOption]     = useState("");
  const [loading, setLoading]         = useState(false);
  const [searching, setSearching]     = useState(false);

  async function runSearch(q) {
    if (q.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("riders")
      .select("id, firstname, lastname, uci_points, team_id, team:team_id(id, name)")
      .ilike("lastname", `%${q}%`)
      .not("team_id", "is", null)
      .limit(20);
    setSearchResults((data || []).filter(r => r.team_id !== myTeamId));
    setSearching(false);
  }

  async function handleSubmit() {
    if (!selectedRider || !startSeason || !endSeason) return;
    setLoading(true);
    await onSubmit({
      rider_id: selectedRider.id,
      loan_fee: loanFee,
      start_season: parseInt(startSeason),
      end_season: parseInt(endSeason),
      buy_option_price: buyOption ? parseInt(buyOption) : null,
    });
    setLoading(false);
  }

  return (
    <div className="bg-[#0f0f18] border border-white/10 rounded-xl p-5 flex flex-col gap-4">
      <h3 className="text-white font-semibold">Foreslå lejeaftale</h3>

      <div>
        <label className="text-white/30 text-xs uppercase tracking-wider mb-1 block">Rytter du ønsker at leje (søg på efternavn)</label>
        <div className="relative">
          <input type="text" value={search}
            onChange={e => { setSearch(e.target.value); runSearch(e.target.value); }}
            placeholder="Efternavn..."
            className="w-full bg-[#1a1a2e] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50" />
          {searching && <span className="absolute right-3 top-2.5 text-white/30 text-xs">...</span>}
          {searchResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-[#1a1a2e] border border-white/15 rounded-lg overflow-hidden shadow-lg">
              {searchResults.map(r => (
                <button key={r.id} onClick={() => { setSelectedRider(r); setSearch(`${r.firstname} ${r.lastname}`); setSearchResults([]); }}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 text-white text-sm border-b border-white/5 last:border-0">
                  {r.firstname} {r.lastname}
                  <span className="text-white/30 text-xs ml-2">{r.team?.name} · UCI {r.uci_points?.toLocaleString("da-DK")}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {selectedRider && (
          <p className="text-purple-400/70 text-xs mt-1">Valgt: {selectedRider.firstname} {selectedRider.lastname} ({selectedRider.team?.name})</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-white/30 text-xs uppercase tracking-wider mb-1 block">Fra sæson</label>
          <input type="number" value={startSeason} onChange={e => setStartSeason(e.target.value)}
            placeholder="fx. 3"
            className="w-full bg-[#1a1a2e] border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-[#e8c547]/50" />
        </div>
        <div>
          <label className="text-white/30 text-xs uppercase tracking-wider mb-1 block">Til sæson</label>
          <input type="number" value={endSeason} onChange={e => setEndSeason(e.target.value)}
            placeholder="fx. 4"
            className="w-full bg-[#1a1a2e] border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-[#e8c547]/50" />
        </div>
      </div>

      <div>
        <label className="text-white/30 text-xs uppercase tracking-wider mb-1 block">Lejegebyr per sæson (CZ$)</label>
        <input type="number" value={loanFee} onChange={e => setLoanFee(parseInt(e.target.value) || 0)}
          className="w-full bg-[#1a1a2e] border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-[#e8c547]/50" />
      </div>

      <div>
        <label className="text-white/30 text-xs uppercase tracking-wider mb-1 block">Købsoption (CZ$) — valgfri</label>
        <input type="number" value={buyOption} onChange={e => setBuyOption(e.target.value)}
          placeholder="Efterlad tom for ingen option"
          className="w-full bg-[#1a1a2e] border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-[#e8c547]/50" />
      </div>

      <div className="flex gap-2">
        <button onClick={handleSubmit} disabled={loading || !selectedRider || !startSeason || !endSeason}
          className="flex-1 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-40">
          {loading ? "Sender..." : "Send forslag"}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 bg-white/5 text-white/50 border border-white/10 rounded-lg text-sm hover:bg-white/10">
          Annuller
        </button>
      </div>
    </div>
  );
}

// ── Transfer market listing card ─────────────────────────────────────────────
function TransferCard({ listing, myTeamId, onOffer, windowOpen = true }) {
  const navigate = useNavigate();
  const [offerAmt, setOfferAmt] = useState(listing.asking_price || 0);
  const [msg, setMsg] = useState("");
  const [showOffer, setShowOffer] = useState(false);
  const [loading, setLoading] = useState(false);

  const isOwn = listing.seller?.id === myTeamId;

  return (
    <div className="bg-[#0f0f18] border border-white/5 hover:border-white/10 rounded-xl p-4 transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="cursor-pointer" onClick={() => navigate(`/riders/${listing.rider?.id}`)}>
          <p className="text-white font-semibold hover:text-[#e8c547] transition-colors">
            {listing.rider?.firstname} {listing.rider?.lastname}
          </p>
          <p className="text-white/30 text-xs mt-0.5">{listing.seller?.name}</p>
        </div>
        <div className="text-right">
          <p className="text-[#e8c547] font-mono font-bold text-lg">{listing.asking_price?.toLocaleString("da-DK")} CZ$</p>
          <p className="text-white/30 text-xs">UCI: {listing.rider?.uci_points?.toLocaleString("da-DK")}</p>
        </div>
      </div>

      <div className="flex gap-3 mb-3">
        {[["BJ", "stat_bj"], ["SP", "stat_sp"], ["TT", "stat_tt"], ["FL", "stat_fl"]].map(([label, key]) => (
          <div key={key} className="text-center">
            <p className="text-white/25 text-[9px] uppercase">{label}</p>
            <span className={`inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded ${statBg(listing.rider?.[key] || 0)}`}>
              {listing.rider?.[key] || "—"}
            </span>
          </div>
        ))}
      </div>

      {!isOwn && (
        <div>
          <button onClick={() => windowOpen && setShowOffer(!showOffer)} disabled={!windowOpen}
            className={`w-full py-2 rounded-lg text-sm font-medium transition-all border
              ${!windowOpen
                ? "bg-white/3 text-white/20 border-white/5 cursor-not-allowed"
                : showOffer
                  ? "bg-[#e8c547]/15 text-[#e8c547] border-[#e8c547]/25"
                  : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white"}`}>
            {!windowOpen ? "Vindue lukket" : showOffer ? "Skjul" : "Send tilbud"}
          </button>

          {showOffer && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex gap-2">
                <input type="number" value={offerAmt}
                  onChange={e => setOfferAmt(parseInt(e.target.value) || 0)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-[#e8c547]/50" />
                <button
                  onClick={async () => {
                    setLoading(true);
                    await onOffer(listing.rider?.id, offerAmt, msg);
                    setShowOffer(false);
                    setLoading(false);
                  }}
                  disabled={loading || offerAmt <= 0}
                  className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-50">
                  {loading ? "..." : "Send"}
                </button>
              </div>
              <input type="text" value={msg} onChange={e => setMsg(e.target.value)}
                placeholder="Besked (valgfri)..."
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none" />
            </div>
          )}
        </div>
      )}
      {isOwn && (
        <p className="text-white/20 text-xs text-center py-1">Din listing</p>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function TransfersPage() {
  const [tab, setTab] = useState("received");
  const [listings, setListings] = useState([]);
  const [sentOffers, setSentOffers] = useState([]);
  const [receivedOffers, setReceivedOffers] = useState([]);
  const [sentSwaps, setSentSwaps] = useState([]);
  const [receivedSwaps, setReceivedSwaps] = useState([]);
  const [lendingLoans, setLendingLoans] = useState([]);
  const [borrowingLoans, setBorrowingLoans] = useState([]);
  const [myRiders, setMyRiders] = useState([]);
  const [showNewSwap, setShowNewSwap] = useState(false);
  const [showNewLoan, setShowNewLoan] = useState(false);
  const [myTeamId, setMyTeamId] = useState(null);
  const [myBalance, setMyBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [celebration, setCelebration] = useState(null);
  const [msg, setMsg] = useState({ text: "", type: "success" });
  const [transferWindow, setTransferWindow] = useState({ open: true, status: "open" });

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: team } = await supabase.from("teams").select("id, balance").eq("user_id", user.id).single();
    if (!team) { setLoading(false); return; }
    setMyTeamId(team.id);
    setMyBalance(team.balance);

    const { data: { session } } = await supabase.auth.getSession();
    const headers = { Authorization: `Bearer ${session.access_token}` };

    const [listingsRes, offersRes, swapsRes, loansRes, ridersRes, windowRes] = await Promise.all([
      fetch(`${API}/api/transfers`, { headers }).then(r => r.json()),
      fetch(`${API}/api/transfers/my-offers`, { headers }).then(r => r.json()),
      fetch(`${API}/api/transfers/swaps`, { headers }).then(r => r.json()),
      fetch(`${API}/api/loans`, { headers }).then(r => r.json()),
      supabase.from("riders").select("id, firstname, lastname, uci_points").eq("team_id", team.id).order("lastname"),
      fetch(`${API}/api/transfer-window`, { headers }).then(r => r.json()),
    ]);

    setListings(Array.isArray(listingsRes) ? listingsRes : []);
    setSentOffers(offersRes.sent || []);
    setReceivedOffers(offersRes.received || []);
    setSentSwaps(swapsRes.sent || []);
    setReceivedSwaps(swapsRes.received || []);
    setLendingLoans(loansRes.lending || []);
    setBorrowingLoans(loansRes.borrowing || []);
    setMyRiders(ridersRes.data || []);
    setTransferWindow(windowRes?.open !== undefined ? windowRes : { open: true, status: "open" });
    setLoading(false);
  }

  async function getHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    return { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
  }

  function showMsg(text, type = "success") {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: "" }), 4000);
  }

  async function handleOffer(riderId, amount, message) {
    const res = await fetch(`${API}/api/transfers/offer`, {
      method: "POST",
      headers: await getHeaders(),
      body: JSON.stringify({ rider_id: riderId, offer_amount: amount, message }),
    });
    const data = await res.json();
    if (res.ok) { showMsg("✅ Tilbud sendt!"); loadAll(); setTab("sent"); }
    else showMsg(`❌ ${data.error}`, "error");
  }

  async function handleOfferAction(offerId, action, extra = {}) {
    const res = await fetch(`${API}/api/transfers/offers/${offerId}`, {
      method: "PATCH",
      headers: await getHeaders(),
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json();
    if (res.ok) {
      if (action === "confirm" && data.action === "accepted") {
        setCelebration({
          title: "Transfer gennemført! 🎉",
          subtitle: "Rytteren er nu på dit hold",
          amount: data.price || 0,
          icon: "↔",
        });
        fetch(`${API}/api/achievements/check`, {
          method: "POST",
          headers: await getHeaders(),
          body: JSON.stringify({ context: "transfer_done", data: {} }),
        }).catch(() => {});
      } else {
        const msgs = {
          accept:          "✅ Accepteret — køber skal nu bekræfte handlen",
          accept_counter:  "✅ Accepteret — sælger skal nu bekræfte handlen",
          confirm:         "✅ Bekræftet — afventer den anden parts bekræftelse",
          cancel:          "Handel annulleret",
          reject:          "Transfer afvist",
          counter:         "↔ Modbud sendt",
          new_offer:       "↔ Nyt bud sendt",
          withdraw:        "Tilbud trukket tilbage",
        };
        showMsg(msgs[action] || "✅ Opdateret");
      }
      loadAll();
    } else {
      showMsg(`❌ ${data.error}`, "error");
    }
  }

  async function handleSwapAction(swapId, action, extra = {}) {
    const res = await fetch(`${API}/api/transfers/swaps/${swapId}`, {
      method: "PATCH",
      headers: await getHeaders(),
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json();
    if (res.ok) {
      if (action === "confirm" && data.action === "accepted") {
        setCelebration({
          title: "Byttehandel gennemført! 🎉",
          subtitle: "Ryttere er nu skiftet",
          amount: 0,
          icon: "↔",
        });
      } else {
        const msgs = {
          accept:         "✅ Accepteret — afventer bekræftelse",
          accept_counter: "✅ Accepteret — afventer bekræftelse",
          confirm:        "✅ Bekræftet — afventer den anden part",
          cancel:         "Byttehandel annulleret",
          reject:         "Byttehandel afvist",
          counter:        "↔ Modbud sendt",
          withdraw:       "Forslag trukket tilbage",
        };
        showMsg(msgs[action] || "✅ Opdateret");
      }
      loadAll();
    } else {
      showMsg(`❌ ${data.error}`, "error");
    }
  }

  async function handleNewSwap(payload) {
    const res = await fetch(`${API}/api/transfers/swaps`, {
      method: "POST",
      headers: await getHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      showMsg("✅ Bytteforslag sendt!");
      setShowNewSwap(false);
      loadAll();
    } else {
      showMsg(`❌ ${data.error}`, "error");
    }
  }

  async function handleLoanAction(loanId, action) {
    const res = await fetch(`${API}/api/loans/${loanId}`, {
      method: "PATCH",
      headers: await getHeaders(),
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (res.ok) {
      if (action === "buyout") {
        setCelebration({ title: "Rytter købt! 🎉", subtitle: "Købsoptionen er udnyttet", amount: data.price || 0, icon: "📋" });
      } else {
        const msgs = { accept: "✅ Lejeaftale aktiveret", reject: "Lejeforslag afvist", cancel: "Lejeaftale annulleret" };
        showMsg(msgs[action] || "✅ Opdateret");
      }
      loadAll();
    } else {
      showMsg(`❌ ${data.error}`, "error");
    }
  }

  async function handleNewLoan(payload) {
    const res = await fetch(`${API}/api/loans`, {
      method: "POST",
      headers: await getHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) { showMsg("✅ Lejeforslag sendt!"); setShowNewLoan(false); loadAll(); }
    else showMsg(`❌ ${data.error}`, "error");
  }

  const pendingReceived = receivedOffers.filter(o =>
    o.status === "pending" || (o.status === "awaiting_confirmation" && !o.seller_confirmed)
  ).length;
  const pendingSent = sentOffers.filter(o =>
    o.status === "countered" || (o.status === "awaiting_confirmation" && !o.buyer_confirmed)
  ).length;
  const pendingSwaps = [
    ...receivedSwaps.filter(s => s.status === "pending" || (s.status === "awaiting_confirmation" && !s.receiving_confirmed)),
    ...sentSwaps.filter(s => s.status === "countered" || (s.status === "awaiting_confirmation" && !s.proposing_confirmed)),
  ].length;
  const pendingLoans = lendingLoans.filter(l => l.status === "pending").length;

  const riderFilters = useClientRiderFilters(listings.map(l => l.rider).filter(Boolean));
  const filteredIds = new Set(riderFilters.filtered.map(r => r.id));
  const filteredListings = listings.filter(l => !l.rider || filteredIds.has(l.rider.id));

  return (
    <div className="max-w-4xl mx-auto">
      <ConfettiModal
        show={!!celebration}
        onClose={() => setCelebration(null)}
        title={celebration?.title || ""}
        subtitle={celebration?.subtitle}
        amount={celebration?.amount}
        icon={celebration?.icon || "🎉"}
      />

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Transfers</h1>
          <p className="text-white/30 text-sm">Forhandle direkte med andre managers</p>
        </div>
        <div className="bg-[#0f0f18] border border-white/5 rounded-lg px-4 py-2">
          <p className="text-white/25 text-[10px] uppercase tracking-wider">Balance</p>
          <p className="text-[#e8c547] font-mono font-bold text-sm">{myBalance?.toLocaleString("da-DK")} CZ$</p>
        </div>
      </div>

      <div className={`mb-4 px-4 py-3 rounded-xl text-sm border flex items-center gap-2
        ${transferWindow.open
          ? "bg-green-500/8 text-green-400 border-green-500/20"
          : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${transferWindow.open ? "bg-green-400" : "bg-red-400"}`} />
        {transferWindow.open
          ? "Transfervinduet er åbent — du kan sende og acceptere tilbud"
          : "Transfervinduet er lukket — du kan ikke oprette eller acceptere handler. Forhandlinger kan fortsat afvises eller trækkes tilbage."}
      </div>

      {msg.text && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm border
          ${msg.type === "error"
            ? "bg-red-500/10 text-red-400 border-red-500/20"
            : "bg-green-500/10 text-green-400 border-green-500/20"}`}>
          {msg.text}
        </div>
      )}

      <div className="flex gap-2 mb-5 flex-wrap">
        {[
          { key: "received", label: "Modtagne tilbud", badge: pendingReceived },
          { key: "sent",     label: "Sendte tilbud",   badge: pendingSent },
          { key: "swaps",    label: "Byttehandler",  badge: pendingSwaps },
          { key: "loans",    label: "Lejeaftaler",   badge: pendingLoans },
          { key: "market",   label: `Marked (${listings.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-all border
              ${tab === t.key
                ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20"
                : "text-white/40 hover:text-white bg-[#0f0f18] border-white/5"}`}>
            {t.label}
            {t.badge > 0 && (
              <span className="ml-2 bg-[#e8c547] text-[#0a0a0f] text-[9px] font-black px-1.5 py-0.5 rounded-full">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div>
          {tab === "received" && (
            <div className="flex flex-col gap-3">
              {receivedOffers.length === 0 ? (
                <div className="text-center py-16 text-white/20">
                  <p className="text-4xl mb-3">↔</p>
                  <p>Ingen modtagne tilbud</p>
                  <p className="text-xs mt-2">Andre managers kan sende tilbud på dine ryttere fra rytterens side</p>
                </div>
              ) : (
                receivedOffers.map(o => (
                  <ReceivedOfferCard key={o.id} offer={o} onAction={handleOfferAction} />
                ))
              )}
            </div>
          )}

          {tab === "sent" && (
            <div className="flex flex-col gap-3">
              {sentOffers.length === 0 ? (
                <div className="text-center py-16 text-white/20">
                  <p className="text-4xl mb-3">↔</p>
                  <p>Du har ikke sendt nogen tilbud endnu</p>
                  <p className="text-xs mt-2">Find en rytter og klik "Send transfertilbud" på deres side</p>
                </div>
              ) : (
                sentOffers.map(o => (
                  <SentOfferCard key={o.id} offer={o} onAction={handleOfferAction} />
                ))
              )}
            </div>
          )}

          {tab === "swaps" && (
            <div className="flex flex-col gap-4">
              {showNewSwap ? (
                <NewSwapForm
                  myRiders={myRiders}
                  onSubmit={handleNewSwap}
                  onCancel={() => setShowNewSwap(false)}
                />
              ) : (
                <button onClick={() => setShowNewSwap(true)} disabled={!transferWindow.open}
                  className="w-full py-2.5 bg-[#e8c547]/8 text-[#e8c547]/80 border border-[#e8c547]/15 rounded-xl text-sm font-medium
                    hover:bg-[#e8c547]/15 hover:text-[#e8c547] transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                  {transferWindow.open ? "+ Foreslå ny byttehandel" : "Transfervindue lukket"}
                </button>
              )}

              {receivedSwaps.length > 0 && (
                <div>
                  <p className="text-white/30 text-xs uppercase tracking-wider mb-2">Modtagne forslag</p>
                  <div className="flex flex-col gap-3">
                    {receivedSwaps.map(s => (
                      <SwapCard key={s.id} swap={s} myTeamId={myTeamId} onAction={handleSwapAction} />
                    ))}
                  </div>
                </div>
              )}

              {sentSwaps.length > 0 && (
                <div>
                  <p className="text-white/30 text-xs uppercase tracking-wider mb-2">Sendte forslag</p>
                  <div className="flex flex-col gap-3">
                    {sentSwaps.map(s => (
                      <SwapCard key={s.id} swap={s} myTeamId={myTeamId} onAction={handleSwapAction} />
                    ))}
                  </div>
                </div>
              )}

              {receivedSwaps.length === 0 && sentSwaps.length === 0 && !showNewSwap && (
                <div className="text-center py-16 text-white/20">
                  <p className="text-4xl mb-3">↔</p>
                  <p>Ingen aktive byttehandler</p>
                  <p className="text-xs mt-2">Foreslå en byttehandel ved at klikke knappen ovenfor</p>
                </div>
              )}
            </div>
          )}

          {tab === "loans" && (
            <div className="flex flex-col gap-4">
              {showNewLoan ? (
                <NewLoanForm
                  myTeamId={myTeamId}
                  onSubmit={handleNewLoan}
                  onCancel={() => setShowNewLoan(false)}
                />
              ) : (
                <button onClick={() => setShowNewLoan(true)} disabled={!transferWindow.open}
                  className="w-full py-2.5 bg-purple-500/8 text-purple-400/80 border border-purple-500/15 rounded-xl text-sm font-medium
                    hover:bg-purple-500/15 hover:text-purple-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                  {transferWindow.open ? "+ Foreslå ny lejeaftale" : "Transfervindue lukket"}
                </button>
              )}

              {lendingLoans.length > 0 && (
                <div>
                  <p className="text-white/30 text-xs uppercase tracking-wider mb-2">Dine udlejninger</p>
                  <div className="flex flex-col gap-3">
                    {lendingLoans.map(l => (
                      <LoanCard key={l.id} loan={l} myTeamId={myTeamId} onAction={handleLoanAction} />
                    ))}
                  </div>
                </div>
              )}

              {borrowingLoans.length > 0 && (
                <div>
                  <p className="text-white/30 text-xs uppercase tracking-wider mb-2">Dine lejeaftaler</p>
                  <div className="flex flex-col gap-3">
                    {borrowingLoans.map(l => (
                      <LoanCard key={l.id} loan={l} myTeamId={myTeamId} onAction={handleLoanAction} />
                    ))}
                  </div>
                </div>
              )}

              {lendingLoans.length === 0 && borrowingLoans.length === 0 && !showNewLoan && (
                <div className="text-center py-16 text-white/20">
                  <p className="text-4xl mb-3">📋</p>
                  <p>Ingen aktive lejeaftaler</p>
                  <p className="text-xs mt-2">Foreslå en lejeaftale ved at klikke knappen ovenfor</p>
                </div>
              )}
            </div>
          )}

          {tab === "market" && (
            <div>
              <RiderFilters
                filters={riderFilters.filters}
                onChange={riderFilters.onChange}
                onReset={riderFilters.onReset}
                showTeamFilter={false}
              />
              {filteredListings.length === 0 ? (
                <div className="text-center py-16 text-white/20">
                  <p className="text-4xl mb-3">↔</p>
                  <p>{listings.length === 0 ? "Ingen ryttere til salg" : "Ingen ryttere matcher filteret"}</p>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {filteredListings.map(l => (
                    <TransferCard
                      key={l.id}
                      listing={l}
                      myTeamId={myTeamId}
                      onOffer={(riderId, amt, msg) => handleOffer(riderId, amt, msg)}
                      windowOpen={transferWindow.open}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
