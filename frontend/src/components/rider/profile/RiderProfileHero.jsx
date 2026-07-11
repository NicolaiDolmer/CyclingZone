// RiderProfileHero — editorial hero for den redesignede rytterprofil (#2000).
//
// Ren præsentations-komponent: al data + afledte flags kommer som props fra
// RiderStatsPage (data-laget genbruges 1:1). To viewer-kontekster:
//   • own      — fuld styring (rating farvet, potentiale-loft, markedsværdi+løn)
//   • scouting — rival/AI-rytter; potentiale er fuzzy (ScoutablePotentiale
//                håndterer maskering server-side), form/træthed vises IKKE her.
//
// Token-only: ENESTE rå hex er division-chippen (blå rgb(96 165 250), spec-
// undtagelse) + foto-fallbacken. Rating-farve via statColor (SSOT). Potentiale
// ALTID via ScoutablePotentiale → stjerner, aldrig et råt tal. Bebas til navn/
// eyebrows (font-display), Inter Tight tabular til tal (font-mono). Dark mode
// flipper automatisk (alle farver er cz-tokens).

import { useTranslation } from "react-i18next";
import { Flag } from "../../Flag";
import TeamLink from "../../TeamLink";
import { statColor, statTextColor } from "../../../lib/statColor";
import RiderTypeBadge from "../RiderTypeBadge";
import ScoutablePotentiale from "../ScoutablePotentiale";
import { AlertTriangleIcon } from "../../ui";

// Division-chip — ENESTE rå-hex-undtagelse (spec): brand-uafhængig divisions-blå.
const DIVISION_CHIP = "rgb(96 165 250)";

// Rating-cirkel (1-99) farvet efter samme evne-gradient (statColor) som alt andet
// rating-tal. Tom (—) hvis rating ikke kan beregnes. Eyebrow "RATING /99" under.
function RatingCircle({ rating }) {
  const { t } = useTranslation("rider");
  const has = Number.isFinite(rating) && rating > 0;
  const bg = has ? statColor(rating) : "var(--bg-subtle)";
  const fg = has ? statTextColor(rating) : undefined;
  return (
    <div className="flex flex-col items-center gap-1 flex-shrink-0">
      <div
        data-testid="rider-overall-rating"
        className="flex items-center justify-center rounded-full w-16 h-16 font-mono font-bold text-[28px] leading-none tabular-nums ring-1 ring-cz-border/60"
        style={{ backgroundColor: bg, color: fg }}
      >
        {has ? rating : "—"}
      </div>
      <span className="text-cz-3 text-[10px] uppercase tracking-[0.14em] font-semibold">
        {t("profile.hero.ratingEyebrow")}
      </span>
    </div>
  );
}

// Foto-placeholder (~70×92 portræt): initialer (Bebas) + "FOTO". Rå tone-undtagelse
// tilladt for fallback-grafik; her holder vi os til cz-subtle/text-3 (tokens).
function PhotoPlaceholder({ firstname, lastname }) {
  const { t } = useTranslation("rider");
  const initials = `${firstname?.[0] ?? ""}${lastname?.[0] ?? ""}`.toUpperCase();
  return (
    <div className="flex-shrink-0 w-[70px] h-[92px] rounded-cz bg-cz-subtle border border-cz-border flex flex-col items-center justify-center gap-1 select-none">
      <span className="font-display text-2xl leading-none text-cz-3 tracking-wide">{initials}</span>
      <span className="text-cz-3 text-[9px] uppercase tracking-[0.16em] font-semibold">
        {t("profile.hero.photoFallback")}
      </span>
    </div>
  );
}

// Status-banner (betinget). `banner` = { kind, ...data } fra parent. Gold-tonet for
// markeds-tilstande, amber for kontrakt-udløb, neutral for akademi.
function StatusBanner({ banner }) {
  const { t } = useTranslation("rider");
  if (!banner) return null;

  const TONES = {
    listed:  "bg-cz-accent/10 border-cz-accent/30 text-cz-accent-t",
    auction: "bg-cz-accent/10 border-cz-accent/30 text-cz-accent-t",
    academy: "bg-cz-subtle border-cz-border text-cz-2",
    expiry:  "bg-cz-warning-bg border-cz-warning/30 text-cz-warning",
  };
  const tone = TONES[banner.kind] ?? TONES.academy;

  let text = null;
  if (banner.kind === "listed")  text = t("profile.banner.listed", { price: banner.price });
  if (banner.kind === "auction") text = t("profile.banner.auction", { endsIn: banner.endsIn, highBid: banner.highBid });
  if (banner.kind === "academy") text = t("profile.banner.academy");
  if (banner.kind === "expiry")  text = t("profile.banner.expiry", { season: banner.season });
  if (!text) return null;

  return (
    <div className={`mt-4 flex items-center gap-2 rounded-cz border px-3.5 py-2.5 text-sm ${tone}`}>
      {banner.kind === "expiry" && <AlertTriangleIcon size={16} aria-hidden="true" className="flex-shrink-0" />}
      <span>{text}</span>
    </div>
  );
}

