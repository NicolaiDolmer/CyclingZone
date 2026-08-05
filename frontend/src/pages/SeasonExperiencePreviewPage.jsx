import SeasonRecapHero from "../components/SeasonRecapHero.jsx";
import SeasonWrapNudgeCard from "../components/SeasonWrapNudgeCard.jsx";
import { useDocumentHead } from "../hooks/useDocumentHead.js";
import { TrophyIcon, CoinIcon, ExchangeIcon } from "../components/ui";

// #2752 — DRAFT-ONLY mock preview for the season-experience UI slice (season
// recap "yearbook" + active season-end/start surfacing). Same convention as
// /ui (KitchenSinkPage.jsx, #1404): public-reachable, not linked in nav, not in
// the sitemap (noindex). Exists purely so the owner can review the new
// components on the deployed Vercel preview + so Playwright can screenshot them
// for the morning round — NOT part of the shipped product. Remove this route
// (or fold its content into KitchenSinkPage) once #2752's real data-wiring PR
// lands and the components are mounted on their real pages
// (DashboardPage.jsx / SeasonEndPage.jsx).
//
// All data below is hand-built mock data — no fetch, no Supabase. See
// SeasonRecapHero.jsx / SeasonWrapNudgeCard.jsx for the (props-in only)
// component contracts.

function MockFrame({ label, children }) {
  return (
    <div className="mb-12">
      <p className="mb-3 font-data text-3xs font-semibold uppercase tracking-[.12em] text-cz-3">
        {label}
      </p>
      <div className="rounded-cz border border-dashed border-cz-border bg-cz-subtle/30 p-4 sm:p-6">
        {children}
      </div>
    </div>
  );
}

// #2752/#2361 real-wiring follow-up (4/8): `division` betyder KONKRET "den
// division holdet SLUTTEDE denne sæson i" (matcher SeasonRecapHero.jsx's egen
// JSDoc + "rankLine"-teksten "#{rank} of {size} in Division {division}") —
// IKKE destinationsdivisionen efter en evt. oprykning/nedrykning. Draft-
// mock'en (PR #3283) blandede de to (promoted-scenariet satte division:2 men
// en highlight der sagde "Division 3") — rettet her efter den rigtige data-
// wiring afslørede tvetydigheden (samme rettelse fjernede {division} fra
// movement.promoted/relegated-copyen i en+da seasonEnd.json/dashboard.json,
// som ellers ville have vist den FORKERTE division ved en oprykning).
const RECAP_SCENARIOS = [
  {
    id: "promoted",
    label: "Mockup — /seasons recap hero · team promoted (finished Division 3, now in Division 2)",
    props: {
      seasonNumber: 2,
      teamName: "Nordkyst Racing",
      division: 3,
      divisionSize: 20,
      rank: 2,
      movement: "promoted",
      points: 4820,
      stageWins: 11,
      prizeWon: 612000,
      highlights: [
        { id: "prize", icon: CoinIcon, label: "Prize leader of Division 3", value: "612,000 CZ$" },
        { id: "transfer", icon: ExchangeIcon, label: "Biggest sale of the season", value: "1,450,000 CZ$" },
        { id: "stage", icon: TrophyIcon, label: "Team stage king: Marco Bittner", value: "6 wins" },
      ],
    },
  },
  {
    id: "relegated",
    label: "Mockup — /seasons recap hero · team relegated (finished Division 3, now in Division 4)",
    props: {
      seasonNumber: 2,
      teamName: "Alpe Domestiques",
      division: 3,
      divisionSize: 20,
      rank: 19,
      movement: "relegated",
      points: 2110,
      stageWins: 2,
      prizeWon: 184000,
      highlights: [],
    },
  },
  {
    id: "held",
    label: "Mockup — /seasons recap hero · position held (mid-table)",
    props: {
      seasonNumber: 2,
      teamName: "Fjord Cycling Collective",
      division: 2,
      divisionSize: 18,
      rank: 9,
      movement: "maintained",
      points: 3340,
      stageWins: 5,
      prizeWon: 398000,
      highlights: [],
    },
  },
];

const NUDGE_SCENARIOS = [
  {
    id: "promoted",
    label: "Mockup — dashboard nudge · team promoted (finished Division 3, now in Division 2)",
    props: {
      seasonNumber: 2,
      nextSeasonNumber: 3,
      division: 3,
      divisionSize: 20,
      rank: 2,
      movement: "promoted",
      points: 4820,
      wins: 11,
    },
  },
  {
    id: "relegated",
    label: "Mockup — dashboard nudge · team relegated (finished Division 3, now in Division 4)",
    props: {
      seasonNumber: 2,
      nextSeasonNumber: 3,
      division: 3,
      divisionSize: 20,
      rank: 19,
      movement: "relegated",
      points: 2110,
      wins: 2,
    },
  },
  {
    id: "held-top",
    label: "Mockup — dashboard nudge · held Division 1 (top tier)",
    props: {
      seasonNumber: 2,
      nextSeasonNumber: 3,
      division: 1,
      divisionSize: 16,
      rank: 4,
      movement: "maintained",
      points: 5290,
      wins: 9,
    },
  },
];

export default function SeasonExperiencePreviewPage() {
  useDocumentHead({ title: "Season experience preview (#2752) · Cycling Zone", noindex: true });

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-8">
      <p className="mb-2 font-data text-xs font-semibold uppercase tracking-[.18em] text-cz-accent">
        Cycling Zone · design draft
      </p>
      <h1 className="mb-3 font-display text-4xl leading-[.96] tracking-[.012em] text-cz-1 sm:text-5xl">
        Season experience preview
      </h1>
      <p className="mb-10 max-w-2xl text-[13.5px] text-cz-2">
        Components for issue #2752 (season recap + active season-end/start
        surfacing). Mock data only — nothing on THIS page reads real data. The
        real thing is now wired into DashboardPage.jsx (season-wrap nudge) and
        SeasonEndPage.jsx (recap hero, above SeasonHonours) — this page stays
        as a fixed-data reference for reviewing scenarios that need a specific
        real season/team to reproduce live. Candidate for folding into the
        kitchen sink or removing once the real wiring has been checked on a
        live preview deploy.
      </p>

      <section className="mb-14">
        <h2 className="mb-1 font-display text-2xl uppercase tracking-[.02em] text-cz-1">
          Dashboard nudge — season wrapped
        </h2>
        <p className="mb-6 text-[13px] text-cz-3">
          {"Appears on /dashboard right after a season ends, same slot as the existing SeasonStartGuideCard."}
        </p>
        {NUDGE_SCENARIOS.map((s) => (
          <MockFrame key={s.id} label={s.label}>
            <div className="max-w-lg">
              <SeasonWrapNudgeCard {...s.props} onView={() => {}} onDismiss={() => {}} />
            </div>
          </MockFrame>
        ))}
      </section>

      <section>
        <h2 className="mb-1 font-display text-2xl uppercase tracking-[.02em] text-cz-1">
          /seasons — the “yearbook” recap hero
        </h2>
        <p className="mb-6 text-[13px] text-cz-3">
          Sits at the top of the season page for a completed season, above the
          existing season-wide “best riders” block.
        </p>
        {RECAP_SCENARIOS.map((s) => (
          <MockFrame key={s.id} label={s.label}>
            <div className="max-w-2xl">
              <SeasonRecapHero {...s.props} shareUrl={`https://cyclingzone.org/seasons/preview-${s.id}`} />
            </div>
          </MockFrame>
        ))}
      </section>
    </main>
  );
}
