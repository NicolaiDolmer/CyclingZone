import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const STATS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];
const STAT_LABELS = ["FL","BJ","KB","BK","TT","PRL","Bro","SP","ACC","NED","UDH","MOD","RES","FTR"];

function TransferCard({ listing, myTeamId, onAction }) {
  const [offerAmount, setOfferAmount] = useState(listing.asking_price);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [expanded, setExpanded] = useState(false);
  const isMine = listing.seller?.id === myTeamId;

  async function makeOffer() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/transfers/${listing.id}/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ offer_amount: offerAmount }),
    });
    const data = await res.json();
    if (res.ok) { setMsg("✅ Tilbud sendt!"); setTimeout(() => { onAction(); }, 1500); }
    else setMsg(`❌ ${data.error}`);
    setLoading(false);
  }

  async function withdrawListing() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(`${import.meta.env.VITE_API_URL}/api/transfers/${listing.id}/withdraw`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    onAction();
    setLoading(false);
  }

  return (
    <div className={`bg-[#0f0f18] border rounded-xl overflow-hidden transition-all
      ${isMine ? "border-blue-500/20" : "border-white/5 hover:border-white/10"}`}>
      <div className="p-4 flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-white font-medium text-sm">{listing.rider?.firstname} {listing.rider?.lastname}</p>
              {listing.rider?.is_u25 && (
                <span className="text-[9px] uppercase bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">U25</span>
              )}
              {isMine && (
                <span className="text-[9px] uppercase bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">Dit udbud</span>
              )}
            </div>
            <p className="text-white/30 text-xs mt-0.5">{listing.seller?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[#e8c547] font-mono font-bold text-sm">
              {listing.asking_price?.toLocaleString("da-DK")} pts
            </p>
            <p className="text-white/20 text-xs">UCI: {listing.rider?.uci_points?.toLocaleString("da-DK")}</p>
          </div>
          <span className="text-white/30 text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-white/5 p-4">
          {/* Stats */}
          <div className="grid grid-cols-7 gap-2 mb-4">
            {STATS.map((key, i) => (
              <div key={key} className="text-center">
                <p className="text-white/20 text-[9px] uppercase">{STAT_LABELS[i]}</p>
                <p className={`font-mono text-xs font-bold mt-0.5
                  ${listing.rider?.[key] >= 80 ? "text-[#e8c547]" : "text-white/50"}`}>
                  {listing.rider?.[key] || "—"}
                </p>
              </div>
            ))}
          </div>

          {/* Actions */}
          {isMine ? (
            <button onClick={withdrawListing} disabled={loading}
              className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20
                rounded-lg text-sm hover:bg-red-500/20 transition-all disabled:opacity-50">
              {loading ? "..." : "Træk fra transferliste"}
            </button>
          ) : (
            <div>
              <p className="text-white/40 text-xs mb-2">Send tilbud (eller byd på udbudspris)</p>
              <div className="flex gap-2">
                <input type="number" value={offerAmount} min={1}
                  onChange={e => setOfferAmount(parseInt(e.target.value))}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2
                    text-white text-sm font-mono focus:outline-none focus:border-[#e8c547]/50" />
                <button onClick={makeOffer} disabled={loading}
                  className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg
                    text-sm hover:bg-[#f0d060] transition-all disabled:opacity-50">
                  {loading ? "..." : "Send tilbud"}
                </button>
              </div>
            </div>
          )}
          {msg && <p className={`text-xs mt-2 ${msg.startsWith("✅") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}
        </div>
      )}
    </div>
  );
}

function OfferCard({ offer, isSeller, onAction }) {
  const [loading, setLoading] = useState(false);
  const [counterAmount, setCounterAmount] = useState(offer.offer_amount);
  const [showCounter, setShowCounter] = useState(false);

  async function respond(action, counter = null) {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(`${import.meta.env.VITE_API_URL}/api/transfers/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action, counter_amount: counter }),
    });
    onAction();
    setLoading(false);
  }

  const statusColor = offer.status === "accepted" ? "text-green-400" :
    offer.status === "rejected" ? "text-red-400" :
    offer.status === "countered" ? "text-[#e8c547]" : "text-white/40";

  return (
    <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-white text-sm font-medium">
            {offer.listing?.rider?.firstname} {offer.listing?.rider?.lastname}
          </p>
          <p className="text-white/30 text-xs">
            {isSeller ? `Fra: ${offer.buyer?.name}` : `Til: ${offer.listing?.seller?.name}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[#e8c547] font-mono font-bold">{offer.offer_amount?.toLocaleString("da-DK")} pts</p>
          <p className={`text-xs capitalize ${statusColor}`}>{
            offer.status === "pending" ? "Afventer" :
            offer.status === "accepted" ? "Accepteret" :
            offer.status === "rejected" ? "Afvist" :
            offer.status === "countered" ? `Modbud: ${offer.counter_amount?.toLocaleString("da-DK")} pts` :
            offer.status
          }</p>
        </div>
      </div>

      {isSeller && offer.status === "pending" && (
        <div className="flex gap-2 mt-3">
          <button onClick={() => respond("accept")} disabled={loading}
            className="flex-1 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20
              rounded-lg text-xs font-medium hover:bg-green-500/20 transition-all">
            Acceptér
          </button>
          <button onClick={() => setShowCounter(!showCounter)} disabled={loading}
            className="flex-1 py-1.5 bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20
              rounded-lg text-xs font-medium hover:bg-[#e8c547]/20 transition-all">
            Modbud
          </button>
          <button onClick={() => respond("reject")} disabled={loading}
            className="flex-1 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20
              rounded-lg text-xs font-medium hover:bg-red-500/20 transition-all">
            Afvis
          </button>
        </div>
      )}

      {showCounter && (
        <div className="flex gap-2 mt-2">
          <input type="number" value={counterAmount}
            onChange={e => setCounterAmount(parseInt(e.target.value))}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5
              text-white text-sm font-mono focus:outline-none focus:border-[#e8c547]/50" />
          <button onClick={() => respond("counter", counterAmount)}
            className="px-3 py-1.5 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-xs">
            Send modbud
          </button>
        </div>
      )}

      {!isSeller && offer.status === "countered" && (
        <div className="mt-3">
          <p className="text-white/40 text-xs mb-2">Sælger sendte modbud på {offer.counter_amount?.toLocaleString("da-DK")} pts</p>
          <div className="flex gap-2">
            <button onClick={() => respond("accept")}
              className="flex-1 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg text-xs font-medium">
              Acceptér modbud
            </button>
            <button onClick={() => respond("reject")}
              className="flex-1 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-xs font-medium">
              Afvis
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TransfersPage() {
  const [listings, setListings] = useState([]);
  const [offers, setOffers] = useState([]);
  const [myTeamId, setMyTeamId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("market");

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: team } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (team) setMyTeamId(team.id);

    const [listingsRes, offersRes] = await Promise.all([
      supabase.from("transfer_listings")
        .select(`id, asking_price, status, created_at,
          rider:rider_id(id, firstname, lastname, uci_points, is_u25,
            stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl,
            stat_bro, stat_sp, stat_acc, stat_ned, stat_udh, stat_mod, stat_res, stat_ftr),
          seller:seller_team_id(id, name)`)
        .eq("status", "open")
        .order("created_at", { ascending: false }),
      supabase.from("transfer_offers")
        .select(`id, offer_amount, status, counter_amount, created_at,
          listing:listing_id(id, asking_price, seller_team_id,
            rider:rider_id(firstname, lastname),
            seller:seller_team_id(name)),
          buyer:buyer_team_id(id, name)`)
        .or(`buyer_team_id.eq.${team?.id},listing_id.in.(select id from transfer_listings where seller_team_id = '${team?.id}')`)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    setListings(listingsRes.data || []);
    setOffers(offersRes.data || []);
    setLoading(false);
  }

  const myOffers = offers.filter(o => o.buyer?.id === myTeamId);
  const receivedOffers = offers.filter(o => o.listing?.seller_team_id === myTeamId);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Transfermarked</h1>
          <p className="text-white/30 text-sm">{listings.length} ryttere til salg</p>
        </div>
      </div>

      <div className="flex gap-2 mb-5">
        {[
          { key: "market", label: `Marked (${listings.length})` },
          { key: "received", label: `Modtagne bud (${receivedOffers.filter(o => o.status === "pending").length})` },
          { key: "sent", label: `Mine bud (${myOffers.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${tab === t.key ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20" : "text-white/40 hover:text-white bg-[#0f0f18] border-white/5"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tab === "market" ? (
        listings.length === 0 ? (
          <div className="text-center py-16 text-white/20">
            <p className="text-4xl mb-3">↔</p>
            <p>Ingen ryttere på transferlisten</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {listings.map(l => (
              <TransferCard key={l.id} listing={l} myTeamId={myTeamId} onAction={loadAll} />
            ))}
          </div>
        )
      ) : tab === "received" ? (
        receivedOffers.length === 0 ? (
          <div className="text-center py-16 text-white/20"><p>Ingen modtagne tilbud</p></div>
        ) : (
          <div className="flex flex-col gap-3">
            {receivedOffers.map(o => <OfferCard key={o.id} offer={o} isSeller={true} onAction={loadAll} />)}
          </div>
        )
      ) : (
        myOffers.length === 0 ? (
          <div className="text-center py-16 text-white/20"><p>Du har ikke sendt nogen tilbud</p></div>
        ) : (
          <div className="flex flex-col gap-3">
            {myOffers.map(o => <OfferCard key={o.id} offer={o} isSeller={false} onAction={loadAll} />)}
          </div>
        )
      )}
    </div>
  );
}
