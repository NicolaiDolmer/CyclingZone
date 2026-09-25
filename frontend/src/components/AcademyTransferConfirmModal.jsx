// Konsekvens-bevidst bekræftelse når en rytter skifter trup (#932 S7, #5742,
// #5748). Én dialog, tre retninger (direction):
//   • promote (op til senior): senior-løn + senior-pladser nu -> efter.
//     Accent = guld (cz-accent).
//   • demote (senior -> U23/junior): lønnen efter flytningen + mål-truppens
//     pladser + antal fremtidige løb der ryddes. Accent = amber (cz-warning).
//     #4582: har rytteren en komplet kontrakt, ARVES den (løn + term) uændret,
//     og dialogen siger det med rene ord i stedet for at vise "ungdomsløn" over
//     to ens tal.
//   • move (#5748, junior <-> U23): kun truppen skifter; løn og kontrakt er de
//     samme. Accent = amber.
//
// #5748 (ejer-go A 25/9, før/efter-billede "Move a rider between squads"):
// med `squadRows` viser dialogen ALTID alle tre trupper som radio-rækker
// (senior, U23, junior) med pladser nu / loft. Nuværende trup er markeret og
// kan ikke vælges; en trup rytteren er for gammel til, eller som er fuld, står
// i gråt med grunden. Rækkerne og forvalget kommer fra squadTarget.ts (ÉN
// udgave af reglen); konsekvens-tabellen følger det VALGTE mål, som kalderen
// (MoveSquadDialog.tsx) henter tal for. Bekræft-knappen navngiver målet.
// Uden `squadRows` (AcademyPage's promote-knap) er dialogen den gamle
// en-retnings-bekræftelse.
//
// Mønster: overlay + cz-card-panel (modalStyles.panelClass) + useModalA11y +
// editorial dl-tabel, hairline-borders, 5px radius (rounded-cz). INGEN slop
// (ingen glow/gradient/emoji-ikon), docs/design/TASTE.md.
import { useTranslation, Trans } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { useModalA11y } from "../hooks/useModalA11y.js";
import { panelClass, backdropClass } from "./ui/modalStyles.js";

function placesText(used, max) {
  const fmt = (n) => (typeof n === "number" && Number.isFinite(n) ? formatNumber(n) : "-");
  return `${fmt(used)} / ${fmt(max)}`;
}

