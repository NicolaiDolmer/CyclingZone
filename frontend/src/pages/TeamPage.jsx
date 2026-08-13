import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import RiderLink from "../components/RiderLink";
import TeamLink from "../components/TeamLink";
import { useClientRiderFilters } from "../lib/useRiderFilters";
import { ABILITY_STATS as STATS, ABILITY_SELECT, flattenAbilities } from "../lib/abilities";
import { CONDITION_SELECT, flattenCondition, isRiderInjured } from "../lib/training.js";
import { supabase } from "../lib/supabase";
import { statStyle, statPlateStyle } from "../lib/statColor";
import NationCell from "../components/rider/NationCell";
import RiderBadges from "../components/rider/RiderBadges";
import RiderTypeBadge from "../components/rider/RiderTypeBadge";
import { ageBadgeKey, getRiderAge, isU23, retirementRiskBadgeKey, contractExpiringBadgeKey, seasonNumberFromReferenceYear } from "../lib/riderAge";
import { useActiveSeasonYear } from "../hooks/useActiveSeasonYear.js";
import { getRiderMarketValue, projectYouthSalary, detectStartPriceTypo } from "../lib/marketValues";
import { StartPriceTypoGuardModal } from "../components/StartPriceTypoGuardModal";
import { getCountryCode3 } from "../lib/countryUtils";
import { riderOverallRating } from "../lib/riderRating";
import { getSquadLimits } from "../lib/dashboardSquadStats.js";
import { formatNumber } from "../lib/intl";
import { AcademyTransferConfirmModal } from "../components/AcademyTransferConfirmModal";
import ScoutablePotentiale from "../components/rider/ScoutablePotentiale";
import { useScouting } from "../lib/useScouting";
import { scoutSortValue } from "../lib/scouting";
import TeamTransferHistoryTab from "../components/TeamTransferHistoryTab";
import TeamStatsTab from "../components/TeamStatsTab";
import { resolveApiError } from "../lib/apiError";
import { reportActionFailure } from "../lib/actionTelemetry.js";
import { fetchRiderQuote, postRiderContractAction } from "../lib/riderContractActions.js";
import { extendCapGate } from "../lib/extendCapGate.js";
import { cycleSortState } from "../lib/riderSort";
import { AmountInput, PageHeader, Button, BikeIcon, PageLoader, EmptyState, DataTable } from "../components/ui";
import { controlClass } from "../components/ui/fieldStyles.js";
import { buttonClass } from "../components/ui/buttonStyles.js";

// Stat-kolonner = de 15 CZ-evner (delt config lib/abilities.js, importeret som STATS).
// #1529: erstattede de 14 PCM stat_*-kolonner — visningen viser nu evner.