export default function RiderProfileHero({
  rider,
  viewer = "own",                 // "own" | "scouting"
  overallRating,
  age,
  typeLabel,
  divisionLabel,                  // fx "DIV 2" (null hvis ukendt)
  valueAmount,                    // "4.366" (uden CZ$-suffix)
  valueLabel,                     // fuld label til title
  salaryText,                     // præ-formateret løn, fx "CZ$ 293/år"
  winsOnText,                     // "Flade massespurter" (1-2 terræn, kommasepareret)
  isAiTeam = false,
  pendingTeam = null,             // kommende hold (handel til næste sæson) | null
  banner = null,                  // { kind, ...data }
  scouting,
  onWatchlist = false,
  onToggleWatchlist,
  onCompare,                      // () => void — navigér til /compare?ids=... (parent styrer routing)
  actions = null,                 // action-række (ReactNode) — injiceres af parent
}) {
  const { t } = useTranslation("rider");

  const teamName = rider.team?.name ?? t("header.freeAgent");
  const potentialEyebrow = viewer === "scouting"
    ? t("profile.hero.potentialScouted")
    : t("profile.hero.potentialOwn");

  return (
    <section className="bg-cz-card border border-cz-border border-t-2 border-t-cz-accent rounded-cz overflow-hidden">
      <div className="p-5 sm:p-6">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_300px] gap-5 sm:gap-6">

          {/* ── VENSTRE: identitet ─────────────────────────────────────────── */}
          <div className="min-w-0">
            <div className="flex items-start gap-4">
              <PhotoPlaceholder firstname={rider.firstname} lastname={rider.lastname} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <h1 className="font-display uppercase leading-[0.95] tracking-[0.01em] text-cz-1 break-words [font-size:clamp(34px,4.6vw,46px)]">
                    {rider.firstname} {rider.lastname}
                  </h1>
                  {onToggleWatchlist && (
                    <button
                      onClick={onToggleWatchlist}
                      title={onWatchlist ? t("header.watchlistRemove") : t("header.watchlistAdd")}
                      className={`mt-1 flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center text-2xl transition-colors ${onWatchlist ? "text-cz-accent-t" : "text-cz-3 hover:text-cz-2"}`}
                    >
                      {onWatchlist ? "★" : "☆"}
                    </button>
                  )}
                  {onCompare && (
                    <button
                      onClick={onCompare}
                      title={t("header.compareTitle")}
                      className="mt-1 flex-shrink-0 min-h-[44px] px-2 flex items-center justify-center text-xs font-semibold text-cz-3 hover:text-cz-accent-t transition-colors"
                    >
                      {t("header.compare")}
                    </button>
                  )}
                </div>

                {/* Meta-række */}
                <div className="flex items-center gap-2 mt-1.5 flex-wrap text-sm">
                  {rider.nationality_code && (
                    <span className="inline-flex items-center gap-1.5 text-cz-2">
                      <Flag code={rider.nationality_code} />
                      <span className="uppercase text-xs font-semibold tracking-wide">{rider.nationality_code}</span>
                    </span>
                  )}
                  {age != null && (
                    <>
                      <span className="text-cz-3" aria-hidden="true">·</span>
                      <span className="text-cz-2 font-mono tabular-nums">{t("header.ageYears", { age })}</span>
                    </>
                  )}
                  {rider.is_u25 != null && age != null && age < 23 && (
                    <span className="text-[10px] uppercase font-semibold tracking-wide bg-cz-info-bg0/20 text-cz-info px-1.5 py-0.5 rounded">
                      {t("header.u23")}
                    </span>
                  )}
                  {rider.primary_type
                    ? <RiderTypeBadge primaryType={rider.primary_type} secondaryType={rider.secondary_type} size="md" />
                    : <span className="text-xs uppercase bg-cz-subtle text-cz-2 px-2 py-0.5 rounded font-medium">{typeLabel}</span>}
                  {divisionLabel && (
                    <span
                      className="text-[10px] uppercase font-bold tracking-wide px-2 py-0.5 rounded-cz-pill text-white"
                      style={{ backgroundColor: DIVISION_CHIP }}
                    >
                      {divisionLabel}
                    </span>
                  )}
                  {rider.height != null && (
                    <>
                      <span className="text-cz-3" aria-hidden="true">·</span>
                      <span className="text-cz-2 font-mono tabular-nums">{t("header.heightCm", { height: rider.height })}</span>
                    </>
                  )}
                  {rider.weight != null && (
                    <>
                      <span className="text-cz-3" aria-hidden="true">·</span>
                      <span className="text-cz-2 font-mono tabular-nums">{t("header.weightKg", { weight: rider.weight })}</span>
                    </>
                  )}
                </div>

                {/* Hold (+ AI-tag) */}
                <p className="text-cz-2 text-sm font-semibold mt-2 inline-flex items-center gap-1.5">
                  <TeamLink id={rider.team?.id} className="hover:text-cz-accent-t transition-colors">{teamName}</TeamLink>
                  {isAiTeam && (
                    <span className="text-[9px] uppercase font-bold tracking-wide bg-cz-subtle text-cz-3 border border-cz-border px-1 py-0.5 rounded">
                      {t("profile.hero.aiTag")}
                    </span>
                  )}
                </p>

                {/* Kommende hold (handel til næste sæson) */}
                {pendingTeam && (
                  <p className="text-cz-2 text-xs mt-1.5 inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="text-cz-accent-t">→</span>
                    <span className="text-cz-3">{t("header.nextSeasonPrefix")}</span>
                    <TeamLink id={pendingTeam.id} className="font-semibold text-cz-accent-t hover:underline">{pendingTeam.name}</TeamLink>
                  </p>
                )}

                {/* Vinder på */}
                {winsOnText && (
                  <p className="text-cz-3 text-xs uppercase tracking-[0.12em] font-semibold mt-3">
                    {t("profile.hero.winsOn")}{" "}
                    <span className="text-cz-1 normal-case tracking-normal text-sm font-bold ms-1">{winsOnText}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── HØJRE: rating · potentiale · værdi (hairline-divider på desktop) ─ */}
          <div className="sm:border-s sm:border-cz-border sm:ps-6 flex flex-col gap-4">
            <div className="flex items-start gap-4">
              <RatingCircle rating={overallRating} />
              <div className="min-w-0">
                <p className="text-cz-3 text-[10px] uppercase tracking-[0.14em] font-semibold mb-1">{potentialEyebrow}</p>
                {scouting && <ScoutablePotentiale rider={rider} scouting={scouting} showScout={viewer === "scouting"} large />}
              </div>
            </div>

            <div className="pt-4 border-t border-cz-border/60">
              <p className="text-cz-3 text-[10px] uppercase tracking-[0.14em] font-semibold">{t("profile.hero.valueEyebrow")}</p>
              <div className="flex items-end justify-between gap-3 mt-0.5">
                <p
                  className="font-mono font-bold tabular-nums text-cz-1 text-2xl sm:text-[28px] leading-none truncate"
                  title={valueLabel}
                  data-testid="rider-value-amount"
                >
                  {valueAmount}
                </p>
                <div className="text-end flex-shrink-0">
                  <p className="text-cz-3 text-[11px]">
                    {t("profile.hero.salary")}{" "}
                    <span className="text-cz-2 font-mono font-semibold">{salaryText ?? "—"}</span>
                  </p>
                  <p className="text-cz-3 text-[11px] mt-0.5">
                    {t("profile.hero.contract")}{" "}
                    <span className="text-cz-accent-t font-semibold">
                      {rider.contract_end_season != null
                        ? t("profile.hero.contractSeason", { season: rider.contract_end_season })
                        : t("header.noContract")}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <StatusBanner banner={banner} />

        {/* Action-række — injiceres af parent (genbruger eksisterende handlinger). */}
        {actions && <div className="mt-5 pt-5 border-t border-cz-border">{actions}</div>}
      </div>
    </section>
  );
}