export function AcademyTransferConfirmModal({
  show,
  direction,            // 'promote' | 'demote' | 'move'
  riderName,
  newSalary,            // promote: senior-løn; demote: løn efter flytningen; move: uændret løn. null = indlæses.
  currentSalary = null, // vises som delta (demote)
  capLabel = null,      // "12 / 30" -> "13 / 30" (mål-truppens pladser nu og efter)
  capAfterLabel = null,
  // Hvilken trup capLabel/capAfterLabel tæller ('senior' | 'u23' | 'junior').
  // Uden den antages senior ved promote (AcademyPage).
  capSquad = null,
  racesCleared = null,  // demote: antal KOMMENDE løb der ryddes (entries slettes; kan være 0/null)
  racesOngoing = null,  // #3805: demote: antal IGANGVÆRENDE løb rytteren falder ud af (entry
                         // bevares, men rytteren er ikke længere løbsberettiget, kan være 0/null)
  // Rytteren har allerede en komplet kontrakt, så flytningen arver den UÆNDRET
  // i stedet for at skrive en ny. Gælder BEGGE retninger: promote siden #3620,
  // demote siden #4589/#4582 (én regel begge veje, ejer-beslutning 4/9).
  // Promote udleder flaget frontend-side (keepsExistingContractOnPromote);
  // demote får det fra academy-demote-quote-routens `keepsContract`, samme
  // prædikat backend selv grener på (#4582).
  keepsContract = false,
  // ── #5748: trup-vælgeren ────────────────────────────────────────────────
  squadRows = null,     // MoveSquadRow[] fra squadTarget.moveSquadRows, eller null (ingen vælger)
  selectedSquad = null, // det valgte mål ('senior' | 'u23' | 'junior'), null = intet åbent mål
  onSelectSquad,        // (squad) => void
  currentSquad = null,  // rytterens nuværende trup (til undertitlen)
  seasonAge = null,     // til undertitlen og "Natural squad at age N"
  loading = false,      // pladser/nuværende trup hentes stadig
  error = null,         // backendens afvisning, vist i dialogen (den forbliver åben)
  onCancel,
  onConfirm,
  busy = false,
}) {
  const { t } = useTranslation(["academy", "common"]);
  const dialogRef = useModalA11y(busy ? null : onCancel, show);

  if (!show) return null;

  const hasPicker = Array.isArray(squadRows);
  const isPromote = direction === "promote";
  const isMove = direction === "move";
  const isDemote = direction === "demote";
  // Guld kun på vej op i senior; ned og på tværs af ungdomstrupperne er amber.
  const toSenior = hasPicker ? selectedSquad === "senior" : isPromote;
  // Statiske klasser (Tailwind kan ikke se interpolerede klassenavne).
  const accentText = toSenior ? "text-cz-accent-t" : "text-cz-warning";

  // #3784: newSalary er null mens quoten (backend academy-demote-quote) stadig
  // hentes: vis "..." i stedet for et forkert 0/NaN-tal, og lås bekræft-knappen
  // så spilleren ikke kan bekræfte på et tal der endnu ikke er beregnet. En
  // junior <-> U23-flytning rører ikke lønnen, så en kontraktløs ungdomsrytter
  // (løn null) må ikke låse knappen for evigt.
  const salaryLoading = newSalary == null && !isMove;
  const newSalaryNum = Number(newSalary);
  const curSalaryNum = currentSalary != null ? Number(currentSalary) : null;
  // #4582: arver demote kontrakten, ER de to tal det samme tal. Så: én række,
  // og etiketten siger selv at lønnen er uændret.
  const keepsContractOnDemote = isDemote && keepsContract;
  const hasSalaryDelta = isDemote && curSalaryNum != null && Number.isFinite(newSalaryNum) && !keepsContractOnDemote;
  const racesNum = Number(racesCleared);
  const showRaces = isDemote && Number.isFinite(racesNum) && racesNum > 0;
  const ongoingNum = Number(racesOngoing);
  const showOngoing = isDemote && Number.isFinite(ongoingNum) && ongoingNum > 0;
  const capKind = capSquad ?? (isPromote ? "senior" : null);
  const capLabelKey = capKind === "senior" ? "seniorCapLabel" : capKind === "u23" ? "u23CapLabel" : "juniorCapLabel";

  const confirmBlocked = busy || loading || salaryLoading || (hasPicker && !selectedSquad);

  function rowHint(row) {
    const rowName = t(`academy:moveSquad.rowName.${row.squad}`);
    switch (row.hint) {
      case "current": return t("academy:moveSquad.hint.current");
      case "tooOld":
        return t("academy:moveSquad.hint.tooOld", { squad: t(`academy:moveSquad.shortName.${row.squad}`), max: row.maxAge });
      case "full": return t("academy:moveSquad.hint.full", { squad: rowName, max: row.max ?? "-" });
      case "seniorPlace": return t("academy:moveSquad.hint.seniorPlace");
      case "natural":
        return seasonAge != null
          ? t("academy:moveSquad.hint.natural", { age: seasonAge })
          : t("academy:moveSquad.hint.naturalNoAge");
      default: return t("academy:moveSquad.hint.upward");
    }
  }

  // Uden vælger er dialogen AcademyPage's promote-bekræftelse (eneste kalder).
  const title = hasPicker
    ? t("academy:moveSquad.title", { name: riderName || t("academy:moveSquad.fallbackRider") })
    : t("academy:transferModal.promoteTitle");

  const confirmLabel = busy || salaryLoading || loading
    ? t("common:actions.loadingShort")
    : hasPicker
      ? (selectedSquad ? t(`academy:moveSquad.confirm.${selectedSquad}`) : t("academy:moveSquad.confirmNone"))
      : t("academy:transferModal.promoteConfirm");

  // Konsekvens-note pr. retning. Promote har to sandheder efter #3620:
  // har rytteren allerede en kontrakt, regenereres den IKKE. #3805: demote har
  // to sandheder på løbs-aksen (igangværende løb nævnes eksplicit), og #4582
  // to på KONTRAKT-aksen; de er uafhængige, så noten vælges af begge (4 nøgler).
  let note;
  if (isMove) {
    note = t("academy:moveSquad.moveNote");
  } else if (isDemote) {
    note = keepsContractOnDemote
      ? (showOngoing
          ? t("academy:transferModal.demoteNoteKeepsContractOngoing")
          : t("academy:transferModal.demoteNoteKeepsContract"))
      : (showOngoing
          ? t("academy:transferModal.demoteNoteOngoing")
          : t("academy:transferModal.demoteNote"));
  } else {
    note = keepsContract
      ? t("academy:transferModal.promoteNoteKeepsContract")
      : t("academy:transferModal.promoteNote");
  }

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4" onClick={busy ? undefined : onCancel}>
      <div className={backdropClass()} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`relative z-10 ${panelClass({ size: "sm" })} p-5 sm:p-6 text-center`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="academy-transfer-title"
        data-testid="move-squad-dialog"
      >
        <h2 id="academy-transfer-title" className={`font-bold text-lg mb-2 ${accentText}`}>{title}</h2>

        {hasPicker ? (
          <p className="text-cz-2 text-sm mb-4">
            {currentSquad ? (
              <Trans
                i18nKey={seasonAge != null ? "moveSquad.nowOnWithAge" : "moveSquad.nowOn"}
                ns="academy"
                values={{ squad: t(`academy:moveSquad.rowName.${currentSquad}`), age: seasonAge ?? "" }}
                components={{ strong: <span className="font-bold text-cz-1" /> }}
              />
            ) : null}{" "}
            {t("academy:moveSquad.pick")}
          </p>
        ) : (
          <p className="text-cz-2 text-sm mb-4">
            {t("academy:transferModal.promoteQuestion")}{" "}
            {riderName ? <span className="font-bold text-cz-1">{riderName}</span> : null}?
          </p>
        )}

        {/* #5748: alle tre trupper, altid. Native radio-input giver pil-taster og
            skærmlæser-semantik gratis; en spærret række er disabled OG siger
            hvorfor i underteksten (ingen skjulte regler, ingen døde klik). */}
        {hasPicker && (
          <fieldset className="mb-4 text-left" disabled={busy} aria-busy={loading || undefined}>
            <legend className="sr-only">{t("academy:moveSquad.pickerLabel")}</legend>
            <div className="flex flex-col gap-1.5">
              {squadRows.map((row) => {
                const selectable = row.state === "open";
                const checked = selectedSquad === row.squad;
                const blocked = row.state === "tooOld" || row.state === "full";
                const ringClass = checked
                  ? (row.squad === "senior" ? "border-cz-accent" : "border-cz-warning")
                  : "border-cz-border";
                return (
                  <label
                    key={row.squad}
                    data-testid={`move-squad-row-${row.squad}`}
                    data-state={row.state}
                    className={`flex items-center gap-3 rounded-cz border bg-cz-subtle px-3 py-2.5 transition-colors ${ringClass}
                      ${selectable ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
                  >
                    <input
                      type="radio"
                      name="move-squad-target"
                      value={row.squad}
                      checked={checked}
                      disabled={!selectable || loading}
                      onChange={() => onSelectSquad?.(row.squad)}
                      className={`h-4 w-4 shrink-0 ${row.squad === "senior" ? "accent-cz-accent" : "accent-cz-warning"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-cz-1">{t(`academy:moveSquad.rowName.${row.squad}`)}</span>
                      <span className={`block text-xs ${blocked ? "text-cz-danger" : "text-cz-3"}`}>{rowHint(row)}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-cz-2">
                      {loading ? "..." : placesText(row.used, row.max)}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {(!hasPicker || selectedSquad) && (
          <dl className="text-sm border border-cz-border rounded-cz divide-y divide-cz-border mb-4 text-left">
            {/* Løn: senior-løn (promote), løn efter flytningen (demote, med
                delta fra nuværende), eller uændret løn (move). */}
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-cz-3">
                {isPromote
                  ? t("academy:transferModal.seniorSalaryLabel")
                  : keepsContractOnDemote || isMove
                    ? t("academy:transferModal.unchangedSalaryLabel")
                    : t("academy:transferModal.youthSalaryLabel")}
              </dt>
              <dd className="font-mono font-bold tabular-nums text-cz-1">
                {salaryLoading
                  ? "..."
                  : Number.isFinite(newSalaryNum) && newSalary != null ? `${formatNumber(newSalaryNum)} CZ$` : "-"}
              </dd>
            </div>
            {hasSalaryDelta && (
              <div className="flex items-center justify-between px-3 py-2">
                <dt className="text-cz-3">{t("academy:transferModal.currentSalaryLabel")}</dt>
                <dd className="font-mono tabular-nums text-cz-2">{formatNumber(curSalaryNum)} CZ$</dd>
              </div>
            )}
            {/* Mål-truppens pladser (nu -> efter). */}
            {capLabel != null && capAfterLabel != null && capKind && (
              <div className="flex items-center justify-between px-3 py-2">
                <dt className="text-cz-3">{t(`academy:transferModal.${capLabelKey}`)}</dt>
                <dd className="font-mono tabular-nums text-cz-2">
                  {capLabel} <span className="text-cz-3" aria-hidden="true">&rarr;</span>{" "}
                  <span className={`font-bold ${accentText}`}>{capAfterLabel}</span>
                </dd>
              </div>
            )}
            {/* Demote: kommende løb der ryddes (entries slettet). */}
            {showRaces && (
              <div className="flex items-center justify-between px-3 py-2">
                <dt className="text-cz-3">{t("academy:transferModal.racesClearedLabel")}</dt>
                <dd className="font-mono font-bold tabular-nums text-cz-warning">{formatNumber(racesNum)}</dd>
              </div>
            )}
            {/* #3805: demote: igangværende løb rytteren falder ud af. Entry'en
                slettes IKKE (resultat-/snapshot-invarians), men rytteren er ikke
                længere løbsberettiget som ungdomsrytter. */}
            {showOngoing && (
              <div className="flex items-center justify-between px-3 py-2">
                <dt className="text-cz-3">{t("academy:transferModal.racesOngoingLabel")}</dt>
                <dd className="font-mono font-bold tabular-nums text-cz-danger">{formatNumber(ongoingNum)}</dd>
              </div>
            )}
          </dl>
        )}

        {(!hasPicker || selectedSquad) && (
          <p className="text-cz-3 text-xs mb-4 text-left">{note}</p>
        )}

        {/* #5748: backend afviste flytningen (fx en trup blev fuld imens).
            Dialogen bliver stående, så manageren kan vælge et andet mål. */}
        {error && (
          <p role="alert" className="text-cz-danger text-xs mb-4 text-left">{error}</p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 min-h-[44px] px-4 py-2.5 rounded-cz text-sm font-bold
              bg-cz-subtle text-cz-2 border border-cz-border hover:text-cz-1 transition-colors disabled:opacity-50"
          >
            {t("common:actions.cancel")}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(selectedSquad)}
            disabled={confirmBlocked}
            data-testid="move-squad-confirm"
            className={`flex-1 min-h-[44px] px-4 py-2.5 rounded-cz text-sm font-bold text-cz-on-accent transition-all
              disabled:opacity-60 disabled:cursor-not-allowed
              ${toSenior ? "bg-cz-accent hover:brightness-110" : "bg-cz-warning hover:brightness-110"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
