// Skitser til #8281 (mobil-rettelse 7 fra #8073): rytterprofilens top med plads
// til rytterbillede, tre retninger ved 390 og 1440. Bygger videre på fix 7 i
// mobil-top15-skitsen (PR #8236: mærker inline, auktion som én linje, kontrakt
// samlet) og på PAGE_TEMPLATES T3 (identitets-slot) + design_handoff_rider_profile.
// Kun dev; ingen app-kode importerer filen.
//
// Billedet er testportrættet fra #5113 (docs/design/visual-identity/svg/
// rider-front-neutral.svg, "Flat + ink"). Det er IKKE Adas eget udseende: rider
// genome (#5117) findes ikke endnu, så alle ryttere ville se ens ud i dag.
//
// URL: ?d=A|B|C&w=390|1440[&photo=0][&marks=0]
import type { ReactNode } from "react";
import { Btn, Card, Desktop, Flag, HeroStats, Icon, Jersey, Mark, Phone, Rating, TabRow, Tag } from "./Kit.tsx";

const q = new URLSearchParams(window.location.search);
const MOBILE = q.get("w") !== "1440";
const PHOTO = q.get("photo") !== "0";
const PORTRAIT = new URL("./portrait-example.svg", import.meta.url).href;

/* ── mock-rytter (seedData.js RIDERS[0], som /riders/rider-1 viser den) ── */

