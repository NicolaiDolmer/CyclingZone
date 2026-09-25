// Konsekvens-bevidst bekræftelse for trup op/ned (#932 S7, #5742). Én dialog
// dækker begge retninger via direction='promote'|'demote':
//   • promote (op): ungdomstrup → senior. Viser cap-effekt (senior-trup nu →
//     efter) + ny senior-løn. Accent = guld (cz-accent).
//   • demote (ned): senior → U23/junior. Viser lønnen efter flytningen
//     + mål-truppens cap-effekt + antal fremtidige løb der ryddes. Accent =
//     amber (cz-warning). #4582: har rytteren en komplet kontrakt, ARVES den
//     (løn + term) uændret ned i ungdomstruppen — dialogen siger det med rene
//     ord og dropper delta-rækken i stedet for at vise "ungdomsløn" over to
//     ens tal.
// #5742 (Discord 24/9): dialogen hed "Move to academy" uanset mål-trup, selvom
// akademiet er erstattet af U23-/juniortrupper (#5626). Titel/spørgsmål/
// bekræft-knap navngiver nu den FAKTISKE mål-trup (capSquad, evt. valgt via
// squadOptions). Er rytteren junior-alder, må han også vælge U23 (opad altid
// tilladt, YOUTH_RULES.md §2, LÅST 2/9) — squadOptions viser da begge, junior
// forudvalgt.
// Spejler AcademySignConfirmModal: overlay + cz-card-panel + useModalA11y +
// editorial dl-tabel. INGEN slop (ingen glow/gradient/emoji-ikon).
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { useModalA11y } from "../hooks/useModalA11y.js";

