// GraduationDayPage — saesonens tier-overgangs-ritual (#2491).
//
// Bygget efter den EJER-GODKENDTE hi-fi-mockup 2/9, artboard 3g (fyldt) og 3h
// (tom): docs/design/youth-tiers/HANDOFF.md + docs/YOUTH_RULES.md §2.6.
// T1 (max-w-4xl / 896 px, docs/design/PAGE_TEMPLATES.md) — ingen egen
// containerbredde, intet eget sidehoved, ingen egen radius eller typografi.
//
// HVAD SIDEN ER: ugen foer saesonskiftet aabner listen over ryttere der er
// vokset ud af deres trup (ejer-beslutning 15/9). Fristen er selve skiftet;
// rytteren bliver i sin GAMLE trup indtil spilleren flytter ham, og
// default-kaeden koerer ved skiftet for dem der ikke valgte.
//
// DATA: GET /api/academy/me's `graduations` (backend/routes/api.js) — praecis de
// overgange `detectGraduates` har skrevet paa academy_graduation-raekkerne
// (`from_squad`/`to_squad`, #4619). Siden opfinder ingen rytter og skaerer ingen
// overgang vaek; den grupperer hvad der kom (lib/graduationDay.ts).
//
// GULD: én primary paa hele viewet, `Confirm all` i sidehovedet (HANDOFF pkt. 7).
// Segmenterne er den kanoniske `Segmented`, som bruger guld-TEKST paa 10 %
// guld-flade (TASTE fork 3's tredje guld-sted), ikke en fjerde guld-knap.
//
// Hard rule 31: nye frontend-filer skrives i .ts/.tsx.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useAcademy } from "../lib/useAcademy.js";
import { useScouting } from "../lib/useScouting.js";
import { useActiveSeasonYear } from "../hooks/useActiveSeasonYear.js";
import RiderLink from "../components/RiderLink.jsx";
import NationCell from "../components/rider/NationCell.jsx";
import RiderTypeBadge from "../components/rider/RiderTypeBadge.jsx";
import ScoutablePotentiale from "../components/rider/ScoutablePotentiale.jsx";
import {
  Button, EmptyState, ErrorState, PageHeader, PageLoader, Section, SectionHeader, SectionStack,
  Segmented, InboxIcon,
} from "../components/ui/index.js";
import { buttonClass } from "../components/ui/buttonStyles.js";
import { statPlateStyle } from "../lib/statColor.js";
import { riderOverallRating } from "../lib/riderRating.js";
import { flattenAbilities } from "../lib/abilities.js";
import { formatNumber } from "../lib/intl.js";
import { getRiderAge } from "../lib/riderAge.js";
import {
  coachVerdictKey, defaultChoice, groupGraduations, moveUpBlock,
  type GraduationChoice, type Graduate,
} from "../lib/graduationDay.js";

// Primitiverne i components/ui er stadig .jsx uden egne typer (hard rule 31
// gaelder kun NYE filer). Uden typer udleder TS deres props af
// default-VAERDIERNE, saa helt lovlige kald afvises. De faa denne side bruger
// faar derfor deres faktiske kontrakt skrevet ned her, laest direkte af
// Segmented.jsx og ErrorState.jsx.
interface SegmentedOption { value: string; label: string; title?: string; disabled?: boolean }
interface SegmentedProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: SegmentedOption[];
  className?: string;
}
interface ErrorStateProps { title?: string; description?: string; action?: ReactNode; className?: string }
interface PageHeaderProps { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }
interface SectionHeaderProps { title: ReactNode; action?: ReactNode; meta?: ReactNode; className?: string }
interface RiderLinkProps { id: string; className?: string; children: ReactNode; "aria-label"?: string; title?: string }
const SegmentedControl = Segmented as unknown as (props: SegmentedProps) => ReactNode;
const ErrorStateBox = ErrorState as unknown as (props: ErrorStateProps) => ReactNode;
const PageHead = PageHeader as unknown as (props: PageHeaderProps) => ReactNode;
const CardHeader = SectionHeader as unknown as (props: SectionHeaderProps) => ReactNode;
const RiderName = RiderLink as unknown as (props: RiderLinkProps) => ReactNode;

