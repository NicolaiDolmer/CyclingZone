// #8254 (valg runde 2 for #7535): planlægningssiden (T2) tegnet efter én konfiguration pr. variant.
// Grundlaget er wireframen fra 2/11 med ejerens valg 1-3 lagt ind; kun billedets punkt varieres.
// Elementer med data-dev er afvigelser fra wireframen for billedets punkt (røde numre i billedet),
// data-note er en forklaring (blå numre). Kun billeder; ingen backend, intet login, ingen app-rute.
import type { ReactNode } from "react";
import { LIST, RACE, RIDERS, SELECTED, STAGES, WEEK, listCounts, type ListRace, type Rider } from "./data.ts";
import type { Config } from "./variants.ts";
import { Badge, Btn, Chip, Flag, Glyph, Ico, MatchBar, PlanChip, Profile, Seg } from "./parts.tsx";

const VIEW_LABEL = { squad: "Trup", tactics: "Taktik", peak: "Formtop" } as const;
const VIEW_HINT = { squad: "Udtag ryttere og giv dem en rolle · alle kolonner sorterer", tactics: "Samme taktik og samme gem som på løbssiden", peak: "Kryds ryttere af og anvend formtoppen på løbet" } as const;

/** Afvigelse fra wireframen, kun når billedet handler om punktet. */
function dev(cfg: Config, point: number, text: string): Record<string, string> {
  return cfg.focus === point ? { "data-dev": text } : {};
}
/** Forklaring (ikke en afvigelse), kun når billedet handler om punktet. */
function note(cfg: Config, point: number, text: string): Record<string, string> {
  return cfg.focus === point ? { "data-note": text } : {};
}

// --- Sidens ramme ----------------------------------------------------------------

