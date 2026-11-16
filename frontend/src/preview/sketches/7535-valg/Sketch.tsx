// #7535 valg-skitser: planlægningssiden (T2) tegnet efter én konfiguration pr. variant.
// Grundlaget er runde 3 (#8216) med ret data: "Taktik gjort klar" (tactics_ready_7864) er
// tændt, så Taktik-visningen er den nye etapeplan, og truppen kommer fra data.ts i alle
// visninger. Kun billeder; siden kører ikke fra appen, ingen backend, intet login.
import type { ReactNode } from "react";
import { LIST, RACE, RIDERS, SELECTED, STAGES, WEEK, listCounts, type ListRace, type Rider } from "./data.ts";
import type { Config } from "./variants.ts";
import { Badge, Btn, Chip, Flag, Glyph, Ico, MatchBar, Plan, Profile, Seg } from "./parts.tsx";

const VIEW_LABEL = { squad: "Trup", tactics: "Taktik", peak: "Formtop" } as const;
/** Gem-bjælker er faste i bunden; i et helsides billede står de i stedet sidst på siden. */
const barPos = () => (document.documentElement.dataset.full === "1" ? "relative" : "fixed");
const VIEW_HINT = { squad: "Udtag ryttere og giv dem en rolle · alle kolonner sorterer", tactics: "Samme taktik og samme gem som på løbssiden", peak: "Kryds ryttere af og anvend formtoppen på løbet" } as const;

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
      <div className="sticky px-4 py-6" style={{ top: "var(--cap)" }}>
      <div className="mb-6 text-center font-display text-2xl tracking-wide text-cz-accent">CYCLING ZONE</div>
      <div className="mb-5 border-b border-cz-sidebar-border pb-4">
        <div className="font-data text-3xs uppercase tracking-wide text-cz-sidebar-3">Balance</div>
        <div className="font-data text-base font-semibold tabular-nums text-cz-accent">500.000 CZ$</div>
        <div className="text-2xs text-cz-sidebar-3">Division 2</div>
      </div>
      {groups.map(([g, items]) => (
        <div key={g} className="mb-3">
          <div className="flex items-center justify-between font-data text-3xs font-semibold uppercase tracking-[.12em] text-cz-sidebar-3">
            {g} {Ico.chevD(12)}
          </div>
          {items.map((it) => (
            <div key={it} className={`mt-1.5 rounded-cz px-2 py-1.5 text-[13px] ${it === "Planlægning" ? "bg-cz-sidebar-hover text-cz-accent" : "text-cz-sidebar-2"}`}>
              {it}
            </div>
          ))}
        </div>
      ))}
      </div>
    </aside>
  );
}

function PageHead({ mobile }: { mobile: boolean }) {
  return (
    <div className={`flex ${mobile ? "flex-col gap-3" : "items-start justify-between"} mb-4`}>
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

function WeekBoard({ mobile }: { mobile: boolean }) {
  const days = mobile ? WEEK.slice(0, 3) : WEEK;
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
      <div className="relative grid px-2 pb-3 pt-2" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))` }}>
        {days.map((d) => (
          <div key={d.date} className="border-s border-cz-border px-2 first:border-s-0">
            <div className="font-data text-3xs uppercase tracking-wide text-cz-3">
              {d.day} {d.date}
            </div>
          </div>
        ))}
        {days.map((d, i) =>
          d.races.map((r, j) => (
            <div
              key={r.name}
              className={`mx-1 mt-1.5 flex items-center justify-between gap-2 truncate rounded-cz border px-2 py-1 text-xs ${
                r.active ? "border-cz-1 bg-cz-subtle" : "border-cz-border bg-cz-card"
              }`}
              style={{ gridColumn: `${i + 1} / span ${Math.min(r.span, days.length - i)}`, gridRow: j + 2, borderInlineStartWidth: 3, borderInlineStartColor: r.ok ? "var(--color-cz-success)" : "var(--color-cz-warning)" }}
            >
              <span className="truncate font-semibold text-cz-1">{r.name}</span>
              <span className="font-data text-3xs tabular-nums text-cz-3">{r.picked}</span>
            </div>
          )),
        )}
      </div>
    </section>
  );
}

// --- Punkt 3: løbslisten -----------------------------------------------------------

const TACTIC_WORD: Record<ListRace["tactic"], string> = { saved: "Gemt", partial: "1 af 4 gemt", default: "Standardplan", unsaved: "Ikke gemt" };
const TACTIC_TONE: Record<ListRace["tactic"], string> = { saved: "bg-cz-success", partial: "bg-cz-warning", default: "bg-cz-3", unsaved: "bg-cz-danger" };

function RaceStatus({ r, mode }: { r: ListRace; mode: Config["status"] }) {
  const missing = r.size - r.picked;
  if (mode === "single") {
    const ok = missing === 0 && r.tactic !== "unsaved" && r.tactic !== "partial";
    return <Badge tone={ok ? "won" : "closing"}>{ok ? "Klar" : missing > 0 ? "Mangler trup" : "Mangler taktik"}</Badge>;
  }
  return <Badge tone={missing === 0 ? "won" : "closing"}>{missing === 0 ? "Klar" : `${missing} mangler`}</Badge>;
}

function RaceList({ mode, mobile }: { mode: Config["status"]; mobile: boolean }) {
  const counts = listCounts();
  return (
    <section className={`overflow-hidden rounded-cz border border-cz-border bg-cz-card ${mobile ? "" : "self-start"}`}>
      <div className="flex items-center justify-between gap-2 border-b border-cz-border px-3 py-2.5">
        <Seg options={["Næste 7 dage", "Hele sæsonen"]} value="Næste 7 dage" small />
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-cz-1">Handlinger {Ico.chevD(12)}</span>
      </div>
      <div className="flex items-center gap-1.5 whitespace-nowrap border-b border-cz-border bg-cz-subtle px-3 py-2 font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-2">
        {Ico.chevD(11)}
        {mode === "full" ? (
          <span>
            Uge 47 · {counts.squad} mangler trup · {counts.tactic} mangler taktik
          </span>
        ) : (
          <span>Uge 47 · 6 løb · {counts.squad} mangler</span>
        )}
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
            {mode === "full" ? (
              <span className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={r.picked === r.size ? "won" : "closing"}>{r.picked === r.size ? `Trup ${r.picked}/${r.size}` : `${r.size - r.picked} mangler`}</Badge>
              </span>
            ) : (
              <RaceStatus r={r} mode={mode} />
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1">
            {r.stages.map((k, i) => (
              <Glyph key={i} kind={k} size={15} />
            ))}
          </div>
          {mode === "full" && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-cz-2">
              <span className="inline-flex items-center gap-1.5">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${TACTIC_TONE[r.tactic]}`} />
                Taktik: <span className="font-medium text-cz-1">{TACTIC_WORD[r.tactic]}</span>
              </span>
              {r.peakRiders ? (
                <span className="inline-flex items-center gap-1 text-cz-info">
                  {Ico.peak(13)} Formtop · {r.peakRiders} {r.peakRiders === 1 ? "rytter" : "ryttere"}
                </span>
              ) : null}
            </div>
          )}
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

