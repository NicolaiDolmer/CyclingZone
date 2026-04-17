import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import RiderFilters from "../components/RiderFilters";
import { useClientRiderFilters } from "../lib/useRiderFilters";

const API = import.meta.env.VITE_API_URL;

function timeAgo(d) {
  if (!d) return "—";
  const diff = new Date() - new Date(d);
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), day = Math.floor(diff / 86400000);
  if (m < 1) return "Lige nu";
  if (m < 60) return `${m}m siden`;
  if (h < 24) return `${h}t siden`;
  return `${day}d siden`;
}

const STATUS_CONFIG = {
  pending:   { label: "Afventer svar",    color: "text-[#e8c547]",  bg: "bg-[#e8c547]/10  border-[#e8c547]/20" },
  countered: { label: "Modbud sendt",     color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" },
  accepted:  { label: "Accepteret",       color: "text-green-400",  bg: "bg-green-500/10  border-green-500/20" },
  rejected:  { label: "Afvist",           color: "text-red-400",    bg: "bg-red-500/10    border-red-500/20" },
  withdrawn: { label: "Trukket tilbage",  color: "text-white/30",   bg: "bg-white/5       border-white/10" },
};

// ── Offer card shown in "Modtagne tilbud" ────────────────────────────────────
function ReceivedOfferCard({ offer, onAction, myBalance }) {
  const [counterAmt, setCounterAmt] = useState(offer.offer_amount || 0);
  const [msg, setMsg] = useState("");
  const [mode, setMode] = useState(null); // null | counter | message
  const [loading, setLoading] = useState(false);

  const isActive = offer.status === "pending";
  const cfg = STATUS_CONFIG[offer.status] || STATUS_CONFIG.pending;
  const currentOffer = offer.offer_amount;

  async function doAction(action, extra = {}) {
    setLoading(true);
    await onAction(offer.id, action, extra);
    setMode(null);
    setLoading(false);
  }

  return (
    <div className={`bg-[#0f0f18] border rounded-xl p-5 transition-all ${isActive ? "border-[#e8c547]/20" : "border-white/5 opacity-70"}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-white font-semibold">{offer.rider?.firstname} {offer.rider?.lastname}</p>
          <p className="text-white/30 text-xs">Fra: {offer.buyer?.name} · Runde {offer.round || 1} · {timeAgo(offer.created_at)}</p>
        </div>
        <span className={`text-[10px] uppercase px-2 py-1 rounded-full border font-medium ${cfg.bg} ${cfg.color}`}>
          {cfg.label}
        </span>
      </div>

      {/* Offer amount */}
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

      {/* Actions */}
      {isActive && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button onClick={() => doAction("accept")} disabled={loading}
              className="flex-1 py-2 bg-green-500/15 text-green-400 border border-green-500/25 rounded-lg text-sm font-medium hover:bg-green-500/25 transition-all disabled:opacity-50">
              ✓ Accepter
            </button>
            <button onClick={() => setMode(mode === "counter" ? null : "counter")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all
                ${mode === "counter" ? "bg-orange-500/20 text-orange-400 border-orange-500/30" : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10"}`}>
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
    </div>
  );
}

// ── Offer card shown in "Sendte tilbud" ──────────────────────────────────────
function SentOfferCard({ offer, onAction }) {
  const [newAmt, setNewAmt] = useState(offer.counter_amount || offer.offer_amount || 0);
  const [msg, setMsg] = useState("");
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);

  const isCountered = offer.status === "countered";
  const isPending = offer.status === "pending";
  const isActive = isCountered || isPending;
  const cfg = STATUS_CONFIG[offer.status] || STATUS_CONFIG.pending;

  async function doAction(action, extra = {}) {
    setLoading(true);
    await onAction(offer.id, action, extra);
    setMode(null);
    setLoading(false);
  }

  return (
    <div className={`bg-[#0f0f18] border rounded-xl p-5 transition-all ${isCountered ? "border-orange-500/20" : isActive ? "border-white/10" : "border-white/5 opacity-60"}`}>
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

      {/* Actions for buyer */}
      {isCountered && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button onClick={() => doAction("accept_counter")} disabled={loading}
              className="flex-1 py-2 bg-green-500/15 text-green-400 border border-green-500/25 rounded-lg text-sm font-medium hover:bg-green-500/25 disabled:opacity-50">
              ✓ Accepter modbud ({offer.counter_amount?.toLocaleString("da-DK")} CZ$)
            </button>
            <button onClick={() => setMode(mode === "new_offer" ? null : "new_offer")}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all
                ${mode === "new_offer" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10"}`}>
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
          className="w-full py-2 bg-white/5 text-white/30 border border-white/8 rounded-lg text-sm hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all disabled:opacity-50">
          Træk tilbud tilbage
        </button>
      )}
    </div>
  );
}