function Sidebar() {
  const groups: Array<[string, string[]]> = [
    ["Klubhus", []],
    ["Planlægning", ["Planlægning", "Træning", "Løbskalender"]],
    ["Marked", []],
    ["Resultater", []],
  ];
  return (
    <aside className="absolute inset-y-0 start-0 w-[208px] bg-cz-sidebar text-cz-sidebar-2">
      <div className="px-4 py-6">
        <div className="mb-6 text-center font-display text-2xl tracking-wide text-cz-accent">CYCLING ZONE</div>
        <div className="mb-5 border-b border-cz-sidebar-border pb-4">
          <div className="font-data text-3xs uppercase tracking-wide text-cz-sidebar-3">Balance</div>
          <div className="font-data text-base font-semibold tabular-nums text-cz-sidebar-1">500.000 CZ$</div>
          <div className="text-2xs text-cz-sidebar-3">Division 2</div>
        </div>
        {groups.map(([g, items]) => (
          <div key={g} className="mb-3">
            <div className="flex items-center justify-between font-data text-3xs font-semibold uppercase tracking-[.12em] text-cz-sidebar-3">
              {g} {Ico.chevD(12)}
            </div>
            {items.map((it) => (
              <div key={it} className={`mt-1.5 rounded-cz px-2 py-1.5 text-[13px] ${it === "Planlægning" ? "bg-cz-sidebar-hover text-cz-sidebar-1" : "text-cz-sidebar-2"}`}>
                {it}
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

function PageHead() {
  return (
    <div className="mb-4 flex items-start justify-between">
      <div>
        <h1 className="m-0 text-[20px] font-bold leading-tight text-cz-1">Planlægning</h1>
        <p className="m-0 mt-0.5 text-[13px] text-cz-2">Sæson 5 · 4 løb mangler en trup de næste 7 dage</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn>Ugeoversigt</Btn>
        <Btn>Løbsliste</Btn>
        <Btn>Månedskalender</Btn>
      </div>
    </div>
  );
}

function WeekBoard() {
  return (
    <section className="mb-4 rounded-cz border border-cz-border bg-cz-card">
      <div className="flex items-center justify-between border-b border-cz-border px-4 py-2.5">
        <span className="text-[15px] font-semibold text-cz-1">Ugeoversigt</span>
        <span className="flex items-center gap-2 text-xs text-cz-2">
          <span className="rounded-cz border border-cz-border p-1">{Ico.chevL(12)}</span>
          <span className="font-semibold text-cz-1">Uge 47</span> 16.–22. nov.
          <span className="rounded-cz border border-cz-border p-1">{Ico.chevR(12)}</span>
        </span>
      </div>
      <div className="relative grid px-2 pb-3 pt-2" style={{ gridTemplateColumns: `repeat(${WEEK.length}, minmax(0,1fr))` }}>
        {WEEK.map((d) => (
          <div key={d.date} className="border-s border-cz-border px-2 first:border-s-0">
            <div className="font-data text-3xs uppercase tracking-wide text-cz-3">
              {d.day} {d.date}
            </div>
          </div>
        ))}
        {WEEK.map((d, i) =>
          d.races.map((r, j) => (
            <div
              key={r.name}
              className={`mx-1 mt-1.5 flex items-center justify-between gap-2 truncate rounded-cz border px-2 py-1 text-xs ${r.active ? "border-cz-1 bg-cz-subtle" : "border-cz-border bg-cz-card"}`}
              style={{ gridColumn: `${i + 1} / span ${Math.min(r.span, WEEK.length - i)}`, gridRow: j + 2 }}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={`inline-block h-2 w-2 shrink-0 ${r.ok ? "bg-cz-success" : "bg-cz-warning"}`} />
                <span className="truncate font-semibold text-cz-1">{r.name}</span>
              </span>
              <span className="font-data text-3xs tabular-nums text-cz-3">{r.picked}</span>
            </div>
          )),
        )}
      </div>
    </section>
  );
}

// --- Løbslisten med status B (ejervalg 3) ---------------------------------------------

const TACTIC_WORD: Record<ListRace["tactic"], string> = { saved: "Gemt", partial: "1 af 4 gemt", default: "Standardplan", unsaved: "Ikke gemt" };
const TACTIC_TONE: Record<ListRace["tactic"], string> = { saved: "bg-cz-success", partial: "bg-cz-warning", default: "bg-cz-3", unsaved: "bg-cz-danger" };

function RaceList() {
  const counts = listCounts();
  return (
    <section className="self-start overflow-hidden rounded-cz border border-cz-border bg-cz-card">
      <div className="flex items-center justify-between gap-2 border-b border-cz-border px-3 py-2.5">
        <Seg options={["Næste 7 dage", "Hele sæsonen"]} value="Næste 7 dage" small />
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-cz-1">Handlinger {Ico.chevD(12)}</span>
      </div>
      <div className="flex items-center gap-1.5 whitespace-nowrap border-b border-cz-border bg-cz-subtle px-3 py-2 font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-2">
        {Ico.chevD(11)}
        <span>
          Uge 47 · {counts.squad} mangler trup · {counts.tactic} mangler taktik
        </span>
      </div>
      {LIST.map((r) => (
        <div key={r.id} className={`border-b border-cz-border px-3 py-3 last:border-b-0 ${r.id === "preview" ? "bg-cz-subtle" : ""}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-semibold text-cz-1">{r.name}</div>
              <div className="mt-0.5 font-data text-3xs uppercase tracking-wide text-cz-3">
                {r.date} · {r.meta}
              </div>
            </div>
            <Badge tone={r.picked === r.size ? "won" : "closing"}>{r.picked === r.size ? `Trup ${r.picked}/${r.size}` : `${r.size - r.picked} mangler`}</Badge>
          </div>
          <div className="mt-1.5 flex items-center gap-1">
            {r.stages.map((k, i) => (
              <Glyph key={i} kind={k} size={15} />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-cz-2">
            <span className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-1.5 w-1.5 ${TACTIC_TONE[r.tactic]}`} />
              Taktik: <span className="font-medium text-cz-1">{TACTIC_WORD[r.tactic]}</span>
            </span>
            {r.peakRiders ? (
              <span className="inline-flex items-center gap-1 text-cz-info">
                {Ico.peak(13)} Formtop · {r.peakRiders} {r.peakRiders === 1 ? "rytter" : "ryttere"}
              </span>
            ) : null}
          </div>
          {r.shares && (
            <div className="mt-1 flex items-center gap-1 text-2xs text-cz-warning">
              {Ico.flag(11)} {r.shares}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

// --- Løbshoved (punkt 4 og 8) ----------------------------------------------------------

function saveLabel(cfg: Config): { text: string; gold: boolean } | null {
  // Hvad løbshovedets knap siger og om den er sidens ene guld.
  if (cfg.save === "bar") return null;
  if (cfg.view === "tactics") {
    if (cfg.save === "follows") return { text: cfg.squadDirty ? "Gem trup og sæt taktik" : "Gem etape 1", gold: true };
    if (cfg.squadDirty) return { text: "Gem trup", gold: true };
    return { text: "Gem trup", gold: false };
  }
  if (cfg.view === "peak") return { text: "Anvend på valgte (0)", gold: true };
  return { text: "Gem trup", gold: true };
}

function SaveButton({ cfg, full = false }: { cfg: Config; full?: boolean }) {
  const s = saveLabel(cfg);
  if (!s) return null;
  const devText =
    cfg.save === "follows" ? "Hovedets guld følger visningen: her gemmer den trup og taktik (wireframen: Save squad)" : "";
  return (
    <span {...(devText ? dev(cfg, 8, devText) : note(cfg, 8, "Gem trup i hovedet som wireframens Save squad"))} className={full ? "block w-full" : "inline-flex"}>
      <Btn variant={s.gold ? "primary" : "secondary"} size={full ? "md" : "sm"} full={full}>
        {s.text}
      </Btn>
    </span>
  );
}

function ProfileToggle({ cfg }: { cfg: Config }) {
  return (
    <span {...note(cfg, 4, "Skjul profil / Vis profil huskes og gælder alle løb, også næste gang siden åbnes")} className="inline-flex min-h-[44px] items-center gap-1 whitespace-nowrap text-xs font-medium text-cz-2 sm:min-h-0">
      {cfg.profileHidden ? Ico.chevD(12) : Ico.chevU(12)} {cfg.profileHidden ? "Vis profil" : "Skjul profil"}
    </span>
  );
}

/** Wireframens hoved: titel, én linje meta, tre knapper under. */
function RaceHeadWF({ cfg }: { cfg: Config }) {
  return (
    <div className="border-b border-cz-border bg-cz-card px-5 py-4">
      <h2 className="m-0 text-[17px] font-semibold text-cz-1">{RACE.name}</h2>
      <p className="m-0 mt-0.5 text-[13px] text-cz-2">
        Tirs. 17. nov. · ProSeries · 4 etaper · {cfg.squadDirty ? "6 af 6 valgt · 2 ændringer" : "6 af 6 valgt"} · deler løbsdage med Omloop, Wallonie
      </p>
      <div className="mt-3 flex gap-2">
        <Btn>{Ico.copy(13)} Kopiér trup fra…</Btn>
        <Btn>{Ico.spark(13)} Foreslå trup</Btn>
        <SaveButton cfg={cfg} />
      </div>
    </div>
  );
}

/** Runde 3's hoved: knapperne til højre, overlap på egen linje. */
function RaceHeadR3({ cfg, sticky }: { cfg: Config; sticky: boolean }) {
  return (
    <div
      {...(sticky ? dev(cfg, 4, "Løbshovedet klæber øverst, når man ruller (wireframen: ruller med)") : {})}
      className={`border-b border-cz-border bg-cz-card px-5 ${sticky ? "sticky top-0 z-10 py-3" : "py-4"}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[17px] font-semibold text-cz-1">{RACE.name}</h2>
          {sticky ? (
            <p className="m-0 mt-0.5 truncate font-data text-3xs uppercase tracking-wide text-cz-3">
              Tirs. 17. nov. · 4 etaper · {cfg.squadDirty ? "6 af 6 · 2 ændringer" : "6 af 6"}
            </p>
          ) : (
            <p className="m-0 mt-0.5 font-data text-3xs uppercase tracking-wide text-cz-3">
              {RACE.meta} · {cfg.squadDirty ? "6 af 6 valgt · 2 ændringer" : "6 af 6 valgt"}
            </p>
          )}
          {!sticky && <p className="m-0 mt-1 text-2xs text-cz-warning">{RACE.shares}</p>}
        </div>
        <div {...(!sticky ? dev(cfg, 4, "Knapperne står til højre for titlen (wireframen: under titlen)") : {})} className="flex shrink-0 items-center gap-2">
          {sticky && (
            <span {...dev(cfg, 4, "Trup/Taktik/Formtop står i løbshovedet (wireframen: under profilen)")}>
              <Seg options={["Trup", "Taktik", "Formtop"]} value={VIEW_LABEL[cfg.view]} />
            </span>
          )}
          <Btn variant="ghost">
            {Ico.copy(13)} {sticky ? "Kopiér" : "Kopiér trup fra…"}
          </Btn>
          <Btn variant="ghost">
            {Ico.spark(13)} {sticky ? "Foreslå" : "Foreslå trup"}
          </Btn>
          <SaveButton cfg={cfg} />
        </div>
      </div>
    </div>
  );
}

/** Wireframens etape-linje: pile, "Etape 1 af 4", terræn, km, prikker, Skjul profil. */
function StageNav({ cfg, px = "px-5" }: { cfg: Config; px?: string }) {
  const s = STAGES[0];
  return (
    <div className={`flex items-center justify-between gap-3 border-b border-cz-border ${px} py-2.5`}>
      <span className="flex min-w-0 items-center gap-2 text-[13px]">
        <span className="rounded-cz border border-cz-border p-1 text-cz-3">{Ico.chevL(14)}</span>
        <span className="whitespace-nowrap font-semibold text-cz-1">Etape 1 af 4</span>
        <Glyph kind={s.kind} size={14} />
        {px === "px-5" && (
          <span className="truncate font-data text-xs tabular-nums text-cz-2">
            {s.label} · {s.km} km · {s.gain} m
          </span>
        )}
      </span>
      <span className="flex items-center gap-2.5">
        <span className="flex gap-1">
          {STAGES.map((x) => (
            <span key={x.n} className={`inline-block h-2 w-2 ${x.n === 1 ? "bg-cz-accent-t" : "bg-cz-3/40"}`} />
          ))}
        </span>
        <span className="rounded-cz border border-cz-border p-1 text-cz-1">{Ico.chevR(14)}</span>
        <ProfileToggle cfg={cfg} />
      </span>
    </div>
  );
}

function WFProfile({ mobile }: { mobile: boolean }) {
  return (
    <div className={`border-b border-cz-border ${mobile ? "px-4" : "px-5"} py-3`}>
      <Profile kind="flat" height={mobile ? 80 : 130} />
    </div>
  );
}

/** Runde 3's profil: stat-tal, terræn-mærker, Vis fuld profil. */
function R3Profile({ cfg, mobile }: { cfg: Config; mobile: boolean }) {
  return (
    <div className={`border-b border-cz-border ${mobile ? "px-4 py-3" : "px-5 py-4"}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="rounded-cz border border-cz-border p-1 text-cz-3">{Ico.chevL(14)}</span>
          <span className="rounded-cz border border-cz-border p-1 text-cz-1">{Ico.chevR(14)}</span>
          <span className="font-semibold text-cz-1">Etape 1 af 4</span>
          <span className="flex gap-1">
            {STAGES.map((s) => (
              <span key={s.n} className={`inline-block h-2 w-2 ${s.n === 1 ? "bg-cz-accent-t" : "bg-cz-3/40"}`} />
            ))}
          </span>
        </div>
        <span className="flex items-center gap-4 text-xs text-cz-2">
          {!mobile && <span {...dev(cfg, 4, "Vis fuld profil folder løbssidens store profil ud (findes ikke i wireframen)")}>Vis fuld profil</span>}
          <ProfileToggle cfg={cfg} />
        </span>
      </div>
      {!cfg.profileHidden && (
        <>
          <div {...dev(cfg, 4, "Terræn-mærker og stat-tal over kurven (wireframen: kun kurven)")} className="mb-2 flex items-end justify-between gap-3">
            <div className="flex gap-2">
              <span className="rounded-cz border border-cz-danger/30 bg-cz-danger/10 px-2 py-1 font-data text-3xs font-semibold uppercase tracking-wide text-cz-danger">18 km nedkørsel til mål</span>
              {!mobile && <span className="rounded-cz border border-cz-border bg-cz-subtle px-2 py-1 font-data text-3xs font-semibold uppercase tracking-wide text-cz-2">Lang dag</span>}
            </div>
            <div className="flex gap-4 text-end">
              {[["190", "km"], ["268", "m"], ["1", "stigning"]].map(([v, l]) => (
                <div key={l}>
                  <div className="font-data text-lg font-bold tabular-nums leading-none text-cz-1">{v}</div>
                  <div className="font-data text-3xs uppercase text-cz-3">{l}</div>
                </div>
              ))}
            </div>
          </div>
          <Profile kind="flat" height={mobile ? 70 : 150} />
          <div className="mt-2 flex justify-between text-xs">
            <span>
              <span className="font-semibold text-cz-1">Mål</span> <span className="font-data tabular-nums text-cz-3">km 190</span>
            </span>
            <span className="text-cz-2">På spil: pointtrøje-point og bonussekunder</span>
          </div>
        </>
      )}
    </div>
  );
}

/** 4B: én lav profil pr. etape (løbssidens v6-etapestribe). */
function StageStrip({ cfg, mobile }: { cfg: Config; mobile: boolean }) {
  if (cfg.profileHidden) {
    return (
      <div className={`flex items-center justify-between gap-3 border-b border-cz-border ${mobile ? "px-4" : "px-5"} py-2.5`}>
        <span {...dev(cfg, 4, "Skjult: etaperne som én linje med terræn (wireframen: etape-linjen med pile og prikker)")} className="flex flex-wrap items-center gap-3 text-xs text-cz-2">
          {STAGES.map((s) => (
            <span key={s.n} className="inline-flex items-center gap-1.5">
              <span className="font-semibold text-cz-1">{s.n}</span>
              <Glyph kind={s.kind} size={13} />
              {!mobile && (
                <>
                  {s.label} <span className="font-data tabular-nums text-cz-3">{s.km} km</span>
                </>
              )}
            </span>
          ))}
        </span>
        <ProfileToggle cfg={cfg} />
      </div>
    );
  }
  return (
    <div className="border-b border-cz-border">
      <div {...dev(cfg, 4, "Fire små profiler, én pr. etape (wireframen: én stor profil for den valgte etape)")} className="grid grid-cols-4">
        {STAGES.map((s) => (
          <div key={s.n} className={`border-e border-cz-border px-3 py-2 last:border-e-0 ${s.n === 1 ? "bg-cz-subtle" : ""}`}>
            <div className="flex items-center justify-between gap-1">
              <span className="flex items-center gap-1.5 text-xs">
                <span className="font-semibold text-cz-1">{s.n}</span>
                <Glyph kind={s.kind} size={13} />
                {!mobile && <span className="text-cz-2">{s.label}</span>}
              </span>
              {!mobile && <span className="font-data text-3xs tabular-nums text-cz-3">{s.km} km</span>}
            </div>
            <Profile kind={s.kind} height={mobile ? 18 : 24} mini axis={false} />
          </div>
        ))}
      </div>
      <div className={`flex justify-end ${mobile ? "px-4" : "px-5"} py-1.5`}>
        <ProfileToggle cfg={cfg} />
      </div>
    </div>
  );
}

/** 4C: foldet som standard; Vis profil folder wireframens profil ud. */
function FoldedProfile({ cfg, mobile }: { cfg: Config; mobile: boolean }) {
  if (!cfg.profileHidden) {
    return (
      <>
        <StageNav cfg={cfg} px={mobile ? "px-4" : "px-5"} />
        <WFProfile mobile={mobile} />
      </>
    );
  }
  return (
    <div className={`flex items-center justify-between gap-3 border-b border-cz-border ${mobile ? "px-4" : "px-5"} py-2.5`}>
      <span {...dev(cfg, 4, "Profilen er foldet som standard (wireframen: vist som standard, Skjul profil folder den)")} className="flex flex-wrap items-center gap-3 text-xs text-cz-2">
        {mobile ? (
          <span className="font-data tabular-nums">4 etaper · 562 km</span>
        ) : (
          STAGES.map((s) => (
            <span key={s.n} className="inline-flex items-center gap-1.5">
              <span className="font-semibold text-cz-1">{s.n}</span>
              <Glyph kind={s.kind} size={13} />
              {s.label} <span className="font-data tabular-nums text-cz-3">{s.km} km</span>
            </span>
          ))
        )}
      </span>
      <ProfileToggle cfg={cfg} />
    </div>
  );
}

function ProfileBlock({ cfg, mobile }: { cfg: Config; mobile: boolean }) {
  if (cfg.head === "compact") return <StageStrip cfg={cfg} mobile={mobile} />;
  if (cfg.head === "folded") return <FoldedProfile cfg={cfg} mobile={mobile} />;
  if (cfg.head === "today") return <R3Profile cfg={cfg} mobile={mobile} />;
  return (
    <>
      <StageNav cfg={cfg} px={mobile ? "px-4" : "px-5"} />
      {!cfg.profileHidden && <WFProfile mobile={mobile} />}
    </>
  );
}

// --- Trup-tabellen (punkt 5, 6C, 7) ------------------------------------------------------

function StatusCell({ r, cfg }: { r: Rider; cfg: Config }) {
  if (r.injured) return <span className="text-2xs font-semibold leading-tight text-cz-danger">{r.injured}</span>;
  if (r.busy) return <span className="whitespace-nowrap rounded-cz border border-cz-border px-1.5 py-0.5 text-2xs text-cz-2">{r.busy}</span>;
  const rich = cfg.table === "status" || cfg.table === "roleChip";
  if (rich && r.peak?.here)
    return (
      <span className="flex flex-col">
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-2xs font-semibold text-cz-info">{Ico.peak(12)} Formtop her</span>
        <span className="text-3xs leading-tight text-cz-3">Pris: {r.peak.cost}</span>
      </span>
    );
  if (rich && r.peak) return <span className="whitespace-nowrap text-2xs text-cz-3">Formtop i {r.peak.race.split(" ").slice(-1)[0]}</span>;
  if (r.u23) return <span className="rounded-cz bg-cz-info/10 px-1.5 py-0.5 font-data text-3xs font-semibold text-cz-info">U23</span>;
  return <span className="text-cz-3">–</span>;
}

function RoleCell({ r, cfg }: { r: Rider; cfg: Config }) {
  if (!r.selected) return <span className="text-cz-3">–</span>;
  if (cfg.table === "roleChip")
    return (
      <span className="inline-flex items-center gap-1 rounded-cz border border-cz-border bg-cz-subtle px-2 py-0.5 text-xs font-medium text-cz-1">
        {r.role} {Ico.chevD(11)}
      </span>
    );
  return (
    <span className="inline-flex w-[100px] items-center justify-between rounded-cz border border-cz-border bg-cz-card px-2 py-1 text-xs text-cz-1">
      {r.role} {Ico.chevD(12)}
    </span>
  );
}

function FatigueCell({ r, bar }: { r: Rider; bar: boolean }) {
  if (!bar) return <span className="font-data tabular-nums text-cz-1">{r.fatigue}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative h-1 w-8 overflow-hidden bg-cz-border">
        <span className="absolute inset-y-0 start-0 bg-cz-3" style={{ width: `${r.fatigue}%` }} />
      </span>
      <span className="font-data tabular-nums text-cz-1">{r.fatigue}</span>
    </span>
  );
}

function AfterCell({ r, cfg }: { r: Rider; cfg: Config }) {
  if (cfg.after === "finish") {
    const end = r.fatigue + r.finishDelta;
    return (
      <span className="inline-flex items-center gap-2">
        <span className="relative h-1.5 w-16 overflow-hidden bg-cz-border">
          <span className="absolute inset-y-0 start-0 bg-cz-3" style={{ width: `${r.fatigue}%` }} />
          <span className="absolute inset-y-0 bg-cz-warning" style={{ left: `${r.fatigue}%`, width: `${r.finishDelta}%` }} />
        </span>
        <span className="font-data text-xs tabular-nums text-cz-1">{end}</span>
        <span className="font-data text-3xs tabular-nums text-cz-warning">+{r.finishDelta}</span>
      </span>
    );
  }
  return <span className="font-data text-xs tabular-nums text-cz-1">~{r.fatigue + r.finishDelta}</span>;
}

function PeakCell({ r }: { r: Rider }) {
  if (!r.peak) return <span className="text-cz-3">–</span>;
  if (r.peak.here && !r.selected)
    return (
      <span className="flex items-start gap-1 text-2xs font-semibold leading-tight text-cz-warning">
        {Ico.alert(12)} Her, ikke udtaget
      </span>
    );
  if (r.peak.here) return <span className="inline-flex items-center gap-1 text-2xs font-semibold text-cz-info">{Ico.peak(12)} Her</span>;
  return (
    <span className="flex flex-col text-2xs leading-tight text-cz-2">
      <span>{r.peak.race.split(" ").slice(-1)[0]}</span>
      <span className="text-cz-3">{r.peak.when.split(" · ")[1]}</span>
    </span>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <span className={`inline-flex h-4 w-4 items-center justify-center rounded-[3px] border ${on ? "border-cz-accent bg-cz-accent text-cz-on-accent" : "border-cz-border-strong bg-cz-card"}`}>
      {on && Ico.check(11)}
    </span>
  );
}

function Th({ children, end = false, sort = false, extra = {} }: { children: ReactNode; end?: boolean; sort?: boolean; extra?: Record<string, string> }) {
  return (
    <th {...extra} className={`whitespace-nowrap px-1.5 py-2 font-data text-3xs font-semibold uppercase tracking-[.08em] text-cz-3 ${end ? "text-end" : "text-start"}`}>
      {children}
      {sort && <span className="ms-0.5 inline-block align-middle">{Ico.chevD(10)}</span>}
    </th>
  );
}

function SquadTable({ cfg }: { cfg: Config }) {
  const rows = [...RIDERS].sort((a, b) => Number(b.selected) - Number(a.selected) || b.routeMatch - a.routeMatch);
  const top = Math.max(...RIDERS.map((r) => r.routeMatch));
  const today = cfg.table === "today";
  const showType = !today;
  const bar = !today;
  const matchLast = !today; // wireframen: rutematch sidst og sorteret på den
  const afterLabel = cfg.after === "finish" ? "Træthed ved mål" : "Efter løbet";
  const match = (r: Rider) =>
    cfg.table === "status" || cfg.table === "roleChip" ? (
      <MatchBar value={r.routeMatch} />
    ) : today ? (
      <span className={`font-data tabular-nums ${r.routeMatch >= 60 ? "font-semibold text-cz-accent-t" : "text-cz-1"}`}>{r.routeMatch}</span>
    ) : (
      <span className={`font-data tabular-nums ${r.routeMatch === top ? "font-semibold text-cz-accent-t" : "text-cz-1"}`}>{r.routeMatch}</span>
    );
  const matchDev =
    cfg.table === "status" || cfg.table === "roleChip"
      ? dev(cfg, 7, "Rutematch som neutral bjælke med tal (wireframen: tal, den bedste i guld)")
      : today
        ? dev(cfg, 7, "Rutematch står efter Rating og er guld fra en vis værdi (wireframen: sidst, kun den bedste i guld)")
        : {};
  const afterDev =
    cfg.after === "finish" ? dev(cfg, 5, "Hedder Træthed ved mål og viser nu + løbets tillæg som bjælke (wireframen: Efter løbet ~tal)") : {};
  return (
    <div id="squad-table">
      <table data-sort-exempt="skitse: statisk billede, ingen rigtig sortering" className="w-full border-collapse text-[13px]">
        <thead className="border-b border-cz-border bg-cz-subtle">
          <tr>
            <Th>{""}</Th>
            <Th sort>Rytter</Th>
            <Th extra={cfg.table === "status" || cfg.table === "roleChip" ? dev(cfg, 7, "Status viser formtop og prisen i ord (wireframen: U23 og andet løb)") : {}}>Status</Th>
            <Th extra={cfg.table === "roleChip" ? dev(cfg, 7, "Rollen som chip, fælles med taktik (wireframen: rullemenu)") : {}}>Rolle i løbet</Th>
            {showType && <Th sort>Type</Th>}
            {!matchLast && (
              <Th end sort extra={matchDev}>
                Rutematch
              </Th>
            )}
            <Th end sort extra={today ? dev(cfg, 7, "Ingen Type-kolonne og træthed uden bjælke (wireframen har begge)") : {}}>
              Rating
            </Th>
            <Th end sort>Form</Th>
            <Th end sort extra={cfg.after === "none" ? dev(cfg, 5, "Kolonnen Efter løbet er fjernet (wireframen har den)") : {}}>
              Træthed
            </Th>
            {cfg.after !== "none" && (
              <Th end sort extra={afterDev}>
                {afterLabel}
              </Th>
            )}
            {matchLast && (
              <Th end sort extra={matchDev}>
                Rutematch
              </Th>
            )}
            {cfg.peak === "column" && <Th extra={dev(cfg, 6, "Formtop som kolonne i truppen (wireframen: kun fanen Formtop)")}>Formtop</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`border-b border-cz-border ${r.selected ? "bg-cz-accent/[.04]" : ""}`}>
              <td className="w-8 px-1.5 py-[7px] ps-5">
                <Check on={r.selected} />
              </td>
              <td className="px-1.5 py-[7px]">
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <Flag code={r.nation} />
                  <span className="font-medium text-cz-1">{r.name}</span>
                </span>
              </td>
              <td className="w-[112px] max-w-[112px] px-1.5 py-[7px]">
                <StatusCell r={r} cfg={cfg} />
              </td>
              <td className="px-1.5 py-[7px]">
                <RoleCell r={r} cfg={cfg} />
              </td>
              {showType && <td className="px-1.5 py-[7px] text-cz-2">{r.type}</td>}
              {!matchLast && <td className="px-1.5 py-[7px] text-end">{match(r)}</td>}
              <td className="px-1.5 py-[7px] text-end font-data tabular-nums text-cz-1">{r.rating}</td>
              <td className="px-1.5 py-[7px] text-end font-data tabular-nums text-cz-1">{r.form}</td>
              <td className="px-1.5 py-[7px] text-end">
                <FatigueCell r={r} bar={bar} />
              </td>
              {cfg.after !== "none" && (
                <td className="px-1.5 py-[7px] text-end">
                  <AfterCell r={r} cfg={cfg} />
                </td>
              )}
              {matchLast && <td className="px-1.5 py-[7px] pe-5 text-end">{match(r)}</td>}
              {cfg.peak === "column" && (
                <td className="w-[84px] max-w-[84px] px-1.5 py-[7px] pe-4">
                  <PeakCell r={r} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-between px-5 py-2.5 text-xs text-cz-3">
        <span className="tabular-nums">Viser {RIDERS.length} ryttere · 6 af 6 valgt</span>
        <span className="flex gap-4 text-cz-2">
          <span>Ryd udtagelse</span>
          <span>Afmeld</span>
        </span>
      </div>
    </div>
  );
}

// --- Taktik: den fælles komponent med løbssiden v6 (ejervalg 1) ----------------------------

function StageTabs() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STAGES.map((s) => (
        <span
          key={s.n}
          className={`inline-flex items-center gap-1.5 rounded-cz border px-2.5 py-1 text-xs ${s.n === 1 ? "border-cz-1 bg-cz-subtle font-semibold text-cz-1" : "border-cz-border text-cz-2"}`}
        >
          <Glyph kind={s.kind} size={12} /> Etape {s.n}
          <span className={`font-data text-3xs uppercase tracking-wide ${s.tactic === "saved" ? "text-cz-success" : "text-cz-3"}`}>· {s.tactic === "saved" ? "Gemt" : "Standardplan"}</span>
        </span>
      ))}
    </div>
  );
}

function TacticsShared({ cfg, mobile }: { cfg: Config; mobile: boolean }) {
  const px = mobile ? "px-4" : "px-5";
  return (
    <div>
      <div className={`border-b border-cz-border ${px} py-2.5`}>
        <StageTabs />
      </div>
      <div className={`grid gap-3 border-b border-cz-border ${mobile ? "grid-cols-1" : "grid-cols-[1.6fr_1fr_1fr]"} ${px} py-3 text-xs`}>
        <div>
          <div className="font-data text-3xs uppercase tracking-wide text-cz-3">Holdplan · etape 1</div>
          <div className="mt-0.5 text-[13.5px] font-semibold text-cz-1">Spurt til Zhen Ren</div>
          <div className="mt-0.5 text-cz-2">Holdet holder feltet samlet og kører spurttog den sidste kilometer.</div>
        </div>
        <div>
          <div className="font-data text-3xs uppercase tracking-wide text-cz-3">Jagten på udbruddet</div>
          <div className="mt-1">
            <Seg options={["Jag", "Vurder", "Overlad"]} value="Jag" small />
          </div>
        </div>
        {!mobile && (
          <div>
            <div className="font-data text-3xs uppercase tracking-wide text-cz-3">Sprint-tog</div>
            <div className="mt-0.5 text-cz-1">Robbe Bos, Hajun Pyo</div>
          </div>
        )}
      </div>
      {!mobile && (
        <div className="grid grid-cols-[1.4fr_.8fr_3fr_48px] border-b border-cz-border bg-cz-subtle px-5 py-2 font-data text-3xs font-semibold uppercase tracking-[.08em] text-cz-3">
          <span>Rytter</span>
          <span>Rolle</span>
          <span>Plan for etape 1</span>
          <span />
        </div>
      )}
      {SELECTED.map((r) =>
        mobile ? (
          // v6-valg 15: kort pr. rytter, redigering i et ark.
          <div key={r.id} className="border-b border-cz-border px-4 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[14px] font-medium text-cz-1">
                <Flag code={r.nation} /> {r.name}
                <span className="rounded-cz border border-cz-border bg-cz-subtle px-1.5 py-0.5 text-2xs font-medium text-cz-1">{r.role}</span>
              </span>
              <span className="inline-flex min-h-[44px] items-center text-xs font-medium text-cz-1">Ændr</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-cz-2">
              {r.plan?.map(([t, e], i) => <PlanChip key={t + i} task={t} effort={e} />)}
            </div>
          </div>
        ) : (
          <div key={r.id} className="grid grid-cols-[1.4fr_.8fr_3fr_48px] items-center border-b border-cz-border px-5 py-2 text-[13px]">
            <span className="flex items-center gap-2 font-medium text-cz-1">
              <Flag code={r.nation} /> {r.name}
            </span>
            <span className="text-xs text-cz-1">{r.role}</span>
            <span className="flex flex-wrap gap-1.5">{r.plan?.map(([t, e], i) => <PlanChip key={t + i} task={t} effort={e} />)}</span>
            <span className="text-end text-xs font-medium text-cz-1">Ændr</span>
          </div>
        ),
      )}
      {cfg.save === "today" && (
        <div {...dev(cfg, 8, "Taktikken gemmes nederst i taktikken, mens hovedets guld siger Gem trup")} className={`flex items-center justify-between gap-2 ${px} py-3`}>
          <span className="text-xs text-cz-3">Ingen ugemte ændringer på etape 1</span>
          <span className="flex gap-2">
            {!mobile && <Btn>Kopiér til etape 2</Btn>}
            <Btn variant={cfg.squadDirty ? "secondary" : "primary"}>Gem etape 1</Btn>
          </span>
        </div>
      )}
    </div>
  );
}

function TacticsBlocked({ cfg }: { cfg: Config }) {
  return (
    <div {...dev(cfg, 8, "En ugemt trup skjuler hele taktikken (wireframen tegner ikke taktikken)")} className="px-5 py-10 text-center">
      <div className="mx-auto mb-2 inline-flex text-cz-3">{Ico.lock(24)}</div>
      <div className="text-[15px] font-semibold text-cz-1">Gem truppen for at sætte taktik</div>
      <div className="mt-1 text-[13px] text-cz-2">Taktikken bygger på den gemte trup. Du har 2 ugemte ændringer.</div>
    </div>
  );
}

function TacticsView({ cfg, mobile }: { cfg: Config; mobile: boolean }) {
  if (cfg.squadDirty && cfg.save === "today") return <TacticsBlocked cfg={cfg} />;
  return (
    <div>
      {cfg.squadDirty && (
        <div {...dev(cfg, 8, "Taktikken vises med den ugemte trup og gemmes sammen med den")} className={`border-b border-cz-border bg-cz-warning/10 ${mobile ? "px-4" : "px-5"} py-2 text-xs text-cz-1`}>
          Truppen har 2 ugemte ændringer. Taktikken viser kladden og gemmes sammen med den.
        </div>
      )}
      <TacticsShared cfg={cfg} mobile={mobile} />
    </div>
  );
}

// --- Formtop (punkt 6) ---------------------------------------------------------------

function PeakView({ cfg, mobile }: { cfg: Config; mobile: boolean }) {
  const linked = cfg.peak === "linked";
  const sorted = [...RIDERS].sort((a, b) => b.rating - a.rating);
  const groups: Array<[string | null, Rider[]]> = linked
    ? [
        ["I truppen · 6", sorted.filter((r) => r.selected)],
        ["Ikke udtaget", sorted.filter((r) => !r.selected)],
      ]
    : [[null, sorted]];
  const px = mobile ? "px-4" : "px-5";
  const cols = "grid-cols-[32px_1.5fr_.5fr_.5fr_.6fr_1.7fr_1fr]";
  return (
    <div {...(cfg.peak === "today" ? note(cfg, 6, "Wireframen har fanen Peak form, men tegner ikke dens indhold") : {})}>
      <p className={`m-0 border-b border-cz-border ${px} py-2 text-2xs text-cz-3`}>Formtop-mål: Tour de Preview, starter tirs. 17. nov. Kryds ryttere af og anvend.</p>
      {linked && mobile && (
        <div {...dev(cfg, 6, "Advarsel: formtop her, men rytteren er ikke udtaget")} className="flex items-center justify-between gap-2 border-b border-cz-border bg-cz-warning/10 px-4 py-2 text-xs text-cz-1">
          <span className="inline-flex items-start gap-1.5">
            <span className="mt-0.5 text-cz-warning">{Ico.alert(13)}</span> Ignacio Moreno har formtop her, men er ikke udtaget.
          </span>
          <Btn>Udtag</Btn>
        </div>
      )}
      {!mobile && (
        <div className={`grid ${cols} border-b border-cz-border bg-cz-subtle px-5 py-2 font-data text-3xs font-semibold uppercase tracking-[.08em] text-cz-3`}>
          <span />
          <span>Rytter</span>
          <span className="text-end">Rating</span>
          <span className="text-end">Form</span>
          <span className="text-end">Træthed</span>
          <span className="ps-4">Formtop-mål</span>
          <span className="text-end">Løbsstart</span>
        </div>
      )}
      {mobile && (
        <div className="grid grid-cols-[24px_1fr_36px_36px_88px] gap-1 border-b border-cz-border bg-cz-subtle px-4 py-2 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">
          <span />
          <span>Rytter</span>
          <span className="text-end">Rating</span>
          <span className="text-end">Form</span>
          <span {...(linked ? dev(cfg, 6, "Mobilens 3. kolonne er målets status") : {})} className="text-end">
            {linked ? "Mål" : "Træthed"}
          </span>
        </div>
      )}
      {groups.map(([label, rows]) => (
        <div key={label ?? "all"}>
          {label && (
            <div {...(label.startsWith("I truppen") ? dev(cfg, 6, "Udtagne ryttere øverst under I truppen") : {})} className={`border-b border-cz-border bg-cz-subtle ${px} py-1.5 font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-2`}>
              {label}
            </div>
          )}
          {rows.map((r) => {
            const warn = linked && r.peak?.here && !r.selected;
            const target = r.peak ? (
              <span className="flex flex-col">
                <span className={`text-xs ${r.peak.here ? "font-semibold text-cz-1" : "text-cz-2"}`}>{r.peak.here ? "Her: Tour de Preview" : r.peak.race}</span>
                <span className="text-3xs text-cz-3">Pris: {r.peak.cost}</span>
              </span>
            ) : (
              <span className="text-cz-3">–</span>
            );
            if (mobile) {
              const third = linked ? (
                warn ? (
                  <span className="inline-flex items-center gap-1 text-2xs font-semibold text-cz-warning">{Ico.alert(12)} Ikke udtaget</span>
                ) : r.peak ? (
                  <span className={`text-2xs ${r.peak.here ? "font-semibold text-cz-info" : "text-cz-2"}`}>{r.peak.here ? "Her" : r.peak.when.split(" · ")[1]}</span>
                ) : (
                  <span className="text-cz-3">–</span>
                )
              ) : (
                <span className="font-data tabular-nums text-cz-1">{r.fatigue}</span>
              );
              return (
                <div key={r.id} className={`grid grid-cols-[24px_1fr_36px_36px_88px] items-center gap-1 border-b border-cz-border px-4 py-2 text-[13px] ${warn ? "bg-cz-warning/10" : ""}`}>
                  <Check on={false} />
                  <span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-cz-1">
                    <Flag code={r.nation} /> {r.name}
                  </span>
                  <span className="text-end font-data tabular-nums">{r.rating}</span>
                  <span className="text-end font-data tabular-nums">{r.form}</span>
                  <span className="text-end">{third}</span>
                </div>
              );
            }
            return (
              <div key={r.id}>
                <div className={`grid ${cols} items-center border-b border-cz-border px-5 py-[7px] text-[13px] ${warn ? "bg-cz-warning/10" : ""}`}>
                  <Check on={false} />
                  <span className="flex items-center gap-2">
                    <Flag code={r.nation} />
                    <span className="font-medium text-cz-1">{r.name}</span>
                  </span>
                  <span className="text-end font-data tabular-nums">{r.rating}</span>
                  <span className="text-end font-data tabular-nums">{r.form}</span>
                  <span className="text-end font-data tabular-nums">{r.fatigue}</span>
                  <span className="ps-4">{target}</span>
                  <span className="text-end text-xs text-cz-2">{r.peak ? r.peak.when : "–"}</span>
                </div>
                {warn && (
                  <div {...dev(cfg, 6, "Advarsel når formtoppen rammer et løb, rytteren ikke er udtaget til")} className="flex items-center justify-between gap-3 border-b border-cz-border bg-cz-warning/10 px-5 py-2 ps-[52px] text-xs text-cz-1">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-cz-warning">{Ico.alert(13)}</span> Formtoppen rammer Tour de Preview, men han er ikke udtaget. Uden løbet går den til spilde.
                    </span>
                    <Btn>Udtag til løbet</Btn>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      <div className={`${px} py-2.5 text-xs text-cz-3`}>14 ryttere · højst 2 formtoppe pr. rytter</div>
    </div>
  );
}

// --- Fælles gem-bjælke (8C) -------------------------------------------------------------

function SaveBar({ cfg, mobile }: { cfg: Config; mobile: boolean }) {
  return (
    <div {...dev(cfg, 8, "Fælles gem-bjælke nederst med trup og taktik (wireframen: Save squad i hovedet)")} className={`border-t border-cz-border bg-cz-card ${mobile ? "px-4 py-3" : "ms-[208px] px-8 py-3"}`}>
      <div className={`mx-auto flex max-w-[1600px] items-center justify-between gap-3 ${mobile ? "flex-col items-stretch" : ""}`}>
        <span className="text-[13px] text-cz-1">
          <span className="font-semibold">Ugemte ændringer:</span> trup (2 skift) · taktik etape 1
        </span>
        <span className="flex gap-2">
          <Btn variant="ghost">{Ico.undo(13)} Fortryd</Btn>
          <Btn variant="primary" full={mobile}>
            Gem alt
          </Btn>
        </span>
      </div>
    </div>
  );
}

// --- Arbejdsfladen (pc) ------------------------------------------------------------------

function ViewBody({ cfg, mobile }: { cfg: Config; mobile: boolean }) {
  if (cfg.view === "tactics") return <TacticsView cfg={cfg} mobile={mobile} />;
  if (cfg.view === "peak") return <PeakView cfg={cfg} mobile={mobile} />;
  return mobile ? <MobileSquad cfg={cfg} /> : <SquadTable cfg={cfg} />;
}

function Workbench({ cfg }: { cfg: Config }) {
  const switchInHead = cfg.head === "compact";
  return (
    <section id="workbench" className="min-w-0 rounded-cz border border-cz-border bg-cz-card">
      {cfg.head === "wireframe" || cfg.head === "folded" ? <RaceHeadWF cfg={cfg} /> : <RaceHeadR3 cfg={cfg} sticky={switchInHead} />}
      <ProfileBlock cfg={cfg} mobile={false} />
      {!switchInHead && (
        <div id="view-switch" className="flex items-center justify-between border-b border-cz-border px-5 py-2.5">
          <Seg options={["Trup", "Taktik", "Formtop"]} value={VIEW_LABEL[cfg.view]} />
          <span className="text-xs text-cz-3">{VIEW_HINT[cfg.view]}</span>
        </div>
      )}
      <ViewBody cfg={cfg} mobile={false} />
    </section>
  );
}

export function DesktopPage({ cfg }: { cfg: Config }) {
  return (
    <div className="relative min-h-screen bg-cz-body">
      <Sidebar />
      <main className="ms-[208px] px-8 pb-10 pt-7">
        <div className="mx-auto max-w-[1600px]">
          <PageHead />
          <WeekBoard />
          <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-4">
            <RaceList />
            <Workbench cfg={cfg} />
          </div>
        </div>
      </main>
      {cfg.save === "bar" && <SaveBar cfg={cfg} mobile={false} />}
    </div>
  );
}

// --- Mobil (390): kompakt ark (ejervalg 2) --------------------------------------------------

function AppBar() {
  return (
    <div className="flex h-12 items-center justify-between bg-cz-sidebar px-4 text-cz-sidebar-1">
      {Ico.menu(20)}
      <span className="font-display text-base tracking-wide text-cz-accent">CYCLING ZONE</span>
      {Ico.bell(18)}
    </div>
  );
}

function MobileSquad({ cfg }: { cfg: Config }) {
  const rows = [...RIDERS].sort((a, b) => Number(b.selected) - Number(a.selected) || b.routeMatch - a.routeMatch);
  const top = Math.max(...RIDERS.map((r) => r.routeMatch));
  const third = cfg.after === "finish" ? "Ved mål" : cfg.after === "none" ? "Træthed" : "Efter løbet";
  const cols = "grid-cols-[22px_1fr_58px_34px_60px]";
  const rich = cfg.table === "status" || cfg.table === "roleChip";
  return (
    <div id="squad-table">
      {/* D-047: kolonnevalg som chips + "Fuld tabel"; ejer 16/11: kolonneoverskrifter og kortets radius. */}
      <div className="flex items-center gap-1.5 overflow-hidden border-b border-cz-border px-4 py-2">
        <span className="font-data text-3xs uppercase tracking-wide text-cz-3">Kolonner</span>
        <Chip active>Match</Chip>
        <Chip active>Form</Chip>
        <Chip active>{third}</Chip>
        <span className="ms-auto inline-flex min-h-[44px] shrink-0 items-center gap-1 text-xs font-medium text-cz-1">
          {Ico.table(13)} Fuld tabel
        </span>
      </div>
      <div className={`grid ${cols} items-center gap-1 border-b border-cz-border bg-cz-subtle px-4 py-2 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3`}>
        <span />
        <span>Rytter</span>
        <span {...(rich ? dev(cfg, 7, "Rutematch som neutral bjælke med tal") : cfg.table === "today" ? dev(cfg, 7, "Rutematch i guld fra en vis værdi (wireframen: kun den bedste)") : {})} className="text-end">
          Match
        </span>
        <span className="text-end">Form</span>
        <span
          {...(cfg.after === "finish" ? dev(cfg, 5, "Træthed ved mål: nu + løbets tillæg (wireframen: Efter løbet)") : cfg.after === "none" ? dev(cfg, 5, "Efter løbet er fjernet; 3. kolonne er træthed nu") : {})}
          className="text-end"
        >
          {third}
        </span>
      </div>
      {rows.map((r) => {
        const sub: ReactNode[] = [];
        if (r.selected)
          sub.push(
            <span key="role" {...(cfg.table === "roleChip" && r.id === "r1" ? dev(cfg, 7, "Rollen som chip, fælles med taktik") : {})} className="inline-flex items-center gap-0.5 rounded-cz border border-cz-border bg-cz-subtle px-1.5 text-cz-1">
              {r.role} {cfg.table === "roleChip" && Ico.chevD(10)}
            </span>,
          );
        else sub.push(<span key="type">{r.type}</span>);
        if (r.injured) sub.push(<span key="inj" className="text-cz-danger">Skadet</span>);
        if (r.busy) sub.push(<span key="busy">{r.busy}</span>);
        if (r.u23) sub.push(<span key="u23" className="font-semibold text-cz-info">U23</span>);
        if (rich && r.peak?.here)
          sub.push(
            <span key="pk" {...(r.id === "r4" ? dev(cfg, 7, "Formtop her og prisen i ord under navnet") : {})} className="text-cz-info">
              Formtop her · {r.peak.cost}
            </span>,
          );
        if (cfg.peak === "column" && r.peak?.here && !r.selected)
          sub.push(
            <span key="pkw" {...dev(cfg, 6, "Formtop her, ikke udtaget (wireframen: kun fanen Formtop)")} className="font-semibold text-cz-warning">
              Formtop her, ikke udtaget
            </span>,
          );
        // Codex P2 16/11: 6C mobil viser formtop for ALLE ryttere med et mål, som desktop (PeakCell).
        if (cfg.peak === "column" && r.peak?.here && r.selected && !rich)
          sub.push(
            <span key="pkh" className="inline-flex items-center gap-0.5 font-semibold text-cz-info">
              {Ico.peak(11)} Formtop her
            </span>,
          );
        if (cfg.peak === "column" && r.peak && !r.peak.here)
          sub.push(
            <span key="pko" className="text-cz-2">
              Formtop {r.peak.race.split(" ").slice(-1)[0]} · {r.peak.when.split(" · ")[1]}
            </span>,
          );
        const matchEl = rich ? (
          <MatchBar value={r.routeMatch} narrow />
        ) : (
          <span className={`font-data text-[13px] tabular-nums ${(cfg.table === "today" ? r.routeMatch >= 60 : r.routeMatch === top) ? "font-semibold text-cz-accent-t" : "text-cz-1"}`}>{r.routeMatch}</span>
        );
        return (
          <div key={r.id} className={`grid ${cols} items-center gap-1 border-b border-cz-border px-4 py-[7px] ${r.selected ? "bg-cz-accent/[.04]" : ""}`}>
            <Check on={r.selected} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 truncate text-[14px] font-medium text-cz-1">
                <Flag code={r.nation} /> {r.name}
              </span>
              <span className="flex flex-wrap items-center gap-x-1.5 text-2xs text-cz-3">{sub}</span>
            </span>
            <span className="text-end">{matchEl}</span>
            <span className="text-end font-data text-[13px] tabular-nums">{r.form}</span>
            <span className="text-end font-data text-[13px] tabular-nums">
              {cfg.after === "finish" ? (
                <>
                  {r.fatigue + r.finishDelta}
                  <span className="text-3xs text-cz-warning"> +{r.finishDelta}</span>
                </>
              ) : cfg.after === "none" ? (
                r.fatigue
              ) : (
                `~${r.fatigue + r.finishDelta}`
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MobileSheet({ cfg }: { cfg: Config }) {
  const s = saveLabel(cfg);
  return (
    <div className="bg-cz-card" id="sheet-top">
      <div className="flex justify-center pt-2">
        <span className="h-1 w-10 rounded-cz bg-cz-border-strong" />
      </div>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="inline-flex h-11 w-11 items-center justify-center text-cz-2">{Ico.chevL(18)}</span>
        <span className="text-center">
          <span className="block text-[16px] font-semibold text-cz-1">{RACE.name}</span>
          <span className="font-data text-3xs tabular-nums text-cz-3">3 af 6</span>
        </span>
        <span className="flex text-cz-2">
          <span className="inline-flex h-11 w-11 items-center justify-center">{Ico.chevR(18)}</span>
          <span className="inline-flex h-11 w-11 items-center justify-center">{Ico.x(18)}</span>
        </span>
      </div>
      {/* Ejervalg 2: Trup/Taktik/Formtop står fast øverst. */}
      <div id="view-switch" className="sticky top-0 z-10 border-y border-cz-border bg-cz-card px-4 py-2">
        <Seg options={["Trup", "Taktik", "Formtop"]} value={VIEW_LABEL[cfg.view]} full />
      </div>
      <div className="border-b border-cz-border px-4 py-2 text-xs text-cz-2">
        <div className="font-data text-3xs uppercase tracking-wide text-cz-3">Tirs. 17. nov., 12.00 · ProSeries · 4 etaper · 6 af 6</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-4">
          <span className="inline-flex min-h-[44px] items-center font-medium text-cz-1">Kopiér trup</span>
          <span className="inline-flex min-h-[44px] items-center font-medium text-cz-1">Foreslå trup</span>
          {/* 8B: hovedets guld følger visningen, også på mobil (øverst, ikke i bunden). */}
          {cfg.save === "follows" && (
            <span className="ms-auto">
              <SaveButton cfg={cfg} />
            </span>
          )}
        </div>
      </div>
      <ProfileBlock cfg={cfg} mobile />
      <ViewBody cfg={cfg} mobile />
      {cfg.save === "bar" ? (
        <SaveBar cfg={cfg} mobile />
      ) : (
        s &&
        cfg.save !== "follows" && (
          <div className="border-t border-cz-border bg-cz-card px-4 py-3">
            <SaveButton cfg={cfg} full />
          </div>
        )
      )}
    </div>
  );
}

export function MobilePage({ cfg }: { cfg: Config }) {
  return (
    <div className="min-h-screen bg-cz-body">
      <AppBar />
      <div className="h-3 bg-cz-sidebar/60" />
      <MobileSheet cfg={cfg} />
    </div>
  );
}

