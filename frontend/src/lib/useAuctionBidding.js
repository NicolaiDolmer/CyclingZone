import { useState, useEffect } from "react";
import { getMinimumAuctionBid } from "./marketValues";
import { formatBidWarning, computeAvailableForBid, isAuctionTimeExpired } from "./auctionLogic";
import { logEvent, logFirstEvent } from "./logEvent";
import { formatNumber } from "./intl";
import { useBlockedAction } from "./useBlockedAction.js";
import { reportActionFailure } from "./actionTelemetry.js";
import { retirementBidWarningTier } from "./riderAge";
import { auctionSettlesAfterValueUpdate } from "./auctionValueUpdateWindow.js";

// Delt bid + autobud-loft state-machine. Bruges af AuctionRow (desktop tabel),
// AuctionCard (mobil card) og RiderStatsPage (rytter-profil) — så vi har ÉN kilde
// til sandhed for: balance-gate, race-confirm-håndtering, success/error-status,
// proxy-loft sæt/gem/fjern, og warning-formatering.
//
// Komponenten der kalder hooket renderer selv JSX (input, knap, badges) men
// bruger handlerne herfra. Tre kalder-sites = tre layouts (compact tabel-celle,
// comfortable card, rytter-profil) men identisk opførsel.
//
// #1184: balance-gaten beregnes HER (ikke hos kalderne) ud fra rå saldo +
// samlet worst-case-reservation, så ekskluder-denne-auktion-semantikken matcher
// backend-gaten (auctionRules.js) ens på alle tre flader.
//
// #2719: begge knapper (Byd + autobud-Gem) var tidligere `disabled` når beløbet
// lå under min-buddet — uden ét ord om hvorfor. Autobud-panelet forudfylder med
// dit GEMTE loft, og prisen stiger under auktionen, så loftet er ofte allerede
// under min-buddet i det sekund panelet åbner: Gem-knappen fødes død. (Målt i
// prod: 101 af 354 gemte lofter lå på eller under auktionens aktuelle pris.)
// Blokade-begrundelserne beregnes derfor HER, ét sted, og alle tre flader viser
// dem — se useBlockedAction.js for hvorfor det er aria-disabled og ikke disabled.