export function AcademyTransferConfirmModal({
  show,
  direction,            // 'promote' | 'demote'
  riderName,
  newSalary,            // promote: frossen senior-løn; demote: ungdomsløn. null = stadig indlæses.
  currentSalary = null, // vises som delta (demote)
  capLabel = null,      // "12 / 30" → "13 / 30" (promote: senior-cap; demote: mål-truppens loft, fx 5 / 12)
  capAfterLabel = null,
  // #5568: demote — den ungdomstrup rytteren rykker ned i ("u23" | "junior"),
  // som den kom tilbage fra backendens quote. capLabel/capAfterLabel hører til
  // NETOP denne trup — vælger manageren et andet mål via squadOptions (se
  // nedenfor), skjules cap-rækken (#5742: vi har ingen frisk optælling for
  // det utviste valg, og en forkert "5 / 12" er værre end ingen række).
  capSquad = null,
  // #5742: begge mulige mål-trupper for en junior-alder rytter (opad tilladt),
  // [{squad,isDefault}], fra squadTarget.ts's demoteSquadOptions(). Under 2
  // elementer (U23-alder, eller promote) → ingen vælger vises, capSquad står alene.
  squadOptions = [],
  onSquadChange, // (squad) => void — kaldes når manageren skifter mål-trup i vælgeren.
  // #5742: er DEN VALGTE mål-trup fuld (fra en fersk optælling kalderen selv
  // kender, fx useAcademy()'s squads)? Blokerer bekræft + viser grunden i
  // stedet for et dødt klik der først fejler i backend-svaret.
  capFull = false,
  capFullMax = null,
  racesCleared = null,  // demote: antal KOMMENDE løb der ryddes (entries slettes; kan være 0/null)
  racesOngoing = null,  // #3805: demote: antal IGANGVÆRENDE løb rytteren falder ud af (entry
                         // bevares, men rytteren er ikke længere løbsberettiget — kan være 0/null)
  // Rytteren har allerede en komplet kontrakt, så flytningen arver den UÆNDRET
  // i stedet for at skrive en ny. Gælder BEGGE retninger: promote siden #3620,
  // demote siden #4589/#4582 (én regel begge veje, ejer-beslutning 4/9).
  // Promote udleder flaget frontend-side (keepsExistingContractOnPromote);
  // demote får det fra academy-demote-quote-routens `keepsContract`, samme
  // prædikat backend selv grener på (#4582).
  keepsContract = false,
  onCancel,
  onConfirm,
  busy = false,
}) {
  const { t } = useTranslation(["academy", "common"]);
  const dialogRef = useModalA11y(busy ? null : onCancel, show);

  // #5742: vælgeren er kun relevant for demote med et reelt valg (junior-alder
  // rytter, opad tilladt til U23). Selektionen nulstilles til quotens egen
  // default kun når dialogen ÅBNER (show går false → true), så et gammelt
  // valg fra forrige rytter aldrig overlever ind i en ny åbning. Kaldersiden
  // (fx RiderManageActions' onSquadChange → setAcademyModal) opdaterer sit
  // eget academyModal-object ved hvert skift, som laver et NYT squadOptions-
  // array hver render — stod det arrayet i dependency-listen, ville selve
  // klikket der skifter trup udløse en re-render der straks nulstillede
  // valget tilbage til default (CodeRabbit-fund).
  const [selectedSquad, setSelectedSquad] = useState(capSquad);
  const wasShown = useRef(false);
  useEffect(() => {
    if (show && !wasShown.current) {
      const fallback = squadOptions.find(o => o.isDefault)?.squad ?? capSquad;
      setSelectedSquad(fallback ?? null);
    }
    wasShown.current = show;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se kommentaren ovenfor: kun `show`s flanke skal trigge
  }, [show]);

  if (!show) return null;

  const isPromote = direction === "promote";
  const effectiveSquad = isPromote ? null : (selectedSquad ?? capSquad);
  const squadLabel = effectiveSquad ? t(`academy:transferModal.squadName.${effectiveSquad}`) : "";
  function selectSquad(squad) {
    setSelectedSquad(squad);
    onSquadChange?.(squad);
  }
  // Statiske klasser (Tailwind kan ikke se interpolerede klassenavne). Promote =
  // guld (cz-accent), demote = amber (cz-warning).
  const accentText = isPromote ? "text-cz-accent-t" : "text-cz-warning";
  const titleKey = isPromote ? "transferModal.promoteTitle" : "transferModal.demoteTitle";
  const questionKey = isPromote ? "transferModal.promoteQuestion" : "transferModal.demoteQuestion";
  const confirmKey = isPromote ? "transferModal.promoteConfirm" : "transferModal.demoteConfirm";
  // #5742: cap-rækken hører til DEN trup quoten faktisk hentede tal for
  // (capSquad) — vælger manageren det andet muligt mål (selectedSquad !==
  // capSquad), er tallene ikke friske for det, så rækken skjules i stedet for
  // at vise en forkert optælling.
  const showCapRow = !isPromote ? selectedSquad === capSquad : true;
  // #5742: mål-truppen er fuld — bekræft-knappen spærres OG forklaringen står
  // under den, samme mønster som AcademyPage's intake-kort (isFull/fullTooltip).
  const blockedByFullSquad = !isPromote && capFull && selectedSquad === capSquad;

  // #3784: newSalary er null mens quoten (backend academy-demote-quote) stadig
  // hentes — vis "..." i stedet for et forkert 0/NaN-tal, og lås bekræft-knappen
  // så spilleren ikke kan bekræfte på et tal der endnu ikke er beregnet.
  const salaryLoading = newSalary == null;
  const newSalaryNum = Number(newSalary);
  const curSalaryNum = currentSalary != null ? Number(currentSalary) : null;
  // #4582: arver demote kontrakten, ER de to tal det samme tal — en "nuværende
  // løn"-række under en identisk "ny løn"-række lover en ændring der ikke sker
  // og inviterer spilleren til at lede efter forskellen. Så: én række, og
  // etiketten siger selv at lønnen er uændret.
  const keepsContractOnDemote = !isPromote && keepsContract;
  const hasSalaryDelta = curSalaryNum != null && Number.isFinite(newSalaryNum) && !keepsContractOnDemote;
  const racesNum = Number(racesCleared);
  const showRaces = !isPromote && Number.isFinite(racesNum) && racesNum > 0;
  const ongoingNum = Number(racesOngoing);
  const showOngoing = !isPromote && Number.isFinite(ongoingNum) && ongoingNum > 0;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center" onClick={busy ? undefined : onCancel}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative z-10 bg-cz-card border border-cz-border rounded-cz p-6 text-center max-w-sm w-full mx-4 shadow-2xl"
        style={{ animation: "academyTransferScaleIn 0.2s ease-out" }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="academy-transfer-title"
      >
        <h2 id="academy-transfer-title" className={`font-bold text-lg mb-2 ${accentText}`}>
          {isPromote ? t(`academy:${titleKey}`) : t(`academy:${titleKey}`, { squad: squadLabel })}
        </h2>
        <p className="text-cz-2 text-sm mb-4">
          {isPromote ? t(`academy:${questionKey}`) : t(`academy:${questionKey}`, { squad: squadLabel })}{" "}
          {riderName ? <span className="font-bold text-cz-1">{riderName}</span> : null}?
        </p>

        {/* #5742: junior-alder rytter må vælge op til U23 (opad tilladt,
            YOUTH_RULES.md §2) — kun vist når der reelt er et valg. */}
        {!isPromote && squadOptions.length > 1 && (
          <div className="flex rounded-lg border border-cz-border overflow-hidden mb-4" role="radiogroup"
            aria-label={t("academy:transferModal.demoteSquadPickerLabel")}>
            {squadOptions.map(({ squad }) => (
              <button
                key={squad}
                type="button"
                role="radio"
                aria-checked={selectedSquad === squad}
                disabled={busy}
                onClick={() => selectSquad(squad)}
                className={`flex-1 px-3 py-2 text-sm font-bold transition-colors disabled:opacity-50
                  ${selectedSquad === squad ? "bg-cz-warning text-cz-on-accent" : "bg-cz-subtle text-cz-2 hover:text-cz-1"}`}
              >
                {t(`academy:transferModal.squadName.${squad}`)}
              </button>
            ))}
          </div>
        )}

        <dl className="text-sm border border-cz-border rounded-lg divide-y divide-cz-border mb-5 text-left">
          {/* Ny løn (begge retninger). Demote viser delta fra nuværende. */}
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-cz-3">
              {isPromote
                ? t("academy:transferModal.seniorSalaryLabel")
                : keepsContractOnDemote
                  ? t("academy:transferModal.unchangedSalaryLabel")
                  : t("academy:transferModal.youthSalaryLabel")}
            </dt>
            <dd className="font-mono font-bold text-cz-1">
              {salaryLoading ? "..." : `${formatNumber(newSalaryNum)} CZ$`}
            </dd>
          </div>
          {hasSalaryDelta && (
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-cz-3">{t("academy:transferModal.currentSalaryLabel")}</dt>
              <dd className="font-mono text-cz-2">{formatNumber(curSalaryNum)} CZ$</dd>
            </div>
          )}
          {/* Cap-effekt (nu → efter). #5742: kun for den trup quoten faktisk
              hentede tal for (showCapRow) — et andet valgt mål viser ingen
              række i stedet for en stale optælling. */}
          {showCapRow && capLabel != null && capAfterLabel != null && (
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-cz-3">
                {isPromote
                  ? t("academy:transferModal.seniorCapLabel")
                  : capSquad === "u23"
                    ? t("academy:transferModal.u23CapLabel")
                    : t("academy:transferModal.juniorCapLabel")}
              </dt>
              <dd className="font-mono text-cz-2">
                {capLabel} <span className="text-cz-3" aria-hidden="true">&rarr;</span>{" "}
                <span className={`font-bold ${accentText}`}>{capAfterLabel}</span>
              </dd>
            </div>
          )}
          {/* Demote: kommende løb der ryddes (entries slettet). */}
          {showRaces && (
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-cz-3">{t("academy:transferModal.racesClearedLabel")}</dt>
              <dd className="font-mono font-bold text-cz-warning">{formatNumber(racesNum)}</dd>
            </div>
          )}
          {/* #3805: demote — igangværende løb rytteren falder ud af. Entry'en
              slettes IKKE (resultat-/snapshot-invarians), men rytteren er ikke
              længere løbsberettiget som akademi-rytter, så han udgår reelt af
              feltet. Dialogen skal sige det i stedet for kun at nævne
              "kommende løb ryddet" (som er 0 for netop denne sag — #3805). */}
          {showOngoing && (
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-cz-3">{t("academy:transferModal.racesOngoingLabel")}</dt>
              <dd className="font-mono font-bold text-cz-danger">{formatNumber(ongoingNum)}</dd>
            </div>
          )}
        </dl>

        {/* Konsekvens-note pr. retning. Promote har to sandheder efter #3620:
            har rytteren allerede en kontrakt, regenereres den IKKE, så lønnen
            bliver hverken erstattet eller genberegnet. #3805: demote har to
            sandheder på løbs-aksen — er rytteren midt i et løb, må teksten sige
            at han udgår af DET løb (ikke kun "kommende løb"), ellers
            underrapporterer den præcis som den bug der blev rapporteret.
            #4582: demote har nu ogsaa to sandheder på KONTRAKT-aksen. Den var
            selve bugget: 3 spillere så lønnen stige 17k → 22k ved en flytning
            ned i akademiet (1/9), og dialogen sagde intet om kontrakten
            overhovedet. Backend arver nu kontrakten (#4589), men en rettelse
            spilleren ikke kan SE i det øjeblik han bekræfter, er ikke en
            rettelse af den tvivl han meldte. De to akser er uafhængige, så
            teksten vælges af dem begge (4 kombinationer, 4 nøgler) — en note
            der taber den ene for at nævne den anden ville underrapportere
            igen. */}
        <p className="text-cz-3 text-xs mb-4">
          {!isPromote
            ? keepsContractOnDemote
              ? (showOngoing
                  ? t("academy:transferModal.demoteNoteKeepsContractOngoing")
                  : t("academy:transferModal.demoteNoteKeepsContract"))
              : (showOngoing
                  ? t("academy:transferModal.demoteNoteOngoing")
                  : t("academy:transferModal.demoteNote"))
            : keepsContract
              ? t("academy:transferModal.promoteNoteKeepsContract")
              : t("academy:transferModal.promoteNote")}
        </p>

        {/* #5742: mål-truppen er fuld — grunden vises i klar tekst i stedet for
            at lade bekræft-knappen stå som et dødt klik der først fejler i
            backend-svaret (samme princip som AcademyPage's intake-kort). */}
        {blockedByFullSquad && (
          <p className="text-cz-warning text-xs mb-4">
            {t("academy:transferModal.capFullNote", { squad: squadLabel, max: capFullMax })}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold
              bg-cz-subtle text-cz-2 border border-cz-border hover:text-cz-1 transition-colors disabled:opacity-50"
          >
            {t("common:actions.cancel")}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(effectiveSquad)}
            disabled={busy || salaryLoading || blockedByFullSquad}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold text-cz-on-accent transition-all
              disabled:opacity-60 disabled:cursor-not-allowed
              ${isPromote ? "bg-cz-accent hover:brightness-110" : "bg-cz-warning hover:brightness-110"}`}
          >
            {busy || salaryLoading
              ? t("common:actions.loadingShort")
              : isPromote
                ? t(`academy:${confirmKey}`)
                : t(`academy:${confirmKey}`, { squad: squadLabel })}
          </button>
        </div>
        <style>{`
          @keyframes academyTransferScaleIn {
            from { transform: scale(0.9); opacity: 0; }
            to   { transform: scale(1);   opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
}