function formatMoney(n: number | null | undefined): string {
  if (n == null) return "–";
  return formatNumber(Math.round(Number(n)), { maximumFractionDigits: 0 });
}

function daysUntil(deadline: string | null | undefined): number | null {
  if (!deadline) return null;
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
}

// Den foerste (tidligste) frist paa listen er sidens frist: serveren giver alle
// raekker i samme vindue den SAMME deadline (graduationDeadlineFrom), saa
// minimum er baade korrekt og stabilt hvis en enkelt raekke skulle afvige.
function earliestDeadline(rows: Graduate[]): string | null {
  const stamps = rows.map((r) => r.deadline).filter((d): d is string => Boolean(d)).sort();
  return stamps[0] ?? null;
}

const CHOICES: GraduationChoice[] = ["promote", "sell", "release"];

export default function GraduationDayPage() {
  const { t } = useTranslation("academy");
  const scouting = useScouting();
  const seasonYear = useActiveSeasonYear();
  const { enabled, graduations, loading, error, resolveGraduate, refresh } = useAcademy();

  // Spillerens valg pr. rytter. Defaulten er `Move up` medmindre oprykningen er
  // blokeret, saa `Sell` (mockup 3g) — se lib/graduationDay.ts.
  const [choices, setChoices] = useState<Record<string, GraduationChoice>>({});
  const [confirming, setConfirming] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const rows = graduations as Graduate[];

  // Saet defaults for ryttere vi ikke har set foer. Et allerede truffet valg
  // maa ALDRIG nulstilles af en baggrunds-refresh, saa vi fylder kun huller.
  useEffect(() => {
    setChoices((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const g of rows) {
        if (next[g.riderId] == null) { next[g.riderId] = defaultChoice(g); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const groups = useMemo(() => groupGraduations(rows), [rows]);
  const deadline = useMemo(() => earliestDeadline(rows), [rows]);
  const days = daysUntil(deadline);

  const setChoice = useCallback((riderId: string, next: GraduationChoice) => {
    setChoices((prev) => ({ ...prev, [riderId]: next }));
    setRowErrors((prev) => (prev[riderId] ? { ...prev, [riderId]: "" } : prev));
  }, []);

  // `Confirm all` — sidens ene guld-handling. Udfoerer hvert valg sekventielt
  // mod POST /api/academy/graduate (uaendret rute) og henter listen ÉN gang til
  // sidst i stedet for efter hvert kald.
  const confirmAll = useCallback(async () => {
    if (confirming || rows.length === 0) return;
    setConfirming(true);
    setFormError(null);
    const errors: Record<string, string> = {};
    for (const g of rows) {
      const action = choices[g.riderId] ?? defaultChoice(g);
      const res = await resolveGraduate(g.riderId, action, { refresh: false });
      if (!res.ok) errors[g.riderId] = String(res.error ?? "failed");
    }
    setRowErrors(errors);
    if (Object.keys(errors).length > 0) setFormError("some");
    await refresh();
    setConfirming(false);
  }, [choices, confirming, refresh, resolveGraduate, rows]);

  if (loading) return <PageLoader label={t("graduationDay.title")} />;

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <PageHead title={t("graduationDay.title")} />
        <ErrorStateBox title={t("error.loadTitle")} description={t("error.loadBody")} />
      </div>
    );
  }

  const backToAcademy = (
    <Link to="/academy" className={buttonClass({ variant: "secondary", size: "sm" })}>
      {t("graduationDay.backToAcademy")}
    </Link>
  );

  // Tom tilstand (artboard 3h): EmptyState med `inbox`-ikon, INGEN guld.
  // Daekker baade "ingen graduerer lige nu" og et slukket akademi-flag, fordi
  // svaret for spilleren er det samme: der er intet at traeffe valg om her.
  if (!enabled || rows.length === 0) {
    return (
      <div className="max-w-4xl mx-auto">
        <PageHead title={t("graduationDay.title")} subtitle={t("graduationDay.emptySubtitle")} />
        <EmptyState
          icon={<InboxIcon size={26} aria-hidden="true" />}
          title={t("graduationDay.emptyTitle")}
          description={t("graduationDay.emptyBody")}
          action={backToAcademy}
        />
      </div>
    );
  }

  const subtitle = days != null && days > 0
    ? t("graduationDay.subtitleDays", { count: rows.length, days })
    : days != null
      ? t("graduationDay.subtitleDue", { count: rows.length })
      : t("graduationDay.subtitlePlain", { count: rows.length });

  return (
    <div className="max-w-4xl mx-auto">
      <PageHead
        title={t("graduationDay.title")}
        subtitle={subtitle}
        actions={
          <Button size="sm" onClick={confirmAll} loading={confirming} disabled={confirming}>
            {t("graduationDay.confirmAll")}
          </Button>
        }
      />

      <SectionStack>
        {groups.map((group) => (
          <Section key={group.key}>
            <CardHeader
              title={t([
                `graduationDay.transition.${group.fromSquad ?? "unknown"}_${group.toSquad}`,
                "graduationDay.transition.fallback",
              ], {
                from: t([`graduationDay.squad.${group.fromSquad ?? "unknown"}`, "graduationDay.squad.unknown"]),
                to: t([`graduationDay.squad.${group.toSquad}`, "graduationDay.squad.unknown"]),
              })}
              meta={t("graduationDay.riderCount", { count: group.riders.length })}
            />
            <ul className="divide-y divide-cz-border border-t border-cz-border">
              {group.riders.map((g) => (
                <GraduateRow
                  key={g.riderId}
                  graduate={g}
                  choice={choices[g.riderId] ?? defaultChoice(g)}
                  onChoice={setChoice}
                  disabled={confirming}
                  rowError={rowErrors[g.riderId] || null}
                  scouting={scouting}
                  seasonYear={seasonYear}
                  t={t}
                />
              ))}
            </ul>
          </Section>
        ))}
      </SectionStack>

      {/* Én linje om default-adfaerden, ÉN gang under kortene (HANDOFF). Den
          beskriver den faktiske default-kaede i backend/lib/academyGraduation.js
          (defaultResolveGraduate): op hvis der er plads og saldoen ikke er i
          minus, ellers til salg. */}
      <p className="mt-4 text-[13px] text-cz-2">{t("graduationDay.defaultNote")}</p>
      {formError && (
        <p role="alert" className="mt-2 text-[13px] text-cz-danger">{t("graduationDay.someFailed")}</p>
      )}
    </div>
  );
}

interface GraduateRowProps {
  graduate: Graduate;
  choice: GraduationChoice;
  onChoice: (riderId: string, next: GraduationChoice) => void;
  disabled: boolean;
  rowError: string | null;
  scouting: ReturnType<typeof useScouting>;
  seasonYear: number | null;
  t: ReturnType<typeof useTranslation>["t"];
}

// Cellen: lodret stak paa mobil (390 px) med sin egen mikro-label, én raekke med
// seks kolonner fra lg. Labelen er skjult paa desktop, hvor kolonne-headeren
// ovenfor baerer den.
function Cell({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="font-data text-3xs uppercase tracking-[.08em] text-cz-3 lg:hidden">{label}</span>
      <div className="mt-0.5 lg:mt-0">{children}</div>
    </div>
  );
}

function GraduateRow({ graduate, choice, onChoice, disabled, rowError, scouting, seasonYear, t }: GraduateRowProps) {
  const g = graduate;
  const block = moveUpBlock(g);
  const rider = useMemo(
    () => flattenAbilities({
      id: g.riderId,
      primary_type: g.primary_type,
      secondary_type: g.secondary_type,
      rider_derived_abilities: g.rider_derived_abilities,
    }),
    [g.riderId, g.primary_type, g.secondary_type, g.rider_derived_abilities],
  );
  const rating = riderOverallRating(rider);
  const estimate = scouting.estimateFor(g.riderId);
  const band = estimate?.hidden ? null : (estimate?.prog ?? estimate?.ceil ?? null);
  const verdict = coachVerdictKey({
    rating: Number.isFinite(rating) ? rating : null,
    band: band ?? null,
    level: estimate?.level ?? null,
    maxLevel: scouting.maxLevel ?? null,
  });
  const age = getRiderAge(g, seasonYear) ?? g.age;
  const contract = g.contract_end_season != null
    ? t("graduationDay.contractUntil", { season: g.contract_end_season })
    : t("graduationDay.contractNone");

  // "Move up" bliver STAAENDE naar den er blokeret, bare uvaelgelig med
  // aarsagen i title + som danger-linje under segmentet (mockup 3g). Et fjernet
  // segment ville skjule at valget overhovedet findes.
  const options: SegmentedOption[] = CHOICES.map((value) => ({
    value,
    label: t(`graduationDay.choice.${value}`),
    // Mens `Confirm all` koerer er HELE raekken laast: et valg der aendres
    // midt i kaeden ville ikke naa med i den handling der allerede er sendt.
    disabled: disabled || (value === "promote" && Boolean(block)),
    title: value === "promote" && block
      ? t("graduationDay.blocked.squadFull", { count: block.count, max: block.max })
      : undefined,
  }));

  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-2 py-3 lg:grid-cols-[minmax(0,1.15fr)_auto_auto_auto_minmax(0,1.25fr)_auto] lg:items-center">
      {/* 1 · Identitet */}
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-medium">
          <RiderName id={g.riderId} className="text-cz-1 transition-colors hover:text-cz-accent-t">{g.name}</RiderName>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {g.nationality_code && <NationCell code={g.nationality_code} />}
          {age != null && <span className="font-data text-3xs uppercase tracking-[.08em] text-cz-3 tabular-nums">{t("ageLabel", { age })}</span>}
          <RiderTypeBadge primaryType={g.primary_type} secondaryType={g.secondary_type} />
        </div>
      </div>

      {/* 2 · Rating-plade (samme statColor-skala som rytterprofilens hero) */}
      <Cell label={t("graduationDay.colRating")}>
        {Number.isFinite(rating) ? (
          <span
            className="inline-flex h-[26px] min-w-[34px] items-center justify-center rounded-cz px-1.5 font-data text-[13px] tabular-nums"
            style={statPlateStyle(rating)}
          >
            {rating}
          </span>
        ) : <span className="text-[13px] text-cz-3">–</span>}
      </Cell>

      {/* 3 · Potentiale-baandet, gennem det maskerede scout-estimat */}
      <Cell label={t("graduationDay.colPotential")}>
        <ScoutablePotentiale rider={rider} scouting={scouting} labelAsTitle hideLevel />
      </Cell>

      {/* 4 · Kontrakt og loen. Begge er UAENDREDE ved et flyt op: en graduate
             beholder sin eksisterende kontrakt (contractOnAcquirePatch roerer
             kun en reelt kontraktloes rytter). */}
      <Cell label={t("graduationDay.colContract")}>
        <span className="block whitespace-nowrap font-data text-[13px] tabular-nums text-cz-1">{contract}</span>
        <span className="block whitespace-nowrap font-data text-3xs tabular-nums text-cz-3">{formatMoney(g.salary)} CZ$</span>
      </Cell>

      {/* 5 · Traenerens vurdering, fog-gatet (lib/graduationDay.ts) */}
      <Cell label={t("graduationDay.colCoach")} className="lg:min-w-0">
        <p className="text-[13px] leading-snug text-cz-2">{t(`graduationDay.coach.${verdict}`)}</p>
      </Cell>

      {/* 6 · Valget. Blokeret oprykning = disabled segment + aarsag i danger. */}
      <Cell label={t("graduationDay.colChoice")} className="lg:justify-self-end">
        <SegmentedControl
          label={t("graduationDay.choiceLabel", { name: g.name })}
          value={block && choice === "promote" ? "sell" : choice}
          onChange={(next: string) => onChoice(g.riderId, next as GraduationChoice)}
          options={options}
        />
        {block && (
          <p className="mt-1 text-3xs leading-tight text-cz-danger lg:text-right">
            {t("graduationDay.blocked.squadFull", { count: block.count, max: block.max })}
          </p>
        )}
        {rowError && (
          <p role="alert" className="mt-1 text-3xs leading-tight text-cz-danger lg:text-right">
            {t([`graduationDay.rowError.${rowError}`, "graduationDay.rowError.failed"])}
          </p>
        )}
      </Cell>
    </li>
  );
}