// --- Løbshoved og ruteprofil -------------------------------------------------------

function saveLabel(cfg: Config): { text: string; gold: boolean } | null {
  // Hvad løbshovedets knap siger og om den er sidens ene guld.
  if (cfg.save === "bar") return null;
  if (cfg.view === "tactics") {
    if (cfg.save === "follows") return { text: cfg.squadDirty ? "Gem trup og sæt taktik" : "Gem etape 1", gold: true };
    if (cfg.save === "today" && cfg.squadDirty) return { text: "Gem trup", gold: true };
    return { text: "Gem trup", gold: false };
  }
  if (cfg.view === "peak") return { text: "Anvend på valgte (0)", gold: true };
  return { text: "Gem trup", gold: cfg.squadDirty };
}

function RaceHead({ cfg, mobile }: { cfg: Config; mobile: boolean }) {
  const s = saveLabel(cfg);
  const compact = cfg.head !== "today";
  const switcher = <Seg options={["Trup", "Taktik", "Formtop"]} value={VIEW_LABEL[cfg.view]} />;
  if (mobile) return null;
  return (
    <div className={`border-b border-cz-border bg-cz-card px-5 ${compact ? "sticky z-10 py-3" : "py-4"}`} style={compact ? { top: "var(--cap)" } : undefined}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="m-0 text-[17px] font-semibold text-cz-1">{RACE.name}</h2>
          <p className="m-0 mt-0.5 font-data text-3xs uppercase tracking-wide text-cz-3">
            {RACE.meta} · {cfg.squadDirty ? "6 af 6 valgt · 2 ændringer" : "6 af 6 valgt"}
          </p>
          {!compact && <p className="m-0 mt-1 text-2xs text-cz-warning">{RACE.shares}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {compact && switcher}
          <Btn variant="ghost">{Ico.copy(13)} Kopiér trup fra…</Btn>
          <Btn variant="ghost">{Ico.spark(13)} Foreslå trup</Btn>
          {s && (
            <Btn variant={s.gold ? "primary" : "secondary"} disabled={!s.gold && cfg.save === "today" && cfg.view !== "tactics"}>
              {s.text}
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

function StageStrip({ mobile }: { mobile: boolean }) {
  // Lille profil (4B): løbssidens v6-etapestribe, ét kort pr. etape med lav profil og status.
  return (
    <div className={`grid gap-0 border-b border-cz-border ${mobile ? "grid-cols-4" : "grid-cols-4"}`}>
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
          <Profile kind={s.kind} height={mobile ? 16 : 22} mini axis={false} />
          {!mobile && <div className="truncate text-2xs text-cz-3">{s.tactic === "saved" ? "Taktik gemt" : "Standardplan"}</div>}
        </div>
      ))}
    </div>
  );
}

function FullProfile({ mobile }: { mobile: boolean }) {
  return (
    <div className={`border-b border-cz-border ${mobile ? "px-4 py-3" : "px-5 py-4"}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="rounded-cz border border-cz-border p-1 text-cz-3">{Ico.chevL(14)}</span>
          <span className="rounded-cz border border-cz-border p-1 text-cz-1">{Ico.chevR(14)}</span>
          <span className="font-semibold text-cz-1">Etape 1 af 4</span>
          <span className="flex gap-1">
            {STAGES.map((s) => (
              <span key={s.n} className={`inline-block h-2 w-2 ${s.n === 1 ? "bg-cz-accent" : "bg-cz-border"}`} />
            ))}
          </span>
        </div>
        {!mobile && (
          <span className="flex gap-4 text-xs text-cz-2">
            <span>Vis fuld profil</span>
            <span className="inline-flex items-center gap-1">{Ico.chevU(12)} Skjul profil</span>
          </span>
        )}
      </div>
      <div className="mb-2 flex items-end justify-between gap-3">
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
          <span className="font-semibold text-cz-1">Mål</span> <span className="text-cz-3">km 190</span>
        </span>
        <span className="text-cz-2">På spil: 50 pointtrøje-point · +10 s</span>
      </div>
    </div>
  );
}

function FoldedProfile() {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-cz-border px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-3 text-xs text-cz-2">
        {STAGES.map((s) => (
          <span key={s.n} className="inline-flex items-center gap-1.5">
            <span className="font-semibold text-cz-1">{s.n}</span>
            <Glyph kind={s.kind} size={13} />
            {s.label} <span className="font-data tabular-nums text-cz-3">{s.km} km</span>
          </span>
        ))}
      </div>
      <span className="inline-flex items-center gap-1 text-xs text-cz-accent-t">
        Vis profil {Ico.chevD(12)}
      </span>
    </div>
  );
}

// --- Trup-visningen (punkt 5, 6C, 7) ---------------------------------------------------

function StatusCell({ r, cfg }: { r: Rider; cfg: Config }) {
  if (r.injured) return <span className="text-2xs font-semibold leading-tight text-cz-danger">{r.injured}</span>;
  if (r.busy) return <span className="whitespace-nowrap rounded-cz border border-cz-border px-1.5 py-0.5 text-2xs text-cz-2">{r.busy}</span>;
  if ((cfg.table === "status" || cfg.table === "roleChip") && r.peak?.here)
    return (
      <span className="flex flex-col">
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-2xs font-semibold text-cz-info">{Ico.peak(12)} Formtop her</span>
        <span className="text-3xs leading-tight text-cz-3">Pris: {r.peak.cost}</span>
      </span>
    );
  if ((cfg.table === "status" || cfg.table === "roleChip") && r.peak)
    return <span className="whitespace-nowrap text-2xs text-cz-3">Formtop i {r.peak.race.split(" ").slice(-1)[0]}</span>;
  if (r.u23) return <span className="rounded-cz bg-cz-info/10 px-1.5 py-0.5 font-data text-3xs font-semibold text-cz-info">U23</span>;
  return <span className="text-cz-3">–</span>;
}

function RoleCell({ r, cfg }: { r: Rider; cfg: Config }) {
  if (!r.selected) return <span className="text-cz-3">–</span>;
  if (cfg.table === "roleChip")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-cz-border px-2.5 py-0.5 text-xs font-medium text-cz-1">
        {r.role} {Ico.chevD(11)}
      </span>
    );
  return (
    <span className="inline-flex w-[118px] items-center justify-between rounded-cz border border-cz-border bg-cz-card px-2 py-1 text-xs text-cz-1">
      {r.role} {Ico.chevD(12)}
    </span>
  );
}

function AfterCell({ r, cfg }: { r: Rider; cfg: Config }) {
  if (cfg.after === "finish") {
    const end = r.fatigue + r.finishDelta;
    return (
      <span className="inline-flex items-center gap-2">
        <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-cz-border">
          <span className="absolute inset-y-0 start-0 bg-cz-3" style={{ width: `${r.fatigue}%` }} />
          <span className="absolute inset-y-0 bg-cz-warning" style={{ left: `${r.fatigue}%`, width: `${r.finishDelta}%` }} />
        </span>
        <span className="font-data text-xs tabular-nums text-cz-1">{end}</span>
        <span className="font-data text-3xs tabular-nums text-cz-warning">+{r.finishDelta}</span>
      </span>
    );
  }
  const v = r.fatigue + r.finishDelta;
  return <span className={`font-data text-xs tabular-nums ${v >= 60 ? "text-cz-warning" : "text-cz-1"}`}>~{v}</span>;
}

function PeakCell({ r }: { r: Rider }) {
  if (!r.peak) return <span className="text-cz-3">–</span>;
  if (r.peak.here && !r.selected)
    return (
      <span className="inline-flex items-center gap-1 text-2xs font-semibold text-cz-warning">
        {Ico.alert(12)} Her, ikke udtaget
      </span>
    );
  if (r.peak.here) return <span className="inline-flex items-center gap-1 text-2xs font-semibold text-cz-info">{Ico.peak(12)} Her</span>;
  return <span className="text-2xs text-cz-2">{r.peak.race.split(" ").slice(-1)[0]} · {r.peak.when.split(" · ")[1]}</span>;
}

function Check({ on }: { on: boolean }) {
  return (
    <span className={`inline-flex h-4 w-4 items-center justify-center rounded-[3px] border ${on ? "border-cz-accent bg-cz-accent text-cz-on-accent" : "border-cz-border-strong bg-cz-card"}`}>
      {on && Ico.check(11)}
    </span>
  );
}

function Th({ children, end = false, sort = false }: { children: ReactNode; end?: boolean; sort?: boolean }) {
  return (
    <th className={`whitespace-nowrap px-2 py-2 font-data text-3xs font-semibold uppercase tracking-[.08em] text-cz-3 ${end ? "text-end" : "text-start"}`}>
      {children}
      {sort && <span className="ms-0.5 inline-block align-middle">{Ico.chevD(10)}</span>}
    </th>
  );
}

function SquadTable({ cfg }: { cfg: Config }) {
  const rows = [...RIDERS].sort((a, b) => Number(b.selected) - Number(a.selected) || b.routeMatch - a.routeMatch);
  const afterLabel = cfg.after === "finish" ? "Træthed ved mål" : "Efter løbet";
  return (
    <div id="squad-table">
      <p className="m-0 border-b border-cz-border px-5 py-2 text-2xs text-cz-3">
        Rute-match: gennemsnit for hele løbet på tværs af etaperne. Form nu: aktuel form, ikke en prognose.
        {cfg.after === "today" && " Efter løbet: forventet træthed efter sidste etape ved normal indsats."}
        {cfg.after === "finish" && " Træthed ved mål: nu + hvad løbet lægger oven i."}
      </p>
      <table data-sort-exempt="skitse: statisk billede, ingen rigtig sortering" className="w-full border-collapse text-[13px]">
        <thead className="border-b border-cz-border bg-cz-subtle">
          <tr>
            <Th>{""}</Th>
            <Th sort>Rytter</Th>
            <Th>Status</Th>
            <Th>Rolle</Th>
            <Th end sort>Rating</Th>
            <Th end sort>Rutematch</Th>
            <Th end sort>Form</Th>
            <Th end sort>Træthed</Th>
            {cfg.after !== "none" && <Th end sort>{afterLabel}</Th>}
            {cfg.peak === "column" && <Th>Formtop</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`border-b border-cz-border ${r.selected ? "bg-cz-accent/[.04]" : ""}`}>
              <td className="w-8 px-2 py-[7px] ps-5">
                <Check on={r.selected} />
              </td>
              <td className="px-2 py-[7px]">
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <Flag code={r.nation} />
                  <span className="font-medium text-cz-1">{r.name}</span>
                </span>
              </td>
              <td className="w-[130px] max-w-[130px] px-2 py-[7px]">
                <StatusCell r={r} cfg={cfg} />
              </td>
              <td className="px-2 py-[7px]">
                <RoleCell r={r} cfg={cfg} />
              </td>
              <td className="px-2 py-[7px] text-end font-data tabular-nums text-cz-1">{r.rating}</td>
              <td className="px-2 py-[7px] text-end">
                {cfg.table === "today" ? (
                  <span className={`font-data tabular-nums ${r.routeMatch >= 60 ? "font-semibold text-cz-accent-t" : "text-cz-1"}`}>{r.routeMatch}</span>
                ) : (
                  <MatchBar value={r.routeMatch} />
                )}
              </td>
              <td className="px-2 py-[7px] text-end font-data tabular-nums text-cz-1">{r.form}</td>
              <td className="px-2 py-[7px] text-end font-data tabular-nums text-cz-1">{r.fatigue}</td>
              {cfg.after !== "none" && (
                <td className="px-2 py-[7px] pe-5 text-end">
                  <AfterCell r={r} cfg={cfg} />
                </td>
              )}
              {cfg.peak === "column" && (
                <td className="px-2 py-[7px] pe-5">
                  <PeakCell r={r} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-between px-5 py-2.5 text-xs text-cz-3">
        <span>Viser {RIDERS.length} ryttere · 6 af 6 valgt</span>
        <span className="flex gap-4 text-cz-2">
          <span>Ryd udtagelse</span>
          <span>Afmeld</span>
        </span>
      </div>
    </div>
  );
}

// --- Taktik-visningen (punkt 1 og 8) ---------------------------------------------------

const INTENTS = [
  ["Kør for klassementet med Nebiyu Berhane", "Alle kører for klassementsrytteren og holder ham ude af problemer."],
  ["Etapesejr til Nebiyu Berhane", "Holdet kører for den rytter, der passer bedst til dagens rute."],
  ["Spurt til Zhen Ren", "Holdet sparer spurteren til målet og kører spurttog den sidste kilometer."],
  ["Gå i udbrud", "To ryttere prøver at komme i udbrud. Resten kører roligt."],
  ["Spar benene", "Alle kører roligt i mål. Mindst træthed i aften."],
];

function StageTabs({ status = false }: { status?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STAGES.map((s) => (
        <span
          key={s.n}
          className={`inline-flex items-center gap-1.5 rounded-cz border px-2.5 py-1 text-xs ${s.n === 1 ? "border-cz-accent/50 bg-cz-accent/10 text-cz-accent-t" : "border-cz-border text-cz-2"}`}
        >
          <Glyph kind={s.kind} size={12} /> Etape {s.n}
          {status && <span className={`font-data text-3xs uppercase tracking-wide ${s.tactic === "saved" ? "text-cz-success" : "text-cz-3"}`}>· {s.tactic === "saved" ? "Gemt" : "Standardplan"}</span>}
        </span>
      ))}
    </div>
  );
}

function TacticsRaceTab({ cfg, mobile }: { cfg: Config; mobile: boolean }) {
  // Løbssidens taktik-fane (#7864, tændt for alle): intention, holdplan, etapeplan og ét gem.
  return (
    <div>
      <div className={`flex items-center justify-between gap-3 border-b border-cz-border bg-cz-subtle ${mobile ? "px-4" : "px-5"} py-2.5`}>
        <StageTabs />
        {!mobile && <span className="text-xs text-cz-3">Fladt. Intet valgt betyder, at han kører rollens standard.</span>}
      </div>
      <div className={`grid gap-2 border-b border-cz-border ${mobile ? "grid-cols-1 px-4" : "grid-cols-5 px-5"} py-3`}>
        {(mobile ? INTENTS.slice(2, 4) : INTENTS).map(([t, d]) => (
          <div key={t} className={`rounded-cz border p-3 ${t.startsWith("Spurt") ? "border-cz-accent text-cz-accent-t" : "border-cz-border"}`}>
            <div className={`text-[13px] font-semibold ${t.startsWith("Spurt") ? "text-cz-accent-t" : "text-cz-1"}`}>{t}</div>
            {!mobile && <div className="mt-1 text-2xs text-cz-2">{d}</div>}
          </div>
        ))}
      </div>
      <div className={`grid gap-4 border-b border-cz-border ${mobile ? "grid-cols-1 px-4" : "grid-cols-3 px-5"} py-3 text-xs`}>
        <div>
          <div className="font-data text-3xs uppercase tracking-wide text-cz-3">Holdplan</div>
          <div className="mt-1 text-cz-1">Zhen Ren er spurtkaptajn. Holdet holder feltet samlet til spurten.</div>
        </div>
        <div>
          <div className="font-data text-3xs uppercase tracking-wide text-cz-3">Jagten på udbruddet</div>
          <div className="mt-1">
            <Seg options={["Jag", "Vurder undervejs", "Overlad til andre"]} value="Jag" small />
          </div>
        </div>
        {!mobile && (
          <div>
            <div className="font-data text-3xs uppercase tracking-wide text-cz-3">Sprint-tog</div>
            <div className="mt-1 text-cz-1">Robbe Bos og Hajun Pyo kører toget for Zhen Ren.</div>
          </div>
        )}
      </div>
      <div className={`border-b border-cz-border ${mobile ? "px-4" : "px-5"} py-2 text-2xs text-cz-3`}>
        <span className="font-data uppercase tracking-wide">Etapeplan</span> · hver rytter får en kort plan langs ruten.
      </div>
      <PlanRows mobile={mobile} />
      {cfg.save !== "bar" && cfg.save !== "follows" && (
        <div className={`flex items-center justify-between gap-2 ${mobile ? "px-4" : "px-5"} py-3`}>
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

function PlanRows({ mobile, compact = false }: { mobile: boolean; compact?: boolean }) {
  return (
    <div>
      {!mobile && (
        <div className={`grid border-b border-cz-border px-5 py-2 font-data text-3xs font-semibold uppercase tracking-[.08em] text-cz-3 ${compact ? "grid-cols-[1.4fr_.9fr_.7fr_2fr_1fr_40px]" : "grid-cols-[1.4fr_.9fr_.8fr_2.4fr_40px]"}`}>
          <span>Rytter</span>
          <span>Rolle</span>
          <span>Rutematch · e1</span>
          <span>Plan for etape 1</span>
          {compact && <span>Pris</span>}
          <span />
        </div>
      )}
      {SELECTED.map((r) =>
        mobile ? (
          <div key={r.id} className="border-b border-cz-border px-4 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[13.5px] font-medium text-cz-1">
                <Flag code={r.nation} /> {r.name}
              </span>
              <span className="text-xs text-cz-accent-t">Ændr</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-cz-2">
              <span className="rounded-full border border-cz-border px-2 py-0.5 text-2xs font-medium text-cz-1">{r.role}</span>
              {r.plan && <Plan plan={r.plan} />}
            </div>
            {compact && <div className="mt-1 text-2xs text-cz-3">{r.planCost}</div>}
          </div>
        ) : (
          <div key={r.id} className={`grid items-center border-b border-cz-border px-5 py-2 text-[13px] ${compact ? "grid-cols-[1.4fr_.9fr_.7fr_2fr_1fr_40px]" : "grid-cols-[1.4fr_.9fr_.8fr_2.4fr_40px] py-3"}`}>
            <span className="flex items-center gap-2 font-medium text-cz-1">
              <Flag code={r.nation} /> {r.name}
            </span>
            {compact ? (
              <span>
                <span className="inline-flex items-center gap-1 rounded-full border border-cz-border px-2.5 py-0.5 text-xs font-medium text-cz-1">{r.role}</span>
              </span>
            ) : (
              <span className="flex flex-col text-xs">
                <span className="text-cz-1">{r.role}</span>
                <span className="text-cz-accent-t">Skift</span>
              </span>
            )}
            <MatchBar value={r.routeMatch + (r.type === "Sprinter" ? 30 : 8)} />
            <span>{r.plan && <Plan plan={r.plan} />}</span>
            {compact && <span className="text-xs text-cz-2">{r.planCost}</span>}
            <span className="text-end text-xs text-cz-accent-t">Ændr</span>
          </div>
        ),
      )}
    </div>
  );
}

function TacticsCompact({ mobile }: { mobile: boolean }) {
  // 1B: holdplan-kort + én række pr. rytter. Samme endpoints og samme gem som løbssiden.
  return (
    <div>
      <div className={`flex items-center justify-between gap-3 border-b border-cz-border ${mobile ? "px-4" : "px-5"} py-2.5`}>
        <StageTabs status={!mobile} />
        {!mobile && (
          <span className="inline-flex items-center gap-1 text-xs text-cz-accent-t">
            Åbn på løbssiden {Ico.ext(12)}
          </span>
        )}
      </div>
      <div className={`${mobile ? "mx-4" : "mx-5"} my-3 rounded-cz border border-cz-border`}>
        <div className={`grid gap-3 px-4 py-3 text-xs ${mobile ? "grid-cols-1" : "grid-cols-[1.6fr_1fr_1fr_auto]"}`}>
          <div>
            <div className="font-data text-3xs uppercase tracking-wide text-cz-3">Holdplan · etape 1</div>
            <div className="mt-0.5 text-[13.5px] font-semibold text-cz-1">Spurt til Zhen Ren</div>
          </div>
          <div>
            <div className="font-data text-3xs uppercase tracking-wide text-cz-3">Jagten</div>
            <div className="mt-0.5 text-cz-1">Jag udbruddet</div>
          </div>
          <div>
            <div className="font-data text-3xs uppercase tracking-wide text-cz-3">Sprint-tog</div>
            <div className="mt-0.5 text-cz-1">Robbe Bos, Hajun Pyo</div>
          </div>
          <div className="self-center text-xs text-cz-accent-t">Skift holdplan</div>
        </div>
      </div>
      <PlanRows mobile={mobile} compact />
      <div className={`flex items-center justify-between gap-2 ${mobile ? "px-4" : "px-5"} py-3`}>
        <span className="text-xs text-cz-3">Gemmes på løbet; løbssiden viser den samme plan.</span>
        <span className="flex gap-2">
          {!mobile && <Btn>Kopiér til etape 2</Btn>}
          <Btn variant="primary">Gem etape 1</Btn>
        </span>
      </div>
    </div>
  );
}

function TacticsLink({ mobile }: { mobile: boolean }) {
  return (
    <div>
      <div className={`border-b border-cz-border ${mobile ? "px-4" : "px-5"} py-2 text-2xs text-cz-3`}>Taktikken sættes på løbssiden. Her ses status pr. etape.</div>
      {STAGES.map((s) => (
        <div key={s.n} className={`flex items-center justify-between gap-3 border-b border-cz-border ${mobile ? "px-4" : "px-5"} py-3 text-[13px]`}>
          <span className="flex items-center gap-2">
            <span className="w-14 font-semibold text-cz-1">Etape {s.n}</span>
            <Glyph kind={s.kind} size={14} />
            <span className="text-cz-2">{s.label}</span>
            {!mobile && <span className="font-data text-xs tabular-nums text-cz-3">{s.km} km</span>}
          </span>
          <span className="flex items-center gap-3">
            {!mobile && <span className="text-xs text-cz-2">{s.n === 1 ? "Spurt til Zhen Ren" : "Rollens standard"}</span>}
            <Badge tone={s.tactic === "saved" ? "won" : "info"}>{s.tactic === "saved" ? "Gemt" : "Standardplan"}</Badge>
          </span>
        </div>
      ))}
      <div className={`flex justify-end ${mobile ? "px-4" : "px-5"} py-3`}>
        <Btn variant="primary">
          Sæt taktik på løbssiden {Ico.ext(13)}
        </Btn>
      </div>
    </div>
  );
}

function TacticsBlocked() {
  // 8A: i dag skjuler en ugemt trup hele taktikken.
  return (
    <div className="px-5 py-10 text-center">
      <div className="mx-auto mb-2 inline-flex text-cz-3">{Ico.lock(24)}</div>
      <div className="text-[15px] font-semibold text-cz-1">Gem truppen for at sætte taktik</div>
      <div className="mt-1 text-[13px] text-cz-2">Taktikken bygger på den gemte trup. Du har 2 ugemte ændringer.</div>
    </div>
  );
}

function TacticsView({ cfg, mobile }: { cfg: Config; mobile: boolean }) {
  if (cfg.squadDirty && cfg.save === "today") return <TacticsBlocked />;
  const dirtyNote =
    cfg.squadDirty && cfg.save !== "today" ? (
      <div className={`border-b border-cz-border bg-cz-warning/10 ${mobile ? "px-4" : "px-5"} py-2 text-xs text-cz-warning`}>
        Truppen har 2 ugemte ændringer. Taktikken viser kladden og gemmes sammen med den.
      </div>
    ) : null;
  return (
    <div>
      {dirtyNote}
      {cfg.tactics === "compact" ? <TacticsCompact mobile={mobile} /> : cfg.tactics === "link" ? <TacticsLink mobile={mobile} /> : <TacticsRaceTab cfg={cfg} mobile={mobile} />}
    </div>
  );
}

// --- Formtop-visningen (punkt 6) -------------------------------------------------------

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
  return (
    <div>
      <p className={`m-0 border-b border-cz-border ${px} py-2 text-2xs text-cz-3`}>
        Formtop-mål: Tour de Preview, starter tirs. 17. nov. Kryds ryttere af og anvend.
      </p>
      {linked && mobile && (
        <div className="flex items-center justify-between gap-2 border-b border-cz-border bg-cz-warning/10 px-4 py-2 text-xs text-cz-warning">
          <span className="inline-flex items-start gap-1.5">
            <span className="mt-0.5">{Ico.alert(13)}</span> Ignacio Moreno har formtop her, men er ikke udtaget.
          </span>
          <Btn>Udtag</Btn>
        </div>
      )}
      {!mobile && (
        <div className="grid grid-cols-[32px_1.5fr_.5fr_.5fr_.6fr_1.7fr_1fr] border-b border-cz-border bg-cz-subtle px-5 py-2 font-data text-3xs font-semibold uppercase tracking-[.08em] text-cz-3">
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
        <div className="flex items-center gap-1.5 overflow-hidden border-b border-cz-border px-4 py-2">
          <Chip active>Rating</Chip>
          <Chip active>Form</Chip>
          <Chip active>{linked ? "Mål" : "Træthed"}</Chip>
          <Chip>Løbsstart</Chip>
        </div>
      )}
      {groups.map(([label, rows]) => (
        <div key={label ?? "all"}>
          {label && <div className={`border-b border-cz-border bg-cz-subtle ${px} py-1.5 font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-2`}>{label}</div>}
          {rows.map((r) => {
            const warn = linked && r.peak?.here && !r.selected;
            const checked = false;
            const target = r.peak ? (
              <span className="flex flex-col">
                <span className={`text-xs ${r.peak.here ? "font-semibold text-cz-1" : "text-cz-2"}`}>{r.peak.here ? "Her: Tour de Preview" : r.peak.race}</span>
                {!mobile && <span className="text-3xs text-cz-3">Pris: {r.peak.cost}</span>}
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
                <div key={r.id} className={`grid grid-cols-[24px_1fr_36px_36px_72px] items-center gap-1 border-b border-cz-border px-4 py-2 text-[13px] ${warn ? "bg-cz-warning/10" : ""}`}>
                  <Check on={checked} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 truncate font-medium text-cz-1">
                      <Flag code={r.nation} /> {r.name}
                    </span>
                    {linked && r.selected && <span className="text-3xs uppercase tracking-wide text-cz-success">I truppen</span>}
                  </span>
                  <span className="text-end font-data tabular-nums">{r.rating}</span>
                  <span className="text-end font-data tabular-nums">{r.form}</span>
                  <span className="text-end">{third}</span>
                </div>
              );
            }
            return (
              <div key={r.id}>
                <div className={`grid grid-cols-[32px_1.5fr_.5fr_.5fr_.6fr_1.7fr_1fr] items-center border-b border-cz-border px-5 py-[7px] text-[13px] ${warn ? "bg-cz-warning/10" : ""}`}>
                  <Check on={checked} />
                  <span className="flex items-center gap-2">
                    <Flag code={r.nation} />
                    <span className="font-medium text-cz-1">{r.name}</span>
                    {linked && r.selected && <Badge tone="won">I truppen</Badge>}
                  </span>
                  <span className="text-end font-data tabular-nums">{r.rating}</span>
                  <span className="text-end font-data tabular-nums">{r.form}</span>
                  <span className="text-end font-data tabular-nums">{r.fatigue}</span>
                  <span className="ps-4">{target}</span>
                  <span className="text-end text-xs text-cz-2">{r.peak ? r.peak.when : "–"}</span>
                </div>
                {warn && (
                  <div className="flex items-center justify-between gap-3 border-b border-cz-border bg-cz-warning/10 px-5 py-2 ps-[52px] text-xs text-cz-warning">
                    <span className="inline-flex items-center gap-1.5">{Ico.alert(13)} Formtoppen rammer Tour de Preview, men han er ikke udtaget. Uden løbet går den til spilde.</span>
                    <Btn>Udtag til løbet</Btn>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      <div className={`${px} py-2.5 text-xs text-cz-3`}>14 ryttere · maks 2 formtoppe pr. rytter</div>
    </div>
  );
}

// --- Fælles gem-bjælke (8C) -----------------------------------------------------------

function SaveBar({ mobile }: { mobile: boolean }) {
  return (
    <div className={`${barPos()} bottom-0 end-0 z-20 border-t border-cz-border bg-cz-card ${mobile ? "start-0 px-4 py-3" : `${barPos() === "fixed" ? "start-[208px]" : "ms-[208px]"} px-8 py-3`}`}>
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

// --- Arbejdsfladen ------------------------------------------------------------------

function ViewBody({ cfg, mobile }: { cfg: Config; mobile: boolean }) {
  if (cfg.view === "tactics") return <TacticsView cfg={cfg} mobile={mobile} />;
  if (cfg.view === "peak") return <PeakView cfg={cfg} mobile={mobile} />;
  return mobile ? <MobileSquad cfg={cfg} /> : <SquadTable cfg={cfg} />;
}

function Workbench({ cfg }: { cfg: Config }) {
  return (
    <section id="workbench" className="min-w-0 rounded-cz border border-cz-border bg-cz-card" style={{ scrollMarginTop: "calc(var(--cap) + 12px)" }}>
      <RaceHead cfg={cfg} mobile={false} />
      {cfg.head === "today" && <FullProfile mobile={false} />}
      {cfg.head === "compact" && <StageStrip mobile={false} />}
      {cfg.head === "folded" && <FoldedProfile />}
      {cfg.head === "today" && (
        <div id="view-switch" className="flex items-center justify-between border-b border-cz-border px-5 py-2.5" style={{ scrollMarginTop: "calc(var(--cap) + 12px)" }}>
          <Seg options={["Trup", "Taktik", "Formtop"]} value={VIEW_LABEL[cfg.view]} />
          <span className="text-xs text-cz-3">{VIEW_HINT[cfg.view]}</span>
        </div>
      )}
      {cfg.head !== "today" && <span id="view-switch" />}
      <ViewBody cfg={cfg} mobile={false} />
    </section>
  );
}

export function DesktopPage({ cfg }: { cfg: Config }) {
  return (
    <div className="relative min-h-screen bg-cz-body">
      <Sidebar />
      <main className="ms-[208px] px-8 pb-24 pt-7">
        <div className="mx-auto max-w-[1600px]">
          <PageHead mobile={false} />
          <WeekBoard mobile={false} />
          <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-4">
            <RaceList mode={cfg.status} mobile={false} />
            <Workbench cfg={cfg} />
          </div>
        </div>
      </main>
      {cfg.save === "bar" && <SaveBar mobile={false} />}
    </div>
  );
}

// --- Mobil (390) ---------------------------------------------------------------------

function AppBar() {
  return (
    <div className="sticky z-30 flex h-12 items-center justify-between bg-cz-sidebar px-4 text-cz-sidebar-1" style={{ top: "var(--cap)" }}>
      {Ico.menu(20)}
      <span className="font-display text-base tracking-wide text-cz-accent">CYCLING ZONE</span>
      {Ico.bell(18)}
    </div>
  );
}

function MobileSquad({ cfg }: { cfg: Config }) {
  const rows = [...RIDERS].sort((a, b) => Number(b.selected) - Number(a.selected) || b.routeMatch - a.routeMatch);
  const third = cfg.after === "finish" ? "Ved mål" : cfg.after === "none" ? "Rating" : "Træthed";
  if (cfg.sheet === "today") {
    // Runde 3: tre linjer pr. rytter (navn, tal, rolle-vælger).
    return (
      <div id="squad-table">
        <p className="m-0 border-b border-cz-border px-4 py-2 text-2xs text-cz-3">Rute-match: gennemsnit for hele løbet på tværs af etaperne. Form nu: aktuel form, ikke en prognose.</p>
        <div className="grid grid-cols-[1fr_52px_40px_56px] border-b border-cz-border bg-cz-subtle px-4 py-2 font-data text-3xs font-semibold uppercase text-cz-3">
          <span>Rytter</span>
          <span className="text-end">Match</span>
          <span className="text-end">Form</span>
          <span className="text-end">{cfg.after === "finish" ? "Ved mål" : "Træthed"}</span>
        </div>
        {rows.map((r) => (
          <div key={r.id} className={`border-b border-cz-border px-4 py-3 ${r.selected ? "bg-cz-accent/[.04]" : ""}`}>
            <div className="flex items-center gap-2">
              <Check on={r.selected} />
              <Flag code={r.nation} />
              <span className="text-[14px] font-medium text-cz-1">{r.name}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-[1fr_52px_40px_56px] text-[13px]">
              <span />
              <span className={`text-end font-data tabular-nums ${r.routeMatch >= 60 && cfg.table === "today" ? "text-cz-accent-t" : ""}`}>{r.routeMatch}</span>
              <span className="text-end font-data tabular-nums">{r.form}</span>
              <span className="text-end">{cfg.after === "finish" ? <span className="font-data tabular-nums">{r.fatigue + r.finishDelta}<span className="text-3xs text-cz-warning"> +{r.finishDelta}</span></span> : <span className="font-data tabular-nums">{r.fatigue}</span>}</span>
            </div>
            {r.selected && (
              <div className="mt-2">
                <span className="inline-flex w-36 items-center justify-between rounded-cz border border-cz-border px-3 py-2 text-[13px]">
                  {r.role} {Ico.chevD(13)}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (cfg.sheet === "cards") {
    return (
      <div id="squad-table" className="space-y-2 px-3 py-3">
        {rows.slice(0, 8).map((r) => (
          <div key={r.id} className={`rounded-cz border p-3 ${r.selected ? "border-cz-accent/40 bg-cz-accent/[.04]" : "border-cz-border bg-cz-card"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Check on={r.selected} />
                <Flag code={r.nation} />
                <span className="text-[14px] font-medium text-cz-1">{r.name}</span>
              </span>
              {r.selected ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-cz-border px-2.5 py-0.5 text-xs text-cz-1">
                  {r.role} {Ico.chevD(11)}
                </span>
              ) : (
                <span className="text-2xs text-cz-3">{r.type}</span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-center">
              {[["Match", r.routeMatch], ["Form", r.form], ["Træthed", r.fatigue], ["Rating", r.rating]].map(([l, v]) => (
                <div key={String(l)} className="rounded-cz bg-cz-subtle py-1">
                  <div className="font-data text-sm font-semibold tabular-nums text-cz-1">{v}</div>
                  <div className="font-data text-3xs uppercase text-cz-3">{l}</div>
                </div>
              ))}
            </div>
            {(r.busy || r.peak?.here) && <div className="mt-1.5 text-2xs text-cz-2">{r.busy ?? "Formtop her"}</div>}
          </div>
        ))}
      </div>
    );
  }
  // 2B (D-047): navn + tre tal, rolle som chip i navnecellens underlinje, chip-række og "Fuld tabel".
  return (
    <div id="squad-table">
      <div className="flex items-center gap-1.5 overflow-hidden border-b border-cz-border px-4 py-2">
        <Chip active>Match</Chip>
        <Chip active>Form</Chip>
        <Chip active>{third}</Chip>
        <Chip>Rating</Chip>
        <span className="ms-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium text-cz-1">
          {Ico.table(13)} Fuld tabel
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.id} className={`grid grid-cols-[22px_1fr_44px_38px_56px] items-center gap-1 border-b border-cz-border px-4 py-[7px] ${r.selected ? "bg-cz-accent/[.04]" : ""}`}>
          <Check on={r.selected} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 truncate text-[14px] font-medium text-cz-1">
              <Flag code={r.nation} /> {r.name}
            </span>
            <span className="flex items-center gap-1.5 text-2xs text-cz-3">
              {r.selected ? <span className="rounded-full border border-cz-border px-1.5 text-cz-1">{r.role}</span> : r.type}
              {r.busy && <span className="truncate">· {r.busy}</span>}
              {r.peak?.here && <span className="text-cz-info">· Formtop her</span>}
            </span>
          </span>
          <span className="text-end">{cfg.table === "today" ? <span className="font-data text-[13px] tabular-nums">{r.routeMatch}</span> : <span className="font-data text-[13px] tabular-nums">{r.routeMatch}</span>}</span>
          <span className="text-end font-data text-[13px] tabular-nums">{r.form}</span>
          <span className="text-end font-data text-[13px] tabular-nums">
            {cfg.after === "finish" ? (
              <>
                {r.fatigue + r.finishDelta}
                <span className="text-3xs text-cz-warning"> +{r.finishDelta}</span>
              </>
            ) : cfg.after === "none" ? (
              r.rating
            ) : (
              r.fatigue
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function MobileSheet({ cfg }: { cfg: Config }) {
  const s = saveLabel(cfg);
  const sticky = cfg.sheet !== "today";
  return (
    <div className="bg-cz-card" id="sheet-top" style={{ scrollMarginTop: "calc(var(--cap) + 48px)" }}>
      <div className="flex justify-center pt-2">
        <span className="h-1 w-10 rounded-full bg-cz-border-strong" />
      </div>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="p-2 text-cz-2">{Ico.chevL(18)}</span>
        <span className="text-center">
          <span className="block text-[16px] font-semibold text-cz-1">{RACE.name}</span>
          <span className="font-data text-3xs tabular-nums text-cz-3">3 / 6</span>
        </span>
        <span className="flex text-cz-2">
          <span className="p-2">{Ico.chevR(18)}</span>
          <span className="p-2">{Ico.x(18)}</span>
        </span>
      </div>
      {sticky && (
        <div id="view-switch" className="sticky z-10 border-y border-cz-border bg-cz-card px-4 py-2" style={{ top: "calc(var(--cap) + 48px)", scrollMarginTop: "calc(var(--cap) + 48px)" }}>
          <Seg options={["Trup", "Taktik", "Formtop"]} value={VIEW_LABEL[cfg.view]} full />
        </div>
      )}
      {sticky ? (
        <div className="border-b border-cz-border px-4 py-2 text-xs text-cz-2">
          <div className="font-data text-3xs uppercase tracking-wide text-cz-3">Tirs. 17. nov., 12.00 · ProSeries · 4 etaper · 6 af 6</div>
          <div className="mt-1 flex items-center gap-3">
            <span className="text-cz-accent-t">Kopiér trup</span>
            <span className="text-cz-accent-t">Foreslå trup</span>
          </div>
        </div>
      ) : (
        <div className="border-b border-cz-border px-4 pb-3">
          <p className="m-0 font-data text-3xs uppercase tracking-wide text-cz-3">{RACE.meta} · 6 af 6 valgt</p>
          <p className="m-0 mt-1 text-2xs text-cz-warning">{RACE.shares}</p>
          <div className="mt-2 flex gap-2">
            <Btn>Kopiér trup fra…</Btn>
            <Btn>Foreslå trup</Btn>
          </div>
        </div>
      )}
      {cfg.head === "today" && <FullProfile mobile />}
      {cfg.head === "compact" && (
        <div className="flex items-center justify-between border-b border-cz-border px-4 py-2">
          <span className="flex items-center gap-3 text-xs">
            {STAGES.map((st) => (
              <span key={st.n} className="inline-flex items-center gap-1">
                <span className="font-semibold text-cz-1">{st.n}</span>
                <Glyph kind={st.kind} size={13} />
              </span>
            ))}
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-cz-accent-t">Vis rute {Ico.chevD(12)}</span>
        </div>
      )}
      {cfg.head === "folded" && (
        <div className="flex items-center justify-between border-b border-cz-border px-4 py-2 text-xs text-cz-2">
          <span>4 etaper · 562 km</span>
          <span className="inline-flex items-center gap-1 text-cz-accent-t">Vis profil {Ico.chevD(12)}</span>
        </div>
      )}
      {!sticky && (
        <div id="view-switch" className="border-b border-cz-border px-4 py-2.5" style={{ scrollMarginTop: "calc(var(--cap) + 48px)" }}>
          <Seg options={["Trup", "Taktik", "Formtop"]} value={VIEW_LABEL[cfg.view]} />
        </div>
      )}
      <ViewBody cfg={cfg} mobile />
      <div className="h-24" />
      {cfg.save === "bar" ? (
        <SaveBar mobile />
      ) : (
        s && (
          <div className={`${barPos()} bottom-0 end-0 start-0 z-20 border-t border-cz-border bg-cz-card px-4 py-3`}>
            <Btn variant={s.gold ? "primary" : "secondary"} size="md" full>
              {s.text}
            </Btn>
          </div>
        )
      )}
    </div>
  );
}

export function MobilePage({ cfg }: { cfg: Config }) {
  if (cfg.mobileList) {
    return (
      <div className="min-h-screen bg-cz-body">
        <AppBar />
        <div className="px-4 pb-16 pt-5">
          <PageHead mobile />
          <WeekBoard mobile />
          <RaceList mode={cfg.status} mobile />
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-cz-body">
      <AppBar />
      <div className="h-3 bg-cz-sidebar/60" />
      <MobileSheet cfg={cfg} />
    </div>
  );
}