/** Portræt eller pænt fravær (initialer i Bebas + "PHOTO"), samme flade. */
function Portrait({ className, crop = "head" }: { className: string; crop?: "head" | "bust" }) {
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-cz border border-cz-border bg-cz-subtle ${className}`}>
      {PHOTO ? (
        <img src={PORTRAIT} alt="Ada Pedersen" className={`absolute inset-x-0 w-full ${crop === "head" ? "top-[-4%]" : "bottom-0"}`} />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center text-cz-3">
          <span className="font-display text-[30px] leading-none tracking-wide text-cz-2">AP</span>
          <span className="mt-1 font-data text-3xs uppercase tracking-widest">Photo</span>
        </div>
      )}
    </div>
  );
}

function Name({ size }: { size: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <h1 className={`font-display leading-[0.95] tracking-wide ${size}`}>ADA PEDERSEN</h1>
      <span className="inline-flex items-center gap-1"><Jersey label="U23 world champion" /><Icon name="star" className="h-4 w-4 text-cz-accent-t" /></span>
    </div>
  );
}

function Meta() {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-data text-xs text-cz-2">
      <Flag code="dk" />DEN · 24 yrs · <a className="text-cz-1 underline decoration-cz-border underline-offset-2">E2E Racing</a> <Tag>U25</Tag>
      <span className={MOBILE ? "basis-full text-cz-3" : "text-cz-3"}>{MOBILE ? "" : "· "}Natural Sprinter / Rouleur</span>
    </div>
  );
}

const STATS = [
  { label: "Market value", value: "1,680,000 CZ$" },
  { label: "Salary", value: "42,000 CZ$" },
  { label: "Projected", value: "40–48" },
  { label: "Contract", value: "Season 4" },
];

function AuctionLine({ mark }: { mark?: number }) {
  return (
    <div className="relative flex min-h-11 items-center gap-2 border-t border-cz-border pt-3 text-sm">
      <Icon name="gavel" className="h-4 w-4 text-cz-2" />
      <span className="min-w-0 flex-1">On auction · highest bid <b className="font-data font-semibold tabular-nums">50,000 CZ$</b> · <span className="font-data tabular-nums">5h 59m</span></span>
      <a className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap text-cz-accent-t">See auction<Icon name="chevron" className="h-4 w-4" /></a>
      {mark && <Mark n={mark} className="absolute -top-2 left-0" />}
    </div>
  );
}

function Actions({ mark }: { mark?: number }) {
  return (
    <div className="relative mt-3 flex flex-wrap items-center gap-2">
      <Btn variant="primary" className={MOBILE ? "flex-1" : ""}>Extend contract</Btn>
      {MOBILE ? <Btn className="px-0"><Icon name="more" className="h-5 w-5" /></Btn> : <Btn>Contract<Icon name="chevronDown" className="h-4 w-4" /></Btn>}
      <span className={`flex gap-2 ${MOBILE ? "" : "ms-auto"}`}>
        <Btn className="px-0"><Icon name="star" className="h-4 w-4" /></Btn>
        {MOBILE ? <Btn className="px-0"><Icon name="exchange" className="h-4 w-4" /></Btn> : <Btn>Compare</Btn>}
      </span>
      {mark && <Mark n={mark} className="absolute -top-2 left-0" />}
    </div>
  );
}

function RatingBlock() {
  return (
    <div className="flex flex-col items-end">
      <div className="mb-1 font-data text-3xs font-semibold uppercase tracking-widest text-cz-3">Best role now</div>
      <Rating value={29} type="Sprinter" size="lg" />
    </div>
  );
}

function Abilities() {
  const groups: [string, [string, number][]][] = [
    ["Physical", [["Climbing", 19], ["Tempo", 23], ["Punch", 26], ["Sprint", 31]]],
    ["Mental", [["Aggression", 22], ["Tactics", 25], ["Teamwork", 18], ["Leadership", 26]]],
    ["Technical", [["Descending", 23], ["Cobbles", 21], ["Positioning", 27]]],
  ];
  return (
    <div className={`mt-3 grid gap-3 ${MOBILE ? "grid-cols-1" : "grid-cols-3"}`}>
      {(MOBILE ? groups.slice(0, 1) : groups).map(([g, rows]) => (
        <Card key={g} className="p-4">
          <div className="mb-2 font-data text-2xs font-semibold uppercase tracking-widest text-cz-3">{g}</div>
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between border-t border-cz-border py-1.5 text-sm"><span>{k}</span><span className="font-data font-semibold tabular-nums">{v}</span></div>
          ))}
        </Card>
      ))}
    </div>
  );
}

const TABS = ["Overview", "Physiology", "Training", "Development", "Scouting", "History", "Results", "Palmarès", "Interest"];

function Frame({ children }: { children: ReactNode }) {
  if (MOBILE) {
    return (
      <Phone nav="Riders">
        <a className="-ms-2 -mt-2 inline-flex min-h-11 items-center gap-1 px-2 text-sm text-cz-2"><Icon name="back" className="h-4 w-4" />Back</a>
        {children}
        <TabRow tabs={TABS} more className="mt-3" />
        <Abilities />
      </Phone>
    );
  }
  return (
    <Desktop nav="Riders">
      <div className="mx-auto max-w-[960px]">
        <a className="-mt-3 mb-1 inline-flex min-h-9 items-center gap-1 text-xs font-medium text-cz-2"><Icon name="back" className="h-3.5 w-3.5" />Back</a>
        {children}
        <TabRow tabs={TABS} className="mt-4" />
        <Abilities />
      </div>
    </Desktop>
  );
}

const keyline = "border-t-2 border-t-cz-accent";

/* ── A · Kanonisk identitets-slot (PAGE_TEMPLATES T3, 96 px kvadrat) ──── */

function HeroA() {
  return (
    <Frame>
      <Card className={`${keyline} ${MOBILE ? "p-4" : "p-6"}`}>
        <div className="relative flex items-start gap-4">
          <Portrait className={MOBILE ? "h-[76px] w-[76px]" : "h-24 w-24"} />
          <Mark n={1} className="absolute -left-2 -top-2" />
          <div className="relative min-w-0 flex-1">
            <Name size={MOBILE ? "text-[28px]" : "text-[44px]"} />
            <Meta />
            <Mark n={2} className="absolute -top-3 right-0" />
          </div>
          {!MOBILE && <RatingBlock />}
        </div>
        <div className="mt-4 border-t border-cz-border pt-3">
          <HeroStats items={MOBILE ? [{ label: "Best role now", value: <span className="inline-flex items-center gap-1.5"><Rating value={29} />Sprinter</span> }, ...STATS] : STATS} cols={MOBILE ? "grid-cols-2" : "grid-cols-4"} />
        </div>
        <div className="mt-3"><AuctionLine mark={3} /></div>
        <Actions mark={4} />
      </Card>
    </Frame>
  );
}

/* ── B · Portræt-kolonne i 3:4 (spillerkort) ─────────────────────────── */

function HeroB() {
  return (
    <Frame>
      <Card className={`${keyline} ${MOBILE ? "p-4" : "p-6"}`}>
        <div className={`relative flex ${MOBILE ? "gap-3" : "gap-6"}`}>
          <Portrait crop="bust" className={MOBILE ? "h-[136px] w-[104px]" : "h-[248px] w-[186px]"} />
          <Mark n={1} className="absolute -left-2 -top-2" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><Name size={MOBILE ? "text-[26px]" : "text-[44px]"} /><Meta /></div>
              {!MOBILE && <RatingBlock />}
            </div>
            {MOBILE ? (
              <div className="mt-2 flex items-center gap-2 text-sm"><Rating value={29} /><span className="text-cz-2">Best role now: Sprinter</span></div>
            ) : (
              <div className="relative mt-5 border-t border-cz-border pt-3">
                <HeroStats items={STATS} cols="grid-cols-4" />
                <Mark n={2} className="absolute -top-2 right-0" />
                <div className="mt-3"><AuctionLine mark={3} /></div>
              </div>
            )}
          </div>
        </div>
        {MOBILE && (
          <div className="relative mt-3 border-t border-cz-border pt-3">
            <HeroStats items={STATS} cols="grid-cols-2" />
            <Mark n={2} className="absolute -top-2 right-0" />
            <div className="mt-3"><AuctionLine mark={3} /></div>
          </div>
        )}
        <Actions mark={4} />
      </Card>
    </Frame>
  );
}

/* ── C · Figuren står i kortet (beskåret af kortets bundkant) ─────────── */

function HeroC() {
  const figure = (cls: string) => (
    <div className={`pointer-events-none absolute bottom-0 ${cls}`}>
      {PHOTO ? <img src={PORTRAIT} alt="" className="absolute bottom-0 w-full" /> : (
        <div className="absolute bottom-0 flex h-full w-full items-end justify-center pb-2">
          <span className="font-display text-[56px] leading-none text-cz-border">AP</span>
        </div>
      )}
    </div>
  );
  if (MOBILE) {
    return (
      <Frame>
        <Card className={`${keyline} p-4`}>
          {/* Figuren står på stregen over tallene: ingen ramme, ingen flade. */}
          <div className="relative min-h-[150px] border-b border-cz-border pe-[112px]">
            {figure("right-0 h-[150px] w-[120px]")}
            <Mark n={1} className="absolute right-[112px] top-0" />
            <Name size="text-[28px]" />
            <Meta />
            <div className="mt-3 flex items-center gap-2 pb-3 text-sm"><Rating value={29} /><span className="text-cz-2">Best role now</span></div>
          </div>
          <div className="relative pt-3">
            <HeroStats items={STATS} cols="grid-cols-2" />
            <Mark n={2} className="absolute -top-2 right-0" />
          </div>
          <div className="mt-3"><AuctionLine mark={3} /></div>
          <Actions mark={4} />
        </Card>
      </Frame>
    );
  }
  return (
    <Frame>
      <Card className={`relative overflow-hidden ${keyline} p-6`}>
        {/* Figuren står på kortets bundkant: ingen ramme, ingen flade. */}
        {figure("right-6 h-[300px] w-[240px]")}
        <Mark n={1} className="absolute right-[250px] top-6" />
        <div className="relative pe-[260px]">
          <Name size="text-[48px]" />
          <Meta />
          <div className="mt-3 flex items-center gap-2 text-sm"><Rating value={29} size="lg" /><span className="text-cz-2">Best role now: Sprinter</span></div>
          <div className="relative mt-4 border-t border-cz-border pt-3">
            <HeroStats items={STATS} cols="grid-cols-4" />
            <Mark n={2} className="absolute -top-2 right-0" />
          </div>
          <div className="mt-3"><AuctionLine mark={3} /></div>
          <Actions mark={4} />
        </div>
      </Card>
    </Frame>
  );
}

const SKETCHES: Record<string, () => ReactNode> = { A: HeroA, B: HeroB, C: HeroC };

export function SketchApp() {
  const S = SKETCHES[q.get("d") ?? "A"] ?? HeroA;
  return <S />;
}
