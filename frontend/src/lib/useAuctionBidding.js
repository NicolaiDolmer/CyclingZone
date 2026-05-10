import { useState, useEffect } from "react";
import { getMinimumAuctionBid } from "./marketValues";
import { formatBidWarning } from "./auctionLogic";

// Delt bid + autobud-loft state-machine. Bruges af AuctionRow (desktop tabel),
// AuctionCard (mobil card) og RiderStatsPage (rytter-profil) — så vi har ÉN kilde
// til sandhed for: balance-gate, race-confirm-håndtering, success/error-status,
// proxy-loft sæt/gem/fjern, og warning-formatering.
//
// Komponenten der kalder hooket renderer selv JSX (input, knap, badges) men
// bruger handlerne herfra. Tre kalder-sites = tre layouts (compact tabel-celle,
// comfortable card, rytter-profil) men identisk opførsel.

export function useAuctionBidding({
  auction,
  myAvailableBalance,
  onBid,
  onSetProxy,
  onRemoveProxy,
  requestBidConfirm,
  riderName,
}) {
  const minBid = getMinimumAuctionBid(auction.current_price || 0, {
    hasActiveBid: Boolean(auction.current_bidder_id),
  });
  const [bidAmount, setBidAmount] = useState(minBid);
  const [bidStatus, setBidStatus] = useState(null);
  const [errorText, setErrorText] = useState("");
  const [warningText, setWarningText] = useState("");
  const [proxyExpanded, setProxyExpanded] = useState(false);
  const [proxyInput, setProxyInput] = useState(0);
  const [proxyStatus, setProxyStatus] = useState(null);
  const [proxyErrorText, setProxyErrorText] = useState("");

  const myProxy = auction.myProxyMax || null;

  useEffect(() => {
    setBidAmount(minBid);
    setErrorText("");
  }, [minBid]);

  useEffect(() => {
    if (proxyExpanded) setProxyInput(myProxy || bidAmount || minBid);
  }, [proxyExpanded]);

  function handleBid() {
    if (bidAmount > myAvailableBalance) {
      setBidStatus("error");
      setErrorText("Buddet overstiger din tilgængelige balance (efter eksisterende bud)");
      setTimeout(() => setBidStatus(null), 3000);
      return;
    }
    requestBidConfirm({
      mode: "bid",
      riderName,
      amount: bidAmount,
      onConfirm: async () => {
        setBidStatus("loading");
        const result = await onBid(auction.id, bidAmount);
        if (result.race) {
          // #194: top-level RacePriceModal håndterer — ryd loading-state
          setBidStatus(null);
          return;
        }
        setBidStatus(result.ok ? "success" : "error");
        setErrorText(result.error || "");
        if (result.ok) {
          const warningMsg = (result.warnings || []).map(formatBidWarning).filter(Boolean).join(" ");
          if (warningMsg) {
            setWarningText(warningMsg);
            setTimeout(() => setWarningText(""), 10000);
          }
        }
        setTimeout(() => setBidStatus(null), result.ok ? 2500 : 3000);
      },
    });
  }

  function handleSaveProxy() {
    requestBidConfirm({
      mode: "proxy",
      riderName,
      amount: proxyInput,
      onConfirm: async () => {
        setProxyStatus("loading");
        setProxyErrorText("");
        const result = await onSetProxy(auction.id, proxyInput);
        setProxyStatus(result.ok ? "saved" : "error");
        if (result.ok) {
          setProxyExpanded(false);
        } else {
          // #174: vis dansk fejlbesked fra backend (egen rytter, max-loft, balance, ...)
          setProxyErrorText(result.error || "Fejl ved sæt autobud");
        }
        setTimeout(() => setProxyStatus(null), result.ok ? 2000 : 3000);
      },
    });
  }

  async function handleRemoveProxy() {
    await onRemoveProxy(auction.id);
  }

  return {
    minBid,
    myProxy,
    bidAmount, setBidAmount,
    bidStatus, errorText, warningText,
    proxyExpanded, setProxyExpanded,
    proxyInput, setProxyInput,
    proxyStatus, proxyErrorText,
    handleBid, handleSaveProxy, handleRemoveProxy,
  };
}
