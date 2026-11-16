// #8081: tre udgaver af akademisiden til ejerens valg. Vises KUN bag
// ?design8081=a|b|c; uden parameteren renderer AcademyPage som før.
//
// Fælles for alle tre (fastlagte ejervalg 16/11):
//   • #8060: regnskabet tæller samme ryttere på køb og salg og deles pr. sæson.
//   • #8036: primær og sekundær ryttertype står altid ved talentet.
//   • #6944: aldersfokus 16/17/18/19 i akademiets profil (skitse B fra PR #8185).
//   • #7932: talentet lander direkte på en trup med plads; grænserne 30/30/30,
//     højst 60, vises som midlertidige; intet "Loft".
//
// A: overblik + faner. B: én side med sidekolonne. C: én liste fra kandidat til trup.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import AcademyProfileCard from "../AcademyProfileCard.tsx";
import NationCell from "../rider/NationCell.jsx";
import RiderLink from "../RiderLink.jsx";
import RiderTypeBadge from "../rider/RiderTypeBadge.jsx";
import AcademyPrognosisCell from "../rider/AcademyPrognosisCell.tsx";
import { Card, Button, HeroStats, Section, SectionHeader as SectionHeaderJs, Tabs, TabList, Tab, TabPanel, CollapsibleSection as CollapsibleSectionJs } from "../ui";

// Kit-primitiverne er utypede .jsx; checkJs udleder prop-typer fra defaults (null).
const SectionHeader = /** @type {any} */ (SectionHeaderJs);
const CollapsibleSection = /** @type {any} */ (CollapsibleSectionJs);
import { formatCz } from "../../lib/marketValues.js";
import { ageForSeason, getRiderAge } from "../../lib/riderAge.js";
import { academyTargetSquad } from "../../lib/squadCaps.ts";
import AgeFocusField8081 from "./AgeFocusField8081.jsx";
import SquadLimits8081, { squadLimitRows } from "./SquadLimits8081.jsx";
import TalentTable8081 from "./TalentTable8081.jsx";
import SeasonLedger8081 from "./SeasonLedger8081.jsx";
import { useAcademyLedger8081 } from "./useAcademyLedger8081.js";
import { designLandingSquad } from "./designModel.js";
import { useDesignCopy } from "./copy.js";

function PreviewLine({ text }) {
  return <p className="-mt-3 mb-5 font-data text-2xs uppercase tracking-wide text-cz-3" data-testid="design8081-variant">{text}</p>;
}

function useLandingText(counts, seasonYear) {
  const c = useDesignCopy();
  return (item) => {
    const age = ageForSeason(item.rider?.birthdate, seasonYear);
    const squad = designLandingSquad(age, counts);
    return squad ? c("landing.on", { squad: c(`squad.${squad}`) }) : c("landing.none");
  };
}

/** Profilkortet med aldersfokus som ekstra felt (#6944). */
function ProfileWithAge({ academyProfile, saveProfile, ageFocus, setAgeFocus }) {
  return (
    <div className="flex flex-col gap-4">
      {academyProfile && <AcademyProfileCard profile={academyProfile} onSave={saveProfile} />}
      <Card className="p-4">
        <AgeFocusField8081 value={ageFocus} onChange={setAgeFocus} />
      </Card>
    </div>
  );
}

// ---------- Udgave C: én liste ----------
const TH = "px-3 py-2 text-left font-data text-2xs font-semibold uppercase tracking-wide text-cz-3";
const TD = "px-3 py-[9px] align-top";

function GroupRow({ title, meta }) {
  return (
    <tr className="border-b border-cz-border bg-cz-subtle">
      <td colSpan={6} className="px-3 py-2">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-semibold text-cz-1">{title}</span>
          {meta && <span className="font-data text-2xs tabular-nums text-cz-3">{meta}</span>}
        </span>
      </td>
    </tr>
  );
}