function RiderActionModal({ rider, team, scouting, onClose, onAction, onDemote, ddActive, seasonYear }) {
  const { t } = useTranslation("team");
  // #932 S7: demote (senior → akademi) er kun muligt for U23-seniorer (alder ≤ 22,
  // ikke allerede akademi). Samme grænse som backend D5-gaten. #3071: sæson-alder.
  const canDemote = !rider.is_academy && isU23(rider.birthdate, seasonYear);
  const riderValue = getRiderMarketValue(rider);
  const [auctionPrice, setAuctionPrice] = useState(riderValue);
  const [transferPrice, setTransferPrice] = useState(riderValue);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  // #671: success/fejl-farven blev tidligere udledt af om msg startede med
  // "✅" (emoji-som-state). Eksplicit boolean i stedet — ingen emoji i JSX.
  const [msgOk, setMsgOk] = useState(false);
  const [activeTab, setActiveTab] = useState("auction");
  // #778: flash-auktion (30 min) på egne ryttere — kun synlig under aktivt
  // Deadline Day (samme gating som RiderStatsPage's AuctionButton).
  const [flash, setFlash] = useState(false);
  // #3184: tastefejl-værn — ciffer-drop-mønster mellem startpris og Værdi.
  // { suspected, pattern, suggestedValue } fra detectStartPriceTypo, eller null
  // når dialogen ikke er vist. Non-blocking: sælgeren kan altid fortsætte.
  const [typoWarning, setTypoWarning] = useState(null);
  // #1719/#1720: server-beregnede previews (gebyr / ny løn) hentes når fanen
  // åbnes, så manageren ser tallet før bekræftelse.
  const [releaseQuote, setReleaseQuote] = useState(null);
  const [extendQuote, setExtendQuote] = useState(null);
  // #1779: hvis quote-kaldet fejler skal feltet vise en forklaring i stedet for
  // evig "indlæser…". { release, extend }. Fyring/release er stadig akademi-
  // eksklusiv (egen flow, academyGraduation.js) → akademiryttere kan stadig ramme
  // dette for "release". Kontraktforlængelse ramte det TIDLIGERE også for
  // akademiryttere (403 fra extend-quote), men er nu tilladt direkte (#2179).
  const [quoteError, setQuoteError] = useState({ release: null, extend: null });

  // #3164: samme stille loft-tjek (#3143, current season + 3) som rytter-
  // profilens RiderManageActions — hentet ved modal-mount i stedet for ved
  // fane-skift, så "Forlæng"-fanen kan vises deaktiveret FØR spilleren klikker
  // sig ind i en request der er dømt til at fejle. Reglen selv lever kun
  // backend-side (maxAllowedContractEndSeason); frontend læser blot
  // errorParams.maxSeason fra den EKSISTERENDE extend-quote-route.
  const [extendCapped, setExtendCapped] = useState(false);
  const [extendCapSeason, setExtendCapSeason] = useState(null);
  // #3186 (Sentry CYCLINGZONE-45): rytter-profilens ækvivalente knap havde et
  // race-vindue — fanen startede ENABLED mens tjekket ovenfor stadig var i
  // flight, så et hurtigt klik kunne stadig nå en dømt-til-afvisning request.
  // extendCapChecking lukker samme vindue her: fanen er deaktiveret indtil vi
  // KENDER svaret, ikke kun når loftet er bekræftet. extendCapInfo er tælleren
  // ("Extensions used: X/3"), vist uanset om loftet er nået.
  const [extendCapChecking, setExtendCapChecking] = useState(true);
  const [extendCapInfo, setExtendCapInfo] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ok, data } = await fetchRiderQuote(rider.id, "extend-quote");
        if (cancelled) return;
        if (data?.extensionCap) setExtendCapInfo(data.extensionCap);
        if (ok) setExtendQuote(data);
        else if (data?.errorCode === "contract_extension_cap_reached") {
          setExtendCapped(true);
          setExtendCapSeason(data?.errorParams?.maxSeason ?? null);
        }
      } catch { /* stille — fane-skiftet forsøger igen og viser den rigtige fejl */ }
      finally { if (!cancelled) setExtendCapChecking(false); }
    })();
    return () => { cancelled = true; };
  }, [rider.id]);
  // #3597: samme delte gate som rytter-profilen. Modalen lukker ganske vist
  // efter en succesfuld forlængelse (så den ramte ikke selve #3597-hullet),
  // men spærringen skal afledes af det SAMME kapacitets-tal begge steder —
  // to forskellige udledninger af "må man forlænge?" er præcis den divergens
  // der lod runde 2 se løst ud på den ene flade og ikke den anden.
  const extendCap = extendCapGate({
    capped: extendCapped,
    capInfo: extendCapInfo,
    capSeason: extendCapSeason,
  });

  // Squad-fanen viser kun egne ryttere → auktion må sættes mellem 0 og Værdi (ikke over).
  // auctionPrice === null (ugyldigt/ikke-parsbart format, #3495) tælles altid som fejl.
  const auctionPriceError = auctionPrice == null || auctionPrice > riderValue || auctionPrice < 0;
  // #3495: parseInt(e.target.value) uden NaN-guard — et tomt/ugyldigt felt
  // sendte tidligere NaN direkte til POST-body. transferPrice er nu number|null.
  const transferPriceInvalid = transferPrice == null || transferPrice < 1;

  // Hent quote ved skift til release/extend-fanen (kun én gang pr. åbning).
  useEffect(() => {
    let cancelled = false;
    async function fetchQuote(path, setter, errKey) {
      try {
        // #2007: delt fetch-helper (riderContractActions.js) — samme implementering
        // som rytter-profilens RiderManageActions, ingen dobbelt token-/fetch-kode.
        const { ok, data } = await fetchRiderQuote(rider.id, path);
        if (cancelled) return;
        if (path === "extend-quote" && data?.extensionCap) setExtendCapInfo(data.extensionCap);
        if (ok) {
          setter(data);
        } else {
          // #1779: vis fejl-årsagen (fx akademirytter) i stedet for evig "indlæser…".
          setQuoteError(prev => ({ ...prev, [errKey]: resolveApiError(data, t, t("auth:error.connectionFailed")) }));
        }
      } catch {
        if (!cancelled) setQuoteError(prev => ({ ...prev, [errKey]: t("auth:error.connectionFailed") }));
      }
    }
    if (activeTab === "release" && releaseQuote === null && quoteError.release === null) fetchQuote("release-quote", setReleaseQuote, "release");
    if (activeTab === "extend" && extendQuote === null && quoteError.extend === null) fetchQuote("extend-quote", setExtendQuote, "extend");
    return () => { cancelled = true; };
  }, [activeTab, rider.id, releaseQuote, extendQuote, quoteError, t]);

  // #1719/#1720: begge handlinger er body-løse POST'er — serveren beregner
  // gebyr/løn fra rytter-state. Delt poster så fejl-/success-håndtering er ens.
  async function postRiderAction(path, successKey) {
    setLoading(true);
    try {
      // #2007: delt body-løs POST-helper (riderContractActions.js).
      const { ok, data } = await postRiderContractAction(rider.id, path);
      if (ok) { setMsgOk(true); setMsg(t(successKey)); setTimeout(() => { onAction(); onClose(); }, 1500); }
      else {
        setMsgOk(false); setMsg(`${t("actionModal.errorPrefix")}${resolveApiError(data, t)}`);
        // #2718: en afvist kontrakt-handling var kun synlig i UI'et — nu tælles
        // den også i Sentry, så vi kan se HVOR tit spillere bliver afvist.
        reportActionFailure(`rider_${path.replace(/-/g, "_")}`, {
          reason: data?.errorCode || data?.error,
          context: { riderId: rider.id },
        });
      }
    } catch (cause) {
      setMsgOk(false); setMsg(t("auth:error.connectionFailed"));
      reportActionFailure(`rider_${path.replace(/-/g, "_")}`, { cause, context: { riderId: rider.id } });
    } finally {
      setLoading(false);
    }
  }

  // #3184: pre-submit-gate på "Start"-knappen. Fanger et formodet ciffer-drop
  // FØR POST'en — sælgeren ser dialogen, kan rette prisen med ét klik, eller
  // bekræfte at prisen er med vilje og fortsætte uændret.
  function handleAuctionSubmit() {
    const typo = detectStartPriceTypo(auctionPrice, rider);
    if (typo.suspected) { setTypoWarning(typo); return; }
    startAuction();
  }

  async function startAuction() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ rider_id: rider.id, starting_price: auctionPrice, flash_auction: ddActive && flash }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setMsgOk(true); setMsg(t("actionModal.auction.successMsg")); setTimeout(() => { onAction(); onClose(); }, 1500); }
      else { setMsgOk(false); setMsg(`${t("actionModal.errorPrefix")}${resolveApiError(data, t)}`); }
    } catch {
      setMsgOk(false); setMsg(t("auth:error.connectionFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function listTransfer() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ rider_id: rider.id, asking_price: transferPrice }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setMsgOk(true); setMsg(t("actionModal.transfer.successMsg")); setTimeout(() => { onAction(); onClose(); }, 1500); }
      else { setMsgOk(false); setMsg(`${t("actionModal.errorPrefix")}${resolveApiError(data, t)}`); }
    } catch {
      setMsgOk(false); setMsg(t("auth:error.connectionFailed"));
    } finally {
      setLoading(false);
    }
  }

  const tabLabels = {
    auction: t("actionModal.tabs.auction"),
    transfer: t("actionModal.tabs.transfer"),
    release: t("actionModal.tabs.release"),
    extend: t("actionModal.tabs.extend"),
    demote: t("actionModal.tabs.demote"),
  };
  const tabKeys = ["auction", "transfer", "extend", "release", ...(canDemote ? ["demote"] : [])];

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-cz-card border border-cz-border rounded-cz w-full max-w-md">
        <div className="flex items-start justify-between p-5 border-b border-cz-border">
          <div>
            <h2 className="text-cz-1 font-bold text-lg">{rider.firstname} {rider.lastname}</h2>
            <p className="text-cz-accent-t font-mono text-sm mt-0.5">{formatNumber(riderValue)} CZ$</p>
          </div>
          <button onClick={onClose} aria-label={t("common:actions.close")} className="text-cz-3 hover:text-cz-1 text-xl"><span aria-hidden="true">×</span></button>
        </div>
        <div className="p-5 border-b border-cz-border">
          {/* #1242: samme kvalitative scouting-præsentation som alle andre flader —
              det hardcodede rå tal (showValue) er fjernet.
              #2888 (ejer 24/7: "den tekst-beskrivelse af potentiale regner jeg med at
              fjerne overalt"): den kvalitative TEKST-label ("Verdensklasse-emne" osv.)
              flyttes til tooltip'en — dette var det sidste sted på holdsiden hvor den
              stod som synlig tekst. Stjernerne bærer informationen (skala-skiftet
              stjerner → 1-99 er #2454/#2006, ikke denne PR). */}
          {scouting.estimateFor(rider.id) !== null && (
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-cz-border">
              <span className="text-cz-3 text-xs">{t("actionModal.potentialLabel")}</span>
              <ScoutablePotentiale rider={rider} scouting={scouting} labelAsTitle hideLevel />
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {STATS.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-cz-3 text-xs">{label}</span>
                <span className="inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded" style={statStyle(rider[key] || 0)}>
                  {rider[key] || "-"}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-5">
          <div className="flex gap-2 mb-4 flex-wrap">
            {tabKeys.map(tab => {
              // #3164/#3186: "Forlæng"-fanen deaktiveres FØR klik når rytteren
              // står på kontrakt-loftet (#3143) — ELLER mens vi endnu ikke ved
              // det (extendCapChecking, lukker samme race-vindue som #3186
              // fandt på rytter-profilen). #3597: spærringen kommer nu fra
              // extendCap.atCap (kapacitets-tallet fra extensionCap), ikke fra
              // det afvisnings-afledte extendCapped alene.
              const disabled = tab === "extend" && (extendCap.atCap || extendCapChecking);
              return (
                <button key={tab} type="button" onClick={() => !disabled && setActiveTab(tab)}
                  disabled={disabled}
                  title={extendCap.atCap && tab === "extend" ? t("actionModal.extend.capped", { season: extendCap.season }) : undefined}
                  className={`px-3 py-1.5 rounded-cz text-sm font-medium transition-all border disabled:opacity-40 disabled:pointer-events-none
                    ${activeTab === tab ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "text-cz-2 border-cz-border hover:text-cz-1"}`}>
                  {tabLabels[tab]}
                </button>
              );
            })}
          </div>
          {activeTab === "auction" && (
            <div>
              <p className="text-cz-2 text-xs mb-3">{t("actionModal.auction.description")}</p>
              {/* #778: flash-auktion på egne ryttere fra holdsiden — kun under Deadline Day */}
              {ddActive && (
                <label className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-3 cursor-pointer select-none">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={flash} onChange={e => setFlash(e.target.checked)}
                      className="rounded accent-cz-danger" />
                    <span className="text-sm text-cz-danger font-medium">{t("actionModal.auction.flashLabel")}</span>
                  </div>
                  <span className="text-xs text-cz-3 sm:ms-0 ms-6">{t("actionModal.auction.flashHint")}</span>
                </label>
              )}
              <div className="flex gap-2">
                <AmountInput value={auctionPrice}
                  onValueChange={v => setAuctionPrice(v)}
                  data-testid="team-auction-start-price-input"
                  wrapperClassName="flex-1"
                  className={`${controlClass({ error: auctionPriceError })} font-mono`} />
                <Button onClick={handleAuctionSubmit} disabled={loading || auctionPriceError}
                  className={ddActive && flash ? "!bg-cz-danger !text-white hover:brightness-110" : ""}>
                  {loading ? t("actionModal.loadingShort") : (ddActive && flash) ? t("actionModal.auction.startFlashButton") : t("actionModal.auction.startButton")}
                </Button>
              </div>
              {auctionPriceError && (
                <p className="text-cz-danger text-xs mt-1.5">
                  {t("actionModal.auction.priceError", { amount: formatNumber(riderValue) })}
                </p>
              )}
            </div>
          )}
          {activeTab === "transfer" && (
            <div>
              <p className="text-cz-2 text-xs mb-3">{t("actionModal.transfer.description")}</p>
              <div className="flex gap-2">
                <AmountInput value={transferPrice}
                  onValueChange={v => setTransferPrice(v)}
                  data-testid="team-transfer-list-price-input"
                  wrapperClassName="flex-1"
                  className={`${controlClass({ error: transferPriceInvalid })} font-mono`} />
                <Button onClick={listTransfer} disabled={loading || transferPriceInvalid}>
                  {loading ? t("actionModal.loadingShort") : t("actionModal.transfer.listButton")}
                </Button>
              </div>
            </div>
          )}
          {/* #1720: Forlæng kontrakt — genforhandlet løn + ny udløbssæson som preview. */}
          {activeTab === "extend" && (
            <div>
              <p className="text-cz-2 text-xs mb-3">{t("actionModal.extend.description")}</p>
              {/* #1779: når quote-kaldet fejler (fx akademirytter) viste lønnen
                  tidligere evig "indlæser…". Vis i stedet fejl-årsagen + deaktivér
                  knappen, så det er tydeligt at handlingen ikke er mulig her. */}
              {quoteError.extend ? (
                <div className="rounded-cz border border-cz-danger/30 bg-cz-danger-bg px-3 py-2.5 text-cz-danger text-xs">
                  {quoteError.extend}
                </div>
              ) : (
                <>
                  <div className="space-y-1.5 mb-3 text-sm">
                    {/* #3186: tælleren er synlig FØR bekræftelse, uanset om
                        loftet er nået — samme begrundelse som rytter-profilen. */}
                    {extendCapInfo && (
                      <div className="flex items-center justify-between">
                        <span className="text-cz-3 text-xs">{t("actionModal.extend.capCounterLabel")}</span>
                        <span className="text-cz-2 font-mono">{extendCapInfo.usedExtensions}/{extendCapInfo.maxExtensions}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-cz-3 text-xs">{t("actionModal.extend.currentSalaryLabel")}</span>
                      <span className="text-cz-2 font-mono">{formatNumber(rider.salary || 0)} CZ$</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-cz-3 text-xs">{t("actionModal.extend.newSalaryLabel")}</span>
                      <span className="text-cz-1 font-mono font-bold">
                        {extendQuote ? `${formatNumber(extendQuote.newSalary)} CZ$` : t("actionModal.loadingShort")}
                      </span>
                    </div>
                    {extendQuote && (
                      <div className="flex items-center justify-between">
                        <span className="text-cz-3 text-xs">{t("actionModal.extend.newContractLabel")}</span>
                        <span className="text-cz-2 font-mono">
                          {t("actionModal.extend.newContractValue", { season: extendQuote.contract_end_season })}
                        </span>
                      </div>
                    )}
                  </div>
                  {/* #2718: mens tilbuddet hentes var knappen disabled og tavs —
                      samme døde klik som på rytterprofilen. Nu spinner + label. */}
                  <Button onClick={() => postRiderAction("extend-contract", "actionModal.extend.successMsg")}
                    loading={loading || !extendQuote} className="w-full">
                    {loading
                      ? t("actionModal.extend.workingButton")
                      : !extendQuote
                        ? t("actionModal.extend.loadingTermsButton")
                        : t("actionModal.extend.confirmButton")}
                  </Button>
                </>
              )}
            </div>
          )}
          {/* #1719: Fyr rytter — buyout-gebyr som preview + balance-gate. */}
          {activeTab === "release" && (
            <div>
              <p className="text-cz-2 text-xs mb-3">{t("actionModal.release.description")}</p>
              <div className="space-y-1.5 mb-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-cz-3 text-xs">{t("actionModal.release.feeLabel")}</span>
                  <span className="text-cz-danger font-mono font-bold">
                    {releaseQuote ? `${formatNumber(releaseQuote.fee)} CZ$` : t("actionModal.loadingShort")}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-cz-3 text-xs">{t("actionModal.release.balanceLabel")}</span>
                  <span className="text-cz-2 font-mono">{formatNumber(team?.balance ?? 0)} CZ$</span>
                </div>
              </div>
              <p className="text-cz-3 text-xs mb-3">
                {releaseQuote && releaseQuote.fee === 0
                  ? t("actionModal.release.freeHint")
                  : t("actionModal.release.feeHint")}
              </p>
              {releaseQuote && releaseQuote.affordable === false && (
                <p className="text-cz-danger text-xs mb-3">{t("actionModal.release.cannotAfford")}</p>
              )}
              <Button onClick={() => postRiderAction("release", "actionModal.release.successMsg")}
                disabled={loading || (releaseQuote && releaseQuote.affordable === false)}
                className="w-full !bg-cz-danger !text-white hover:brightness-110">
                {loading ? t("actionModal.loadingShort") : t("actionModal.release.confirmButton")}
              </Button>
            </div>
          )}
          {/* #932 S7: Demote til akademi — kun U23-seniorer. Selve bekræftelsen
              (cap + løn-delta + løb ryddet) sker i AcademyTransferConfirmModal på
              holdsiden; her forklarer vi handlingen og overdrager til forælderen. */}
          {activeTab === "demote" && canDemote && (
            <div>
              <p className="text-cz-2 text-xs mb-3">{t("actionModal.demote.description")}</p>
              <div className="space-y-1.5 mb-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-cz-3 text-xs">{t("actionModal.demote.currentSalaryLabel")}</span>
                  <span className="text-cz-2 font-mono">{formatNumber(rider.salary || 0)} CZ$</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-cz-3 text-xs">{t("actionModal.demote.youthSalaryLabel")}</span>
                  {/* #2796: division SKAL med — uden den falder salaryFromProduction
                      tilbage på den globale sats (0,1606) i stedet for holdets
                      (fx 0,3029 i D1), så den viste ungdomsløn er systematisk forkert.
                      Samme fejl som promote-dialogen på akademi-siden havde. */}
                  <span className="text-cz-1 font-mono font-bold">{formatNumber(projectYouthSalary(rider, { division: team?.division }))} CZ$</span>
                </div>
              </div>
              <p className="text-cz-3 text-xs mb-3">{t("actionModal.demote.hint")}</p>
              <Button onClick={() => { onClose(); onDemote(rider); }}
                disabled={loading}
                className="w-full !bg-cz-warning !text-cz-on-accent hover:brightness-110">
                {t("actionModal.demote.confirmButton")}
              </Button>
            </div>
          )}
          {msg && <p className={`text-sm mt-3 ${msgOk ? "text-cz-success" : "text-cz-danger"}`}>{msg}</p>}
        </div>
      </div>
      {/* #3184: tastefejl-værn — separat overlay oven på selve modalen ved
          formodet ciffer-drop, søskende til (ikke indlejret i) hoved-panelet
          så vi ikke dobbelt-lægger to bg-black/70-lag. */}
      <StartPriceTypoGuardModal
        show={!!typoWarning}
        riderName={`${rider.firstname} ${rider.lastname}`}
        price={auctionPrice}
        marketValue={typoWarning?.suggestedValue ?? riderValue}
        busy={loading}
        onDismiss={() => setTypoWarning(null)}
        onFix={() => { setAuctionPrice(typoWarning?.suggestedValue ?? riderValue); setTypoWarning(null); }}
        onConfirm={() => { setTypoWarning(null); startAuction(); }}
      />
    </div>
  );
}

// #2183: kompakt badge på egen holdside når en rytter er under aktiv auktion —
// manageren skal ikke selv opdage det på /auctions. Egen live countdown (samme
// lokaliserede enheder som AuctionsPage's Countdown-komponent) + link direkte
// til "Min situation"-fanen, hvor rytteren står som sælger.
function OwnAuctionBadge({ auction }) {
  const { t } = useTranslation(["team", "auctions", "rider"]);
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    function update() {
      const diff = new Date(auction.calculated_end) - new Date();
      if (diff <= 0) { setTimeLeft(t("auctions:timer.expired")); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(
        h > 0 ? t("auctions:timer.hoursMinutes", { h, m })
        : m > 0 ? t("auctions:timer.minutesSeconds", { m, s })
        : t("auctions:timer.seconds", { s }),
      );
    }
    update();
    const tick = setInterval(update, 1000);
    return () => clearInterval(tick);
  }, [auction.calculated_end, t]);

  return (
    <Link
      to="/auctions?tab=my-situation"
      onClick={e => e.stopPropagation()}
      title={t("team:squad.ownAuctionTooltip", { price: formatNumber(auction.current_price), timeLeft })}
      className="inline-flex items-center gap-1 text-3xs font-semibold uppercase tracking-wide leading-none px-1.5 py-0.5 rounded flex-shrink-0 bg-cz-accent/15 text-cz-accent-t hover:bg-cz-accent/25 transition-colors"
    >
      {t("rider:badges.label.auction")}
      <span className="font-mono normal-case tracking-normal">{formatNumber(auction.current_price)}</span>
    </Link>
  );
}

function SquadTab({ riders, scouting, onSelectRider, ownAuctions, seasonYear, activeSeasonNumber }) {
  const { t } = useTranslation("team");
  // #1131: fulde stat-navne som native tooltip på de forkortede kolonne-headers.
  const { t: tRider } = useTranslation("rider");
  // #1796: hele rytter-rækken navigerer til rytter-profilen (flest dead clicks på
  // /team var klik på værdi-/potentiale-cellen). Samme row-as-link-mønster som
  // /riders (RiderRow). Navn-linket + Handling-knappen stopper propagation.
  const navigate = useNavigate();
  // #1095: eksplicit "nuværende" vs "kommende" trup-visning i stedet for
  // vis/skjul-toggles — spillere med ind-/udgående ryttere skal tydeligt
  // kunne se begge tilstande.
  const [squadView, setSquadView] = useState("current");
  // #1929 (redesign 3/7): akademiryttere lever på holdet men uden for senior-cap'en (30)
  // og vises nu i SAMME tabel som seniorerne, styret af to gruppe-filtre (begge on som
  // default → hele holdet vist). Datakilden er den samme (loadAll henter is_academy).
  const [showSeniors, setShowSeniors] = useState(true);
  const [showAcademy, setShowAcademy] = useState(true);
  // #2906 punkt 1 (ejer 25/7: "muligt/nemmere at se alle evner på samme tid"):
  // to kolonne-tilstande i stedet for én 25-kolonners tabel ingen skærm kan vise.
  // "overview" = de beskrivende kolonner (værdi, løn, status, kontrakt, handling);
  // "abilities" = navn + rating + de 15 evner, som TILSAMMEN er smallere end
  // 1280px-viewporten → alle 15 evner synlige på én gang uden vandret scroll.
  const [tableMode, setTableMode] = useState("overview");

  // Incoming = riders with pending_team_id = myTeam but team_id != myTeam
  // Outgoing = riders with team_id = myTeam but pending different team
  const incomingRiders = riders.filter(r => r._isIncoming);
  const outgoingRiders = riders.filter(r => r._isOutgoing);

  // Gruppe-tællere til filter-knapperne. Seniorer i den aktive transfer-visning;
  // akademiryttere er off-cap og har hverken ind-/udgående flag.
  const seniorGroupCount  = riders.filter(r => !r.is_academy && (squadView === "upcoming" ? !r._isOutgoing : !r._isIncoming)).length;
  const academyGroupCount = riders.filter(r => r.is_academy && !r._isIncoming).length;

  // Nuværende = senior-truppen nu (inkl. udgående, ekskl. indgående).
  // Kommende = senior-truppen efter ventende transfers (uden udgående, med indgående).
  const currentCount  = riders.filter(r => !r._isIncoming && !r.is_academy).length;
  const upcomingCount = riders.filter(r => !r._isOutgoing && !r.is_academy).length;

  // #1929-redesign: ÉT samlet roster. Base = aktiv transfer-visning (akademiryttere
  // passerer begge ind-/udgående filtre) → filtrér efter gruppe-toggles (default begge on).
  const displayRidersBase = (squadView === "upcoming"
    ? riders.filter(r => !r._isOutgoing)
    : riders.filter(r => !r._isIncoming)
  )
    .filter(r => (r.is_academy ? showAcademy : showSeniors))
    // #1162: dekorér med estimat-midtpunktet så potentiale-kolonnen kan sorteres
    // uden den rå (server-skjulte) potentiale.
    // #2906 punkt 2: `_ovr` = den samme 1-99-rating som rytterprofilen og
    // auktionerne viser (riderOverallRating, type-bevidst). Dekoreres her, så
    // rating-kolonnen kan sorteres via useClientRiderFilters' numeriske gren.
    .map(r => ({
      ...r,
      _scoutMid: scoutSortValue(scouting.estimateFor(r.id)),
      _ovr: riderOverallRating(r),
    }));
  const riderFilters = useClientRiderFilters(displayRidersBase, seasonYear);
  const displayRiders = riderFilters.filtered;
  const sort = riderFilters.filters.sort;
  const sortDir = riderFilters.filters.sort_dir;
  function handleSort(key) {
    // #1755: delt cyklus-logik så holdsiden sorterer som de øvrige rytter-tabeller.
    const next = cycleSortState({ sort, dir: sortDir }, key);
    riderFilters.onChange("sort", next.sort);
    riderFilters.onChange("sort_dir", next.dir);
  }

  const hasTransfers = incomingRiders.length > 0 || outgoingRiders.length > 0;

  const nameColumn = {
    key: "name",
    header: t("squad.headers.rider"),
    sticky: true,
    sortKey: "firstname",
    // INGEN subline (ejer 25/7: "navnet er helligt"). Ryttertypen stod her et
    // øjeblik i evne-tilstanden — den hører hjemme i sin egen kolonne som alle
    // andre steder i appen; type folder derfor BEVIDST IKKE ind i mobil-
    // underlinjen (#3045 holder sig til denne grænse selvom rating tilføjes
    // nedenfor). Mobil-folden er nation + alder + rating (se ratingColumn).
    render: (r) => (
      <>
        {r._isIncoming && <span className="w-2 h-2 rounded-full bg-cz-success flex-shrink-0" />}
        {r._isOutgoing && <span className="w-2 h-2 rounded-full bg-cz-danger flex-shrink-0" />}
        <RiderLink id={r.id} stopPropagation
          className="text-cz-1 hover:text-cz-accent-t transition-colors">
          {r.firstname} {r.lastname}
        </RiderLink>
      </>
    ),
  };

  // #2906 punkt 2 / #2888 punkt 2: rating som TAL (1-99), ikke stjerner.
  // Farveplade via den DELTE statPlateStyle — nøjagtig samme behandling som
  // rytterprofilens hero (ejer 25/7: rating skal have farve, og den skal se ud
  // som den gør på profilen). At skalaen hælder mod gråt indtil #2890 er løst er
  // en accepteret afvejning; fixet sker ét sted (statColor), ikke her.
  // #3045: rating fold'es ind i mobil-underlinjen (portræt-kolonnekontrakten —
  // rating er det primære "hvor god er han"-signal). Type foldes BEVIDST IKKE
  // her (se nameColumn/typeColumn-kommentarerne — ejer 25/7: "navnet er
  // helligt", typen skal altid stå i sin egen kolonne). Fold-sættet på denne
  // side er derfor nation+alder+rating, ikke rating+type+værdi som de andre
  // fire rytterflader — se PR-beskrivelsen for afvejningen.
  const ratingColumn = {
    key: "rating",
    header: <span title={t("squad.headers.ratingTitle")}>{t("squad.headers.rating")}</span>,
    sortKey: "_ovr",
    numeric: true,
    compact: true,
    fold: true,
    foldValue: (r) => (Number.isFinite(r._ovr) ? String(r._ovr) : "—"),
    render: (r) => (Number.isFinite(r._ovr) ? (
      <span className="inline-flex items-center justify-center min-w-[30px] px-1.5 py-0.5 rounded-cz font-semibold"
        style={statPlateStyle(r._ovr)}>
        {r._ovr}
      </span>
    ) : <span className="text-cz-3">—</span>),
  };

  // #2888 punkt 3: sekundærtypen på egen linje — kolonnen var den bredeste
  // enkeltkolonne i tabellen ("Etapeløbsrytter / Bjergrytter" på én linje).
  // Ejer 25/7: typen skal ALTID stå i sin egen kolonne som den plejer, aldrig
  // som en del af navnecellen — derfor deles præcis samme definition af begge
  // tilstande i stedet for at evne-tilstanden opfinder sin egen placering.
  const typeColumn = {
    key: "type",
    header: t("squad.headers.type"),
    sortKey: "primary_type",
    compact: true,
    render: (r) => <RiderTypeBadge primaryType={r.primary_type} secondaryType={r.secondary_type} stacked />,
  };

  // Ejer-feedback 25/7: evne-tallene stod for langt fra hinanden — de skal læses
  // som ÉN matrix. `tight` (px-1) i stedet for `compact` (px-2) halverer gutteren
  // igen; adskillelsen kommer fra badgens egen farve, ikke fra luft.
  const abilityColumns = STATS.map(({ key, label }) => ({
    key,
    header: <span title={tRider(`racePreview.derived.${key}`)}>{label}</span>,
    sortKey: key,
    numeric: true,
    tight: true,
    render: (r) => (
      <span className="inline-block min-w-[24px] text-center text-xs font-mono px-1 py-0.5 rounded"
        style={statStyle(r[key] || 0)}>
        {r[key] || "-"}
      </span>
    ),
  }));

  const overviewColumns = [
    {
      key: "nation",
      header: t("squad.headers.nation"),
      sortKey: "nationality_code",
      fold: true,
      foldValue: (r) => getCountryCode3(r.nationality_code) || "—",
      render: (r) => <NationCell code={r.nationality_code} />,
    },
    nameColumn,
    ratingColumn,
    {
      key: "potential",
      header: t("squad.headers.potential"),
      sortKey: "_scoutMid",
      compact: true,
      // #2849 bølge 6 + #2888: stjernerne alene — den kvalitative label ligger i
      // tooltip'en (labelAsTitle) og scout-niveauet i scouting-fanen (hideLevel).
      render: (r) => <ScoutablePotentiale rider={r} scouting={scouting} labelAsTitle hideLevel />,
    },
    {
      key: "value",
      header: t("squad.headers.value"),
      sortKey: "value",
      numeric: true,
      compact: true,
      render: (r) => <span className="text-cz-accent-t font-bold">{formatNumber(getRiderMarketValue(r))}</span>,
    },
    {
      key: "salary",
      header: t("squad.headers.salary"),
      sortKey: "salary",
      numeric: true,
      compact: true,
      render: (r) => <span className="text-cz-2">{formatNumber(r.salary || 0)}</span>,
    },
    // #1482: Status — alder + ind-/udgående som skanbare badges.
    // #1531: skade-badge når rytteren er skadet (injured_until i fremtiden).
    // #3097: retireRisk + contractExpiring — SAMME to mekanikker squad-risk-
    // spærren (#2748) tæller som "i risiko" ved et salg (backend/lib/
    // squadRiskGuard.js's isRiderAtRisk), nu synlige HER hvor salg besluttes,
    // ikke kun på auktionskort/rytterprofil. is_academy udelades — guarden
    // tæller kun senior-ryttere (fetchTeamRiskRows filtrerer is_academy=false).
    {
      key: "badges",
      header: t("squad.headers.badges"),
      compact: true,
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          <RiderBadges badges={[
            isRiderInjured(r.injured_until) && "injured",
            r.is_academy && "academy",
            ageBadgeKey(r, seasonYear),
            !r.is_academy && retirementRiskBadgeKey(r, seasonYear),
            !r.is_academy && contractExpiringBadgeKey(r, activeSeasonNumber),
            r._isIncoming && "incoming",
            r._isOutgoing && "outgoing",
          ]} />
          {/* #2183: egen aktiv auktion — badge + højeste bud + tid tilbage, link til auktionen. */}
          {!r._isIncoming && ownAuctions[r.id] && <OwnAuctionBadge auction={ownAuctions[r.id]} />}
        </div>
      ),
    },
    // #1674: numerisk alder i egen kolonne (Status-badget viser kun U23/U25-tier).
    {
      key: "age",
      header: t("squad.headers.age"),
      sortKey: "birthdate",
      numeric: true,
      compact: true,
      fold: true,
      foldValue: (r) => String(getRiderAge(r.birthdate, seasonYear) ?? "—"),
      render: (r) => <span className="text-cz-2">{getRiderAge(r.birthdate, seasonYear) ?? "—"}</span>,
    },
    typeColumn,
    // #1482: Kontraktudløb. #2888: cellen viser den korte sæson-form ("S4") med
    // den fulde sætning i tooltip'en — "Udløber efter S4" fyldte ~120px pr. række.
    {
      key: "contract",
      header: t("squad.headers.contract"),
      sortKey: "contract_end_season",
      numeric: true,
      compact: true,
      render: (r) => (
        <span className="text-cz-2"
          title={r.contract_end_season != null ? t("squad.headers.contractValue", { season: r.contract_end_season }) : undefined}>
          {r.contract_end_season != null ? t("squad.headers.contractShort", { season: r.contract_end_season }) : "—"}
        </span>
      ),
    },
    {
      key: "action",
      header: t("squad.headers.action"),
      compact: true,
      render: (r) => (!r._isIncoming ? (
        <button onClick={(e) => { e.stopPropagation(); onSelectRider(r); }}
          className="px-3 py-1 min-h-[44px] sm:min-h-[30px] bg-cz-subtle hover:bg-cz-subtle text-cz-2 hover:text-cz-1 rounded text-xs transition-all border border-cz-border whitespace-nowrap">
          {t("squad.actionButton")}
        </button>
      ) : null),
    },
  ];

  // Evne-tilstand: navn (sticky) + rating + type + de 15 evner. Med tight-gutteren
  // er det ~830px på desktop → ingen vandret scroll, og typen beholder sin egen
  // kolonne i stedet for at ligge under navnet.
  const abilityModeColumns = [nameColumn, ratingColumn, typeColumn, ...abilityColumns];
  const columns = tableMode === "abilities" ? abilityModeColumns : overviewColumns;

  return (
    <div>
      {/* #2888/#2906: ÉN kontrol-række i stedet for op til tre stablede rækker
          (gruppe-filtre, nuværende/kommende, tilstand). Hver stablet række kostede
          ~44px højde over tabellen — den plads er det tabellen skulle bruge.
          Venstre: hvem vises. Højre: hvilke kolonner vises. */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {/* #1929-redesign: gruppe-filtre — inkludér/ekskludér seniorer og
            akademiryttere uafhængigt. Default begge på = hele holdet vist. Kun
            synligt når holdet har akademiryttere (ellers er der intet at filtrere). */}
        {academyGroupCount > 0 && (
          // #3188: "Vis" + de to filter-pilles lå som løse søskende direkte i den
          // ydre rækkes `gap-2`-flex — samme gap-afstand som til de HELT andre
          // kontrolgrupper (nuværende/kommende, Oversigt/Evner) ved siden af.
          // Et klik der ramte imellem "Vis" og "Seniorer (N)" boblede op til den
          // ydre række (ingen handler dér) i stedet for en af knapperne — Clarity
          // rapporterede den samlede tekst "VisSeniorer (N)Akademi (N)" som dead
          // click (1.306, 27/7-3/8). Egen wrapper med SAMME gap (ingen visuel
          // ændring) fanger nu klik i mellemrummet lokalt i stedet for at lade dem
          // forsvinde op til den ydre rækkes tomme baggrund.
          <div className="flex items-center gap-2">
            <span className="text-xs text-cz-3 select-none">{t("squad.filter.label")}</span>
            <button type="button" onClick={() => setShowSeniors(v => !v)} aria-pressed={showSeniors}
              className={`px-3 py-1.5 text-xs font-medium rounded-cz border transition-all ${showSeniors ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "bg-cz-card text-cz-3 border-cz-border hover:text-cz-1"}`}>
              {t("squad.filter.seniors", { count: seniorGroupCount })}
            </button>
            <button type="button" onClick={() => setShowAcademy(v => !v)} aria-pressed={showAcademy}
              className={`px-3 py-1.5 text-xs font-medium rounded-cz border transition-all ${showAcademy ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "bg-cz-card text-cz-3 border-cz-border hover:text-cz-1"}`}>
              {t("squad.filter.academy", { count: academyGroupCount })}
            </button>
          </div>
        )}

        {/* #1095: segmenteret nuværende/kommende-visning */}
        {hasTransfers && (
          <div className="flex rounded-cz border border-cz-border overflow-hidden">
            {[
              { key: "current",  label: t("squad.view.current",  { count: currentCount }) },
              { key: "upcoming", label: t("squad.view.upcoming", { count: upcomingCount }) },
            ].map(v => (
              <button key={v.key} onClick={() => setSquadView(v.key)} aria-pressed={squadView === v.key}
                className={`px-3 py-1.5 text-xs font-medium transition-all
                  ${squadView === v.key
                    ? "bg-cz-accent/10 text-cz-accent-t"
                    : "bg-cz-card text-cz-2 hover:text-cz-1"}`}>
                {v.label}
              </button>
            ))}
          </div>
        )}

        {/* #2906 punkt 1: kolonne-tilstand. "Evner" viser alle 15 evner samtidig. */}
        <div className="flex rounded-cz border border-cz-border overflow-hidden ms-auto">
          {[
            { key: "overview",  label: t("squad.mode.overview") },
            { key: "abilities", label: t("squad.mode.abilities") },
          ].map(m => (
            <button key={m.key} type="button" onClick={() => setTableMode(m.key)} aria-pressed={tableMode === m.key}
              className={`px-3 py-1.5 text-xs font-medium transition-all
                ${tableMode === m.key
                  ? "bg-cz-accent/10 text-cz-accent-t"
                  : "bg-cz-card text-cz-2 hover:text-cz-1"}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {squadView === "upcoming" && (incomingRiders.length > 0 || outgoingRiders.length > 0) && (
        <p className="text-cz-3 text-xs mb-3">{t("squad.view.upcomingHint")}</p>
      )}

      {displayRiders.length === 0 ? (
        riders.length === 0 ? (
          /* #1569: ægte tom trup (ny spiller) — gør blindgyden guidende med en
             primær CTA til markedet, så "hvad gør jeg nu?" har et svar.
             #2849 bølge 1: kanonisk EmptyState — action-slotten har undtagelsesvis
             to knapper (marked + auktioner) i stedet for T2-reglens ÉN, fordi
             begge CTA'er er del af godkendt scope (#1569) og dækkes af den
             colocated emptySquadCta-test. */
          <EmptyState
            icon={<BikeIcon size={26} aria-hidden="true" />}
            title={t("squad.emptyState")}
            description={t("squad.emptyStateBody")}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Link to="/riders" className={`${buttonClass({ variant: "primary", size: "sm" })} inline-flex`}>
                  {t("squad.emptyStateCta")}
                </Link>
                <Link to="/auctions" className={`${buttonClass({ variant: "secondary", size: "sm" })} inline-flex`}>
                  {t("squad.emptyStateCtaAuctions")}
                </Link>
              </div>
            }
          />
        ) : (
          /* Trup har ryttere, men den valgte visning/filter er tom. */
          <EmptyState icon={<BikeIcon size={26} aria-hidden="true" />} title={t("squad.emptyView")} />
        )
      ) : (
        /* #2888/#2906: truppen bruger nu den KANONISKE DataTable (T2-recipen) i
           stedet for sin egen kopi af tabel-markuppen. Rækken navigerer stadig
           til rytterprofilen (#1796) — det sker via DataTable's rowProps-hook,
           som blev tilføjet i #2849 bølge 1 og gjorde den gamle "DataTable kan
           ikke udtrykke denne tabel"-begrundelse forældet. Gevinsten er delt
           adfærd: mobil-fold (nation/alder/kontrakt ind i navnecellens
           underlinje), sticky navnekolonne, zone-tints og den nye `dense`-
           rækkehøjde rammer alle T2-tabeller på én gang, ikke kun holdsiden. */
        <DataTable
          label={t("tabs.squad", { count: displayRiders.length })}
          columns={columns}
          rows={displayRiders}
          rowKey={(r) => r.id}
          dense
          rowZone={(r) => (r._isIncoming ? "success" : r._isOutgoing ? "danger" : null)}
          rowProps={(r) => ({ onClick: () => navigate(`/riders/${r.id}`), className: "cursor-pointer" })}
          sort={sort}
          sortDir={sortDir}
          onSort={handleSort}
          count={t("squad.count", { count: displayRiders.length })}
        />
      )}
    </div>
  );
}

export function TeamPage() {
  const { t } = useTranslation("team");
  const scouting = useScouting();
  // #3071: sæson-referenceår til alders-visning/badges/filtre (se riderAge.js).
  const seasonYear = useActiveSeasonYear();
  // #3097: kontrakt-udløb sammenlignes mod sæson-NUMMERET (contract_end_season
  // er et sæson-nummer, ikke et år) — udledt af seasonYear i stedet for en
  // ekstra fetch (seasonNumberFromReferenceYear er seasonReferenceYear's exakte
  // inverse, se riderAge.js).
  const activeSeasonNumber = seasonNumberFromReferenceYear(seasonYear);
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [activeTab, setActiveTab] = useState("squad");
  const [selectedRider, setSelectedRider] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ddActive, setDdActive] = useState(false);
  // #932 S7: demote-bekræftelse (senior → akademi). { rider, racesCleared } | null.
  const [demoteConfirm, setDemoteConfirm] = useState(null);
  const [demoteBusy, setDemoteBusy] = useState(false);
  const [demoteError, setDemoteError] = useState(null);
  // #2499: værdi-delta pr. rytter (kompakt pil i værdi-kolonnen) — { [riderId]: { windows } }.
  // #2183: egne ryttere der lige nu er under aktiv auktion — { [riderId]: auctionRow }.
  // Genindlæses ved hver loadAll() (dvs. også efter en handling i RiderActionModal
  // starter en ny auktion) + holdes friskt via realtime-subscription nedenfor.
  const [ownAuctions, setOwnAuctions] = useState({});
  // Ref'en holder ID'erne på nuværende (ikke-indgående) egne ryttere, så
  // realtime-callbacket kan filtrere uden at skulle re-subscribe ved hver rytter-ændring.
  const ownRiderIdsRef = useRef(new Set());

  useEffect(() => { loadAll(); loadDdStatus(); }, []);
  useEffect(() => {
    ownRiderIdsRef.current = new Set(riders.filter(r => !r._isIncoming).map(r => r.id));
  }, [riders]);
  // #2183: realtime — hold auktionens pris/status friske mens manageren står på
  // holdsiden (nyt bud fra en anden manager, eller auktionen afsluttes/annulleres).
  useEffect(() => {
    const channel = supabase.channel("team-own-auctions")
      .on("postgres_changes", { event: "*", schema: "public", table: "auctions" }, payload => {
        const row = payload.eventType === "DELETE" ? payload.old : payload.new;
        if (!row?.rider_id || !ownRiderIdsRef.current.has(row.rider_id)) return;
        const stillActive = payload.eventType !== "DELETE" && ["active", "extended"].includes(payload.new?.status);
        setOwnAuctions(prev => {
          if (!stillActive) {
            if (!(row.rider_id in prev)) return prev;
            const next = { ...prev };
            delete next[row.rider_id];
            return next;
          }
          return { ...prev, [row.rider_id]: { ...prev[row.rider_id], ...payload.new } };
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);
  // #2849 bølge 6: værdi-delta-pilen er fjernet fra truppen efter ejer-feedback,
  // og dermed også dens batch-hentning (POST /api/riders/value-trend) — den kørte
  // ved hvert besøg på holdsiden uden at noget længere brugte svaret.
  // Bevægelsen vises fortsat på rytterprofilens hero, som henter sin egen.

  // Åbn demote-bekræftelsen: tæl fremtidige løb rytteren ville blive fjernet fra
  // (scheduled + stages_completed=0), så dialogen kan vise konsekvensen FØR confirm.
  async function handleDemote(rider) {
    setDemoteError(null);
    let racesCleared = 0;
    let academyCount = null;
    try {
      const [entriesRes, academyRes] = await Promise.all([
        supabase
          .from("race_entries")
          .select("race_id, races!inner(status, stages_completed)")
          .eq("rider_id", rider.id)
          .eq("races.status", "scheduled")
          .eq("races.stages_completed", 0),
        // Akademi-cap-effekt: tæl holdets nuværende akademiryttere (8-cap).
        team?.id
          ? supabase.from("riders").select("id", { count: "exact", head: true })
              .eq("team_id", team.id).eq("is_academy", true)
          : Promise.resolve({ count: null }),
      ]);
      racesCleared = (entriesRes.data || []).length;
      academyCount = academyRes.count ?? null;
    } catch { /* count er nice-to-have; vis dialogen uanset */ }
    setDemoteConfirm({ rider, racesCleared, academyCount });
  }

  async function confirmDemote() {
    if (!demoteConfirm) return;
    const rider = demoteConfirm.rider;
    setDemoteBusy(true);
    setDemoteError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/academy/demote`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ riderId: rider.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDemoteConfirm(null);
        loadAll();
      } else {
        setDemoteError(resolveApiError(data, t, t("auth:error.connectionFailed")));
      }
    } catch {
      setDemoteError(t("auth:error.connectionFailed"));
    } finally {
      setDemoteBusy(false);
    }
  }

  // #778: action-modal'en skal vide om Deadline Day er aktiv for at kunne
  // tilbyde flash-auktion (30 min) — samme status-endpoint som RiderStatsPage.
  async function loadDdStatus() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/deadline-day/status`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDdActive(data.active === true);
      }
    } catch { /* non-critical: flash-valget falder bare tilbage til skjult */ }
  }

  // #2183: henter aktive/forlængede auktioner på de rytter-id'er der lige er
  // hentet i loadAll() — kaldes med et eksplicit id-array (ikke `riders`-state)
  // for at undgå at ramme forrige render's trup. Non-critical: fejl efterlader
  // bare ownAuctions uændret/tom → badget forsvinder i stedet for at crashe siden.
  async function loadOwnAuctions(riderIds) {
    if (!riderIds.length) { setOwnAuctions({}); return; }
    try {
      const { data, error } = await supabase
        .from("auctions")
        .select("id, rider_id, current_price, calculated_end, status, is_flash")
        .in("rider_id", riderIds)
        .in("status", ["active", "extended"]);
      if (error) return;
      setOwnAuctions(Object.fromEntries((data || []).map(a => [a.rider_id, a])));
    } catch {
      // non-critical — badget falder bare væk
    }
  }

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (auth-flow redirecter til /login)
    if (!user) { setLoading(false); return; }
    const { data: myTeam } = await supabase.from("teams").select("*").eq("user_id", user.id).single();
    if (!myTeam) { setLoading(false); return; }
    setTeam(myTeam);

    // #2748: pensionerede ryttere vises ikke i truppen — de frigives ved
    // sæsonskiftet (retirementRelease.js) og kan hverken køre løb eller sælges.
    // Uden filteret ville de stå i listen og tælle med i trup-/løn-/værditotalerne
    // i vinduet mellem pensionering og frigivelse.
    const [ridersRes, pendingRes] = await Promise.all([
      supabase.from("riders")
        .select(`id, firstname, lastname, birthdate, market_value, salary, prize_earnings_bonus, current_production_value, is_u25, is_academy, base_value, pending_team_id, nationality_code, primary_type, secondary_type, contract_end_season, ${ABILITY_SELECT}, ${CONDITION_SELECT}`)
        .eq("team_id", myTeam.id)
        .eq("is_retired", false)
        .order("market_value", { ascending: false }),
      supabase.from("riders")
        .select(`id, firstname, lastname, birthdate, market_value, salary, prize_earnings_bonus, current_production_value, is_u25, is_academy, base_value, pending_team_id, nationality_code, primary_type, secondary_type, contract_end_season, ${ABILITY_SELECT}, ${CONDITION_SELECT}`)
        .eq("pending_team_id", myTeam.id)
        .eq("is_retired", false)
        .order("market_value", { ascending: false }),
    ]);

    // #1529: evnerne kommer som joinet rider_derived_abilities-embed; flattenAbilities
    // løfter rider.climbing osv. op på rytter-objektet så render/sort virker uændret.
    // #1531: flattenCondition løfter rider_condition.injured_until op til skade-badget.
    const currentRiders = (ridersRes.data || []).map(r => ({
      ...flattenCondition(flattenAbilities(r)),
      _isOutgoing:  r.pending_team_id && r.pending_team_id !== myTeam.id,
    }));
    const incomingRiders = (pendingRes.data || []).map(r => ({ ...flattenCondition(flattenAbilities(r)), _isIncoming: true }));

    setRiders([...currentRiders, ...incomingRiders]);
    loadOwnAuctions(currentRiders.map(r => r.id));
    setLoading(false);
  }

  const currentRiders = riders.filter(r => !r._isIncoming);
  const totalSalary = currentRiders.reduce((s, r) => s + (r.salary || 0), 0);
  const totalValue  = currentRiders.reduce((s, r) => s + getRiderMarketValue(r), 0);
  const incomingCount = riders.filter(r => r._isIncoming).length;
  const outgoingCount = riders.filter(r => r._isOutgoing).length;
  // #1886: kun senior-ryttere tæller mod squad-cap'en (30). Akademiryttere vises
  // i listen men er uden for cap'en — gør det eksplicit så en trup på fx 29+3
  // ikke ligner et cap-brud på 30.
  const seniorCount  = currentRiders.filter(r => !r.is_academy).length;
  const academyCount = currentRiders.filter(r =>  r.is_academy).length;
  const squadCap     = getSquadLimits(team?.division).max;

  if (loading) return (
    <PageLoader />
  );

  const tabs = [
    // #1929: squad-fane-tælleren matcher senior-tabellens indhold — akademiryttere
    // er splittet ud i egen sektion, så de tælles ikke i "Squad (N)".
    { key: "squad", label: t("tabs.squad", { count: currentRiders.filter(r => !r.is_academy).length }) },
    { key: "stats", label: t("tabs.stats") },
    { key: "transfers", label: t("tabs.transfers") },
  ];

  return (
    // #2849 bølge 1: T2 wide-data-container (docs/design/PAGE_TEMPLATES.md) —
    // afløser #1186's ad hoc max-w-full; trup-tabellens 15 evne-kolonner har
    // stadig brug for bredden, nu inden for den kanoniske 1600px-cap.
    <div className="max-w-[1600px] mx-auto">
      <PageHeader
        // #3188: holdnavnet var ren tekst (h1, ingen hover/cursor-affordance) og
        // alligevel appens højeste dead-click-mål (Clarity: "Team Hansen Pro
        // CyclingMa..." 2052 dead clicks 27/7-3/8). Der er allerede en offentlig
        // holdprofil på /teams/:id med tre faner (Resultater/Palmarès/Klub) der
        // IKKE findes her på /team — så et rigtigt link er billigt og nyttigt,
        // ikke bare en affordance at fjerne. Samme <TeamLink>-mønster som
        // RiderProfileHero (#3068/#2227).
        title={team?.id
          ? <TeamLink id={team.id} className="hover:text-cz-accent-t transition-colors">{team.name || t("page.fallbackTitle")}</TeamLink>
          : (team?.name || t("page.fallbackTitle"))}
        subtitle={team?.manager_name ? t("page.managerLabel", { name: team.manager_name }) : undefined}
      />
      {/* Stats-linje (balance/division/cap/løn/værdi) er ikke del af PageHeader-
          recipen (kun titel/subtitle/actions) — forbliver som eget meta-afsnit. */}
      <div className="-mt-4 mb-5 flex gap-4 flex-wrap text-sm">
        <span className="text-cz-accent-t font-mono font-bold" title={t("page.balanceTooltip")}>{t("page.balance", { value: formatNumber(team?.balance ?? 0) })}</span>
        <span className="text-cz-3" title={t("page.divisionTooltip")}>{t("page.division", { n: team?.division })}</span>
        <span className={`text-cz-3${seniorCount > squadCap ? " text-cz-danger" : ""}`} title={t("page.seniorCapTooltip", { cap: squadCap })}>{t("page.ridersCount", { count: seniorCount, cap: squadCap })}</span>
        {academyCount > 0 && <span className="text-cz-3 text-xs" title={t("page.academyCapTooltip", { cap: squadCap })}>{t("page.academyCount", { count: academyCount })}</span>}
        {incomingCount > 0 && <span className="text-cz-success text-xs">{t("page.incomingCount", { count: incomingCount })}</span>}
        {outgoingCount > 0 && <span className="text-cz-danger text-xs">{t("page.outgoingCount", { count: outgoingCount })}</span>}
        <span className="text-cz-3" title={t("page.salaryPerSeasonTooltip")}>{t("page.salaryPerSeason", { value: formatNumber(totalSalary) })}</span>
        <span className="text-cz-3">{t("page.teamValue", { value: formatNumber(totalValue) })}</span>
      </div>

      {/* #2183: tydelig indikator når egne ryttere er under aktiv auktion — manageren
          skal ikke selv skulle opdage det ved at gå til /auctions. */}
      {Object.keys(ownAuctions).length > 0 && (
        <Link
          to="/auctions?tab=my-situation"
          className="mb-5 flex items-center justify-between gap-3 rounded-cz border border-cz-accent/30 bg-cz-accent/10 px-4 py-3 text-sm text-cz-accent-t hover:bg-cz-accent/15 transition-colors"
        >
          <span className="font-medium">{t("page.ownAuctionsBanner", { count: Object.keys(ownAuctions).length })}</span>
          <span aria-hidden="true">→</span>
        </Link>
      )}

      <div className="flex gap-2 mb-5">
        {tabs.map(tab => {
          const active = activeTab === tab.key;
          // #3188: den aktive fane var en <button> med samme klik-handler og
          // pointer-cursor som de andre — så et gentaget klik på "Trup (N)"
          // (default-fanen) SÅ klikbart ud men var garanteret en no-op (samme
          // state, ingen re-render). Det var appens højeste dead-click-kilde
          // (Clarity 27/7-3/8: 1.530 dead clicks). Aktiv fane mister nu
          // klik-handler + pointer-cursor; øvrige faner uændret.
          return (
            <button key={tab.key} type="button"
              onClick={active ? undefined : () => setActiveTab(tab.key)}
              aria-pressed={active}
              className={`px-3 py-1.5 rounded-cz text-sm font-medium transition-all border
                ${active ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30 cursor-default" : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "squad" && (
        <SquadTab riders={riders} scouting={scouting} onSelectRider={setSelectedRider} ownAuctions={ownAuctions} seasonYear={seasonYear} activeSeasonNumber={activeSeasonNumber} />
      )}
      {activeTab === "stats" && (
        <TeamStatsTab riders={currentRiders} />
      )}
      {activeTab === "transfers" && team?.id && (
        <TeamTransferHistoryTab teamId={team.id} />
      )}

      {selectedRider && (
        <RiderActionModal rider={selectedRider} team={team} scouting={scouting} onClose={() => setSelectedRider(null)} onAction={loadAll} onDemote={handleDemote} ddActive={ddActive} seasonYear={seasonYear} />
      )}

      {/* #932 S7: Demote-bekræftelse (senior → akademi) — løn-delta + akademi-cap +
          fremtidige løb der ryddes. Genbruger den delte AcademyTransferConfirmModal.
          #2796: division SKAL med til projectYouthSalary — uden den bruges den
          globale sats i stedet for holdets, så den viste ungdomsløn er forkert. */}
      <AcademyTransferConfirmModal
        show={!!demoteConfirm}
        direction="demote"
        riderName={demoteConfirm ? `${demoteConfirm.rider.firstname} ${demoteConfirm.rider.lastname}`.trim() : ""}
        newSalary={demoteConfirm ? projectYouthSalary(demoteConfirm.rider, { division: team?.division }) : 0}
        currentSalary={demoteConfirm?.rider?.salary ?? 0}
        capLabel={demoteConfirm?.academyCount != null ? `${demoteConfirm.academyCount} / 8` : null}
        capAfterLabel={demoteConfirm?.academyCount != null ? `${demoteConfirm.academyCount + 1} / 8` : null}
        racesCleared={demoteConfirm?.racesCleared ?? 0}
        busy={demoteBusy}
        onCancel={() => { if (!demoteBusy) { setDemoteConfirm(null); setDemoteError(null); } }}
        onConfirm={confirmDemote}
      />
      {demoteError && (
        <p className="fixed bottom-4 left-1/2 -translate-x-1/2 z-toast bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-cz px-4 py-2 text-sm shadow-overlay">
          {demoteError}
        </p>
      )}
    </div>
  );
}

export default TeamPage;