export function useAuctionBidding({
  auction,
  myBalance,
  reservedBalance,
  myTeamId,
  onBid,
  onSetProxy,
  onRemoveProxy,
  requestBidConfirm,
  riderName,
  // #2700: rytterens fødselsdato + aktive sæson-referenceår — kun brugt til at
  // afgøre retirementTier for bud-bekræftelses-advarslen. Begge er valgfrie
  // (kaldere uden dem får blot ingen advarsel, samme null-over-gæt-kontrakt
  // som resten af riderAge.js).
  birthdate,
  seasonYear,
  t,
}) {
  const minBid = getMinimumAuctionBid(auction.current_price || 0, {
    hasActiveBid: Boolean(auction.current_bidder_id),
  });
  const retirementTier = retirementBidWarningTier(birthdate, seasonYear);
  // #4004: kort note i bud-bekræftelsen når auktionen slutter EFTER søndagens
  // værdi-refresh — ren visning, blokerer intet (bud er bindende uanset).
  const settlesAfterValueUpdate = auctionSettlesAfterValueUpdate(auction.calculated_end);
  const [bidAmount, setBidAmount] = useState(minBid);
  const [bidStatus, setBidStatus] = useState(null);
  const [errorText, setErrorText] = useState("");
  const [warningText, setWarningText] = useState("");
  const [proxyExpanded, setProxyExpanded] = useState(false);
  const [proxyInput, setProxyInput] = useState(0);
  const [proxyStatus, setProxyStatus] = useState(null);
  const [proxyErrorText, setProxyErrorText] = useState("");

  const myProxy = auction.myProxyMax || null;

  // #3110: byd-/autobud-knappen forblev aktiv efter nedtællingen ramte 0 —
  // status-cronen der sætter auction.status="completed" kan tage et stykke
  // tid, og indtil da var canBid (AuctionsPage.jsx) stadig sand, så knappen
  // sad klikbar hele vinduet (Sentry CYCLINGZONE-3Y, 4 hold på 19 timer).
  // Client-side ur, ikke auction.status — deadline flyttes ved forlængelse
  // (status "extended"), og calculated_end fanger det uden ekstra prop.
  const [timeExpired, setTimeExpired] = useState(() => isAuctionTimeExpired(auction.calculated_end));
  useEffect(() => {
    setTimeExpired(isAuctionTimeExpired(auction.calculated_end));
    const tick = setInterval(() => {
      setTimeExpired(isAuctionTimeExpired(auction.calculated_end));
    }, 1000);
    return () => clearInterval(tick);
  }, [auction.calculated_end]);

  // #2719: hvorfor kan knappen ikke køre? Færdige, lokaliserede sætninger — null
  // = ikke blokeret. Bemærk at proxyInput bevidst IKKE nulstilles når minBid
  // stiger (det ville overskrive det spilleren selv har tastet); i stedet siger
  // vi det højt, så et forældet loft aldrig bliver et dødt klik.
  const minBidText = formatNumber(minBid);
  const bidBlockedReason = timeExpired
    ? t("auctions:bid.blockedExpired")
    : bidAmount < minBid
      ? t("auctions:bid.blockedBelowMin", { amount: minBidText })
      : null;
  const proxyBlockedReason = timeExpired
    ? t("auctions:bid.proxy.blockedExpired")
    : proxyInput < minBid
      ? t("auctions:bid.proxy.blockedBelowMin", { amount: minBidText })
      : null;

  const bidBlock = useBlockedAction(bidBlockedReason);
  const proxyBlock = useBlockedAction(proxyBlockedReason);

  useEffect(() => {
    setBidAmount(minBid);
    setErrorText("");
  }, [minBid]);

  useEffect(() => {
    if (proxyExpanded) setProxyInput(myProxy || bidAmount || minBid);
  }, [proxyExpanded]); // eslint-disable-line react-hooks/exhaustive-deps -- myProxy/bidAmount/minBid læses bevidst på åbnings-tidspunktet; som dependencies ville de nulstille brugerens indtastning undervejs

  function handleBid() {
    const availableForBid = computeAvailableForBid({
      balance: myBalance,
      reservedBalance,
      auction,
      myTeamId,
    });
    if (bidAmount > availableForBid) {
      setBidStatus("error");
      setErrorText(t("auctions:error.insufficientBalance"));
      setTimeout(() => setBidStatus(null), 3000);
      return;
    }
    requestBidConfirm({
      mode: "bid",
      riderName,
      amount: bidAmount,
      retirementTier,
      settlesAfterValueUpdate,
      onConfirm: async () => {
        setBidStatus("loading");
        let result;
        try {
          result = await onBid(auction.id, bidAmount);
        } catch (cause) {
          // #3619: kalder-siden (AuctionsPage.handleBid) har ingen try/catch om
          // sin fetch. Falder nettet væk midt i kaldet — mobil-WebKit kaster
          // "TypeError: Load failed" — afviste denne promise unhandled: knappen
          // sad fast i "loading" for evigt, og spilleren fik intet at vide.
          // Samme kur som handleRemoveProxy fik i #2719.
          setBidStatus("error");
          setErrorText(t("errors:generic.networkError"));
          reportActionFailure("auction_bid", {
            reason: "network",
            cause,
            context: { auctionId: auction.id, amount: bidAmount },
          });
          setTimeout(() => setBidStatus(null), 4000);
          return;
        }
        if (result.race) {
          // #194: top-level RacePriceModal håndterer — ryd loading-state
          setBidStatus(null);
          return;
        }
        setBidStatus(result.ok ? "success" : "error");
        setErrorText(result.error || "");
        if (!result.ok) {
          reportActionFailure("auction_bid", {
            reason: result.error,
            context: { auctionId: auction.id, amount: bidAmount },
          });
        }
        if (result.ok) {
          logEvent("auction_bid_placed", { auction_id: auction.id, amount: bidAmount });
          // #1583: aktiverings-funnel — kun brugerens FØRSTE bud (de-dup pr. bruger).
          logFirstEvent("first_bid", { auction_id: auction.id, amount: bidAmount });
          const warningMsg = (result.warnings || []).map(w => formatBidWarning(w, t)).filter(Boolean).join(" ");
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
      retirementTier,
      settlesAfterValueUpdate,
      onConfirm: async () => {
        setProxyStatus("loading");
        setProxyErrorText("");
        let result;
        try {
          result = await onSetProxy(auction.id, proxyInput);
        } catch (cause) {
          // #3619: se handleBid ovenfor — dette var kilden til CYCLINGZONE-4E
          // (Firefox iOS, autobud-loft gemt på en tabt forbindelse).
          setProxyStatus("error");
          setProxyErrorText(t("errors:generic.networkError"));
          reportActionFailure("auction_proxy_save", {
            reason: "network",
            cause,
            context: { auctionId: auction.id, maxAmount: proxyInput },
          });
          setTimeout(() => setProxyStatus(null), 4000);
          return;
        }
        setProxyStatus(result.ok ? "saved" : "error");
        if (result.ok) {
          setProxyExpanded(false);
        } else {
          // #174: vis fejlbesked fra backend (egen rytter, max-loft, balance, ...)
          setProxyErrorText(result.error || t("auctions:error.proxyFailed"));
          reportActionFailure("auction_proxy_save", {
            reason: result.error,
            context: { auctionId: auction.id, maxAmount: proxyInput },
          });
        }
        setTimeout(() => setProxyStatus(null), result.ok ? 2000 : 3000);
      },
    });
  }

  // #2719: kastede tidligere resultatet væk (`await onRemoveProxy(...)` og intet
  // andet). Fejlede kaldet, blev autobud-badget stående, spilleren trykkede
  // "Fjern" igen — og igen. Nu: loading-state, fejlbesked på spillerens sprog,
  // og en Sentry-event så et fejlende fjern-kald ikke længere er usynligt.
  async function handleRemoveProxy() {
    setProxyStatus("loading");
    setProxyErrorText("");
    function fail(detail) {
      setProxyStatus("error");
      setProxyErrorText(detail.text);
      reportActionFailure("auction_proxy_remove", {
        reason: detail.reason,
        cause: detail.cause,
        context: { auctionId: auction.id },
      });
      setTimeout(() => setProxyStatus(null), 4000);
    }
    let result;
    try {
      result = await onRemoveProxy(auction.id);
    } catch (cause) {
      fail({ text: t("auctions:error.proxyRemoveFailed"), cause });
      return;
    }
    // Bagudkompatibelt: en kalder må returnere undefined ved succes.
    if (result && result.ok === false) {
      const text = result.error || t("auctions:error.proxyRemoveFailed");
      fail({ text, reason: result.error });
      return;
    }
    setProxyStatus("removed");
    setTimeout(() => setProxyStatus(null), 2000);
  }

  return {
    minBid,
    myProxy,
    bidAmount, setBidAmount,
    bidStatus, errorText, warningText,
    proxyExpanded, setProxyExpanded,
    proxyInput, setProxyInput,
    proxyStatus, proxyErrorText,
    // #2719: blokade-kontrakten. Kalderen spreder `*BlockedProps` på knappen,
    // pakker sin onClick i `*Guard(...)` og rendrer <BlockedNote> med reason.
    bidBlock, proxyBlock,
    // Klik-handlere er allerede pakket ind, så en blokeret knap aldrig kan
    // "gøre ingenting" — den viser begrundelsen i stedet.
    handleBid: bidBlock.guard(handleBid),
    handleSaveProxy: proxyBlock.guard(handleSaveProxy),
    handleRemoveProxy,
  };
}