function OneList({ ctx, landingText, squadById }) {
  const c = useDesignCopy();
  const { t } = useTranslation("academy");
  const { regularIntake, roster, seasonYear, counts, balance, actionState, actionErrors, onSign, onReject } = ctx;
  const { rows } = squadLimitRows(counts);
  const capOf = (squad) => rows.find((r) => r.squad === squad);
  const squadOf = (r) => squadById.get(r.id) ?? r.squad ?? academyTargetSquad(r.birthdate, seasonYear) ?? "u23";
  const groups = [
    { squad: "junior", title: c("c.groupJunior"), riders: roster.filter((r) => squadOf(r) === "junior") },
    { squad: "u23", title: c("c.groupU23"), riders: roster.filter((r) => squadOf(r) === "u23") },
  ];
  const nameCell = (rider, linked) => (
    <td className={TD}>
      <span className="flex min-w-0 items-center gap-1.5">
        {rider.nationality_code && <NationCell code={rider.nationality_code} />}
        {linked
          ? <RiderLink id={rider.id} className="min-w-0 break-words text-[13.5px] font-medium text-cz-1 hover:text-cz-accent-t">{rider.firstname} {rider.lastname}</RiderLink>
          : <span className="min-w-0 break-words text-[13.5px] font-medium text-cz-1">{rider.firstname} {rider.lastname}</span>}
      </span>
      <RiderTypeBadge primaryType={rider.primary_type} secondaryType={rider.secondary_type} stacked className="mt-1 sm:hidden" />
    </td>
  );
  return (
    <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card" data-testid="design8081-one-list">
      <table data-sort-exempt="Designudkast #8081, grupperet efter akademiets rejse" className="w-full table-fixed border-collapse text-sm sm:table-auto">
        <thead>
          <tr className="border-b border-cz-border">
            <th className={`${TH} w-[40%] sm:w-auto`}>{c("talents.colRider")}</th>
            <th className={`${TH} hidden sm:table-cell`}>{c("talents.colType")}</th>
            <th className={`${TH} text-right`}>{c("talents.colAge")}</th>
            <th className={`${TH} hidden md:table-cell`}>{c("talents.colSquad")}</th>
            <th className={`${TH} w-[28%] sm:w-auto`}>{c("talents.colPrognosis")}</th>
            <th className={`${TH} w-[18%] text-right sm:w-auto`}><span className="sr-only sm:not-sr-only">{c("c.colAction")}</span></th>
          </tr>
        </thead>
        <tbody>
          <GroupRow title={c("c.groupCandidates")} meta={String(regularIntake.length)} />
          {regularIntake.map((item) => {
            const r = item.rider;
            const fee = item.signingFee;
            const busy = actionState[r.id] != null;
            const tooExpensive = fee != null && balance != null && fee > balance;
            const landing = landingText(item);
            return (
              <tr key={item.intakeId} className="border-b border-cz-border hover:bg-cz-subtle">
                {nameCell(r, false)}
                <td className={`${TD} hidden sm:table-cell`}><RiderTypeBadge primaryType={r.primary_type} secondaryType={r.secondary_type} /></td>
                <td className={`${TD} text-right font-data tabular-nums`}>{getRiderAge(r.birthdate, seasonYear) ?? "–"}</td>
                <td className={`${TD} hidden text-xs text-cz-2 md:table-cell`}>{landing}</td>
                <td className={`${TD} text-xs`}>
                  <span className={`block font-data tabular-nums ${tooExpensive ? "text-cz-danger" : "text-cz-1"}`}>{formatCz(fee)}</span>
                  <span className="block text-3xs text-cz-3 md:hidden">{landing}</span>
                  {actionErrors[r.id] && <span className="block text-3xs text-cz-danger">{actionErrors[r.id]}</span>}
                </td>
                <td className={`${TD} text-right`}>
                  <span className="inline-flex flex-col gap-1 sm:flex-row">
                    <Button size="sm" variant="secondary" onClick={() => onSign(r.id)} disabled={busy || tooExpensive} loading={actionState[r.id] === "signing"}>{t("signBtn")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => onReject(r.id)} disabled={busy} loading={actionState[r.id] === "rejecting"}>{t("rejectBtn")}</Button>
                  </span>
                </td>
              </tr>
            );
          })}
          {groups.map((g) => {
            const cap = capOf(g.squad);
            return [
              <GroupRow key={`h-${g.squad}`} title={g.title} meta={c("squads.count", { used: cap?.used ?? 0, max: cap?.max ?? 0 })} />,
              ...g.riders.map((r) => (
                <tr key={r.id} className="border-b border-cz-border hover:bg-cz-subtle">
                  {nameCell(r, true)}
                  <td className={`${TD} hidden sm:table-cell`}><RiderTypeBadge primaryType={r.primary_type} secondaryType={r.secondary_type} /></td>
                  <td className={`${TD} text-right font-data tabular-nums`}>{getRiderAge(r.birthdate, seasonYear) ?? "–"}</td>
                  <td className={`${TD} hidden text-xs text-cz-2 md:table-cell`}>{c(`squad.${g.squad}`)}</td>
                  <td className={TD}>{r.prognosis ? <AcademyPrognosisCell prognosis={r.prognosis} /> : <span className="text-cz-3">–</span>}</td>
                  <td className={TD} />
                </tr>
              )),
            ];
          })}
        </tbody>
      </table>
      <p className="border-t border-cz-border px-3 py-2 font-data text-3xs uppercase tracking-wide text-cz-3">
        {c("squads.temporary")}: {c("squad.junior")} 30 · {c("squad.u23")} 30 · {c("squad.senior")} 30 · {c("squads.total")} 60
      </p>
    </div>
  );
}