// ── Transfer market listing card ─────────────────────────────────────────────
function TransferCard({ listing, myTeamId, onOffer }) {
  const [offerAmt, setOfferAmt] = useState(listing.asking_price || 0);
  const [msg, setMsg] = useState("");
  const [showOffer, setShowOffer] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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

      {/* Quick stats */}
      <div className="flex gap-3 mb-3">
        {[["BJ", "stat_bj"], ["SP", "stat_sp"], ["TT", "stat_tt"], ["FL", "stat_fl"]].map(([label, key]) => (
          <div key={key} className="text-center">
            <p className="text-white/25 text-[9px] uppercase">{label}</p>
            <p className={`font-mono text-xs font-bold ${listing.rider?.[key] >= 80 ? "text-[#e8c547]" : "text-white/50"}`}>
              {listing.rider?.[key] || "—"}
            </p>
          </div>
        ))}
      </div>

      {!isOwn && (
        <div>
          <button onClick={() => setShowOffer(!showOffer)}
            className={`w-full py-2 rounded-lg text-sm font-medium transition-all border
              ${showOffer ? "bg-[#e8c547]/15 text-[#e8c547] border-[#e8c547]/25" : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white"}`}>
            {showOffer ? "Skjul" : "Send tilbud"}
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
                    await onOffer(listing.rider?.id, listing.seller?.id, offerAmt, msg);
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
  const navigate = useNavigate();
  const [tab, setTab] = useState("received");
  const [listings, setListings] = useState([]);
  const [sentOffers, setSentOffers] = useState([]);
  const [receivedOffers, setReceivedOffers] = useState([]);
  const [myTeamId, setMyTeamId] = useState(null);
  const [myBalance, setMyBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ text: "", type: "success" });

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

    const [listingsRes, offersRes] = await Promise.all([
      fetch(`${API}/api/transfers`, { headers }).then(r => r.json()),
      fetch(`${API}/api/transfers/my-offers`, { headers }).then(r => r.json()),
    ]);

    setListings(Array.isArray(listingsRes) ? listingsRes : []);
    setSentOffers(offersRes.sent || []);
    setReceivedOffers(offersRes.received || []);
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

  async function handleOffer(riderId, sellerTeamId, amount, message) {
    const res = await fetch(`${API}/api/transfers/offer`, {
      method: "POST", headers: await getHeaders(),
      body: JSON.stringify({ rider_id: riderId, offer_amount: amount, message }),
    });
    const data = await res.json();
    if (res.ok) { showMsg("✅ Tilbud sendt!"); loadAll(); setTab("sent"); }
    else showMsg(`❌ ${data.error}`, "error");
  }

  async function handleOfferAction(offerId, action, extra = {}) {
    const res = await fetch(`${API}/api/transfers/offers/${offerId}`, {
      method: "PATCH", headers: await getHeaders(),
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json();
    if (res.ok) {
      const msgs = {
        accept: "✅ Transfer accepteret!", reject: "Transfer afvist",
        counter: "↔ Modbud sendt", accept_counter: "✅ Transfer gennemført!",
        new_offer: "↔ Nyt bud sendt", withdraw: "Tilbud trukket tilbage",
      };
      showMsg(msgs[action] || "✅ Opdateret");
      loadAll();
    } else showMsg(`❌ ${data.error}`, "error");
  }

  const pendingReceived = receivedOffers.filter(o => o.status === "pending").length;
  const pendingSent = sentOffers.filter(o => o.status === "countered").length;

  const riderFilters = useClientRiderFilters(listings.map(l => l.rider).filter(Boolean));
  const filteredIds = new Set(riderFilters.filtered.map(r => r.id));
  const filteredListings = listings.filter(l => !l.rider || filteredIds.has(l.rider.id));

  return (
    <div className="max-w-4xl mx-auto">
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

      {msg.text && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm border
          ${msg.type === "error" ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-green-500/10 text-green-400 border-green-500/20"}`}>
          {msg.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {[
          { key: "received", label: "Modtagne tilbud", badge: pendingReceived },
          { key: "sent",     label: "Sendte tilbud",   badge: pendingSent },
          { key: "market",   label: `Marked (${listings.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-all border
              ${tab === t.key ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20" : "text-white/40 hover:text-white bg-[#0f0f18] border-white/5"}`}>
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
        <>
          {/* Received offers */}
          {tab === "received" && (
            <div className="flex flex-col gap-3">
              {receivedOffers.length === 0 ? (
                <div className="text-center py-16 text-white/20">
                  <p className="text-4xl mb-3">↔</p>
                  <p>Ingen modtagne tilbud</p>
                  <p className="text-xs mt-2">Andre managers kan sende tilbud på dine ryttere fra rytternes side</p>
                </div>
              ) : receivedOffers.map(o => (
                <ReceivedOfferCard key={o.id} offer={o} onAction={handleOfferAction} myBalance={myBalance} />
              ))}
            </div>
          )}

          {/* Sent offers */}
          {tab === "sent" && (
            <div className="flex flex-col gap-3">
              {sentOffers.length === 0 ? (
                <div className="text-center py-16 text-white/20">
                  <p className="text-4xl mb-3">↔</p>
                  <p>Du har ikke sendt nogen tilbud endnu</p>
                  <p className="text-xs mt-2">Find en rytter og klik "Send tilbud" på deres side</p>
                </div>
              ) : sentOffers.map(o => (
                <SentOfferCard key={o.id} offer={o} onAction={handleOfferAction} />
              ))}
            </div>
          )}

          {/* Market */}
          {tab === "market" && (
            <div>
              <RiderFilters filters={riderFilters.filters} onChange={riderFilters.onChange}
                onReset={riderFilters.onReset} showTeamFilter={false} />
              {filteredListings.length === 0 ? (
                <div className="text-center py-16 text-white/20">
                  <p className="text-4xl mb-3">↔</p>
                  <p>{listings.length === 0 ? "Ingen ryttere til salg" : "Ingen ryttere matcher filteret"}</p>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {filteredListings.map(l => (
                    <TransferCard key={l.id} listing={l} myTeamId={myTeamId}
                      onOffer={(riderId, sellerId, amt, msg) => handleOffer(riderId, sellerId, amt, msg)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