// ---------- Hovedkomponenten ----------
export default function AcademyDesign8081({ variant, initialTab = "intake", ctx }) {
  const c = useDesignCopy();
  const { t } = useTranslation("academy");
  const [tab, setTab] = useState(initialTab);
  const [ageFocus, setAgeFocus] = useState("mixed");
  const { roster, seasonYear, counts, regularIntake, intakePull, academyProfile, saveProfile, renderIntakeCard } = ctx;
  const rosterIds = useMemo(() => (roster ?? []).map((r) => r.id), [roster]);
  const ledgerState = useAcademyLedger8081(true, rosterIds);
  const landingText = useLandingText(counts, seasonYear);
  const { rows: limitRows, total } = squadLimitRows(counts);
  const net = ledgerState.ledger?.current?.net;

  const intakeCards = (cols) => (
    <>
      {ctx.pullCard}
      {regularIntake.length === 0 ? ctx.intakeEmpty : (
        <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${cols === 3 ? "lg:grid-cols-3" : ""}`}>
          {regularIntake.map((item) => renderIntakeCard(item, { landingText }))}
        </div>
      )}
    </>
  );

  if (variant === "a") {
    const stats = [
      {
        label: c("stats.intake"),
        value: String(regularIntake.length),
        sub: intakePull.enabled && !intakePull.pulledThisWeek ? c("stats.intakeOpen") : c("stats.intakeDone"),
      },
      ...limitRows.map((r) => ({ label: c(`squad.${r.squad}`), value: c("squads.count", { used: r.used, max: r.max }) })),
      { label: c("squads.total"), value: c("squads.count", { used: total.used, max: total.max }), sub: c("squads.temporary") },
      { label: c("stats.netSeason"), value: net == null ? "–" : formatCz(net) },
    ];
    return (
      <div data-testid="design8081-a">
        <PreviewLine text={c("variantA")} />
        {ctx.graduationBanner}
        <Card className="mb-6 p-5">
          <HeroStats items={stats} flush />
        </Card>
        <Tabs value={tab} onChange={setTab}>
          <TabList label={t("title")} className="mb-5">
            <Tab value="intake">{c("tabs.intake")}</Tab>
            <Tab value="talents">{c("tabs.talents")}</Tab>
            <Tab value="ledger">{c("tabs.ledger")}</Tab>
            <Tab value="profile">{c("tabs.profile")}</Tab>
          </TabList>
          <TabPanel value="intake" className="space-y-6">
            {ctx.giftSection}
            <section>{intakeCards(3)}</section>
          </TabPanel>
          <TabPanel value="talents">
            <TalentTable8081 roster={roster} seasonYear={seasonYear} squadById={ledgerState.squadById} pool={ledgerState.pool} onGoToIntake={() => setTab("intake")} />
          </TabPanel>
          <TabPanel value="ledger">
            <SeasonLedger8081 state={ledgerState} />
          </TabPanel>
          <TabPanel value="profile">
            <ProfileWithAge academyProfile={academyProfile} saveProfile={saveProfile} ageFocus={ageFocus} setAgeFocus={setAgeFocus} />
          </TabPanel>
        </Tabs>
      </div>
    );
  }

  if (variant === "b") {
    return (
      <div data-testid="design8081-b">
        <PreviewLine text={c("variantB")} />
        {ctx.graduationBanner}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            {ctx.giftSection}
            <section>
              <SectionHeader title={c("tabs.intake")} meta={String(regularIntake.length)} />
              {intakeCards(2)}
            </section>
            <section>
              <SectionHeader title={c("talents.title")} meta={String(roster.length)} />
              <TalentTable8081 roster={roster} seasonYear={seasonYear} squadById={ledgerState.squadById} pool={ledgerState.pool} showVia={false} />
            </section>
            {academyProfile && <AcademyProfileCard profile={academyProfile} onSave={saveProfile} />}
          </div>
          <aside className="min-w-0 space-y-4">
            <Section>
              <SectionHeader title={c("squads.title")} />
              <SquadLimits8081 counts={counts} />
            </Section>
            <Section>
              <AgeFocusField8081 value={ageFocus} onChange={setAgeFocus} compact />
            </Section>
            <Section>
              <SectionHeader title={c("ledger.title")} />
              <SeasonLedger8081 state={ledgerState} mode="compact" />
            </Section>
          </aside>
        </div>
      </div>
    );
  }

  // Udgave C
  const focusLabel = ageFocus === "mixed" ? c("age.mixed") : ageFocus;
  return (
    <div data-testid="design8081-c" className="space-y-6">
      <PreviewLine text={c("variantC")} />
      {ctx.graduationBanner}
      {ctx.giftSection}
      {ctx.pullCard}
      <OneList ctx={ctx} landingText={landingText} squadById={ledgerState.squadById} />
      <CollapsibleSection title={c("tabs.profile")} meta={c("age.summary", { focus: focusLabel })}>
        <div className="pt-3">
          <ProfileWithAge academyProfile={academyProfile} saveProfile={saveProfile} ageFocus={ageFocus} setAgeFocus={setAgeFocus} />
        </div>
      </CollapsibleSection>
      <CollapsibleSection title={c("ledger.title")} meta={net == null ? null : `${c("stats.netSeason")}: ${formatCz(net)}`} defaultOpen>
        <div className="pt-3">
          <SeasonLedger8081 state={ledgerState} />
        </div>
      </CollapsibleSection>
    </div>
  );
}
