import { useMemo, useState, type ChangeEvent, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import FilterBarBase from "../ui/FilterBar.jsx";
import { DataTable as DataTableBase } from "../ui/DataTable.jsx";
import StatusBadgeBase from "../ui/StatusBadge.jsx";
import CheckboxBase from "../ui/Checkbox.jsx";
import SelectBase from "../ui/Select.jsx";
import ButtonBase from "../ui/Button.jsx";
import EmptyStateBase from "../ui/EmptyState.jsx";
import { ChevronRightIcon, CalendarIcon } from "../ui/icons/index.jsx";
import { buttonClass } from "../ui/buttonStyles.js";
import TerrainTypeGlyphBase from "../race/TerrainTypeGlyph.jsx";
import { useIsMobileViewport } from "../../hooks/useMediaQuery.ts";
import { intlLocale } from "../../lib/intlLocale.ts";
import { raceDetailHref, raceTerrain } from "../../lib/racePeek.ts";
import type { RaceStatus } from "../../lib/racePeek.ts";
import {
  buildCalendarTableRows,
  filterCalendarTableRows,
  sortCalendarTableRows,
  nextSort,
  classOptions,
  terrainOptions,
} from "../../lib/calendarTable.ts";
import type { CalendarTableEntry, CalendarTableRow, SortDir } from "../../lib/calendarTable.ts";

// ── Typer for de .jsx-primitiver tabellen bruger ─────────────────────────────
// Uden dem udleder TS props af default-VÆRDIERNE (`search = null` bliver til
// `null`). Kontrakten er læst af filerne i components/ui, samme greb som
// AdminValuePreviewPage.tsx og RacePeekCard.tsx.
type Translate = (key: string, opts?: Record<string, unknown>) => string;
interface Column {
  key: string;
  header: ReactNode;
  sticky?: boolean;
  numeric?: boolean;
  sortKey?: string;
  subline?: (row: CalendarTableRow) => ReactNode;
  render: (row: CalendarTableRow) => ReactNode;
}
interface DataTableProps {
  label: string;
  columns: Column[];
  rows: CalendarTableRow[];
  rowKey: (row: CalendarTableRow) => string;
  sort?: string;
  sortDir?: string;
  onSort?: (key: string) => void;
  dense?: boolean;
  empty?: ReactNode;
}
interface FilterBarSelect {
  key: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  ariaLabel: string;
  options: { value: string; label: string }[];
}
interface FilterBarProps {
  search?: { value: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void; placeholder: string; ariaLabel?: string; testId?: string } | null;
  filters?: FilterBarSelect[];
  meta?: ReactNode;
  moreLabel?: string;
  className?: string;
  children?: ReactNode;
}
interface SelectProps {
  size?: "sm" | "md";
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  children?: ReactNode;
  "aria-label"?: string;
}
interface CheckboxProps {
  id: string;
  checked: boolean;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  label: ReactNode;
  className?: string;
}
interface ButtonProps { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; onClick?: () => void; children?: ReactNode }
interface EmptyStateProps { title: string; description?: string; action?: ReactNode; icon?: ReactNode }
interface StatusBadgeProps { state: string; emphasis?: boolean; className?: string; children?: ReactNode }
interface TerrainTypeGlyphProps { profileType: string | null | undefined; size?: number; showLabel?: boolean; className?: string; labelClassName?: string }

const FilterBar = FilterBarBase as unknown as ComponentType<FilterBarProps>;
const DataTable = DataTableBase as unknown as ComponentType<DataTableProps>;
const StatusBadge = StatusBadgeBase as unknown as ComponentType<StatusBadgeProps>;
const Checkbox = CheckboxBase as unknown as ComponentType<CheckboxProps>;
const Select = SelectBase as unknown as ComponentType<SelectProps>;
const Button = ButtonBase as unknown as ComponentType<ButtonProps>;
const EmptyState = EmptyStateBase as unknown as ComponentType<EmptyStateProps>;
const TerrainTypeGlyph = TerrainTypeGlyphBase as unknown as ComponentType<TerrainTypeGlyphProps>;

interface CalendarTableProps {
  entries: CalendarTableEntry[] | null | undefined;
  todayIso: string;
  division?: number | null;
  poolId?: number | null;
  mineOnly?: boolean;
  divisionPending?: boolean;
  onShowAll?: (() => void) | null;
}

// #6683 · "Kalender | Tabel": sæsontabellen (ejer 25/10, mulighed A + B's mobil).
//
// Desktop (A): én række pr. løb for hele sæsonen. Kolonner LØB (navn + type
// under), DATOER (sorterbar), START, TERRÆN (ét farvet streg-ikon pr. etape;
// endagsløb ikon + ord), ETAPER, KLASSE, DIT HOLD (pille) og "Åbn". Ingen km.
// Mobil (B's rækker): løbsnavn med en grå linje under (datoer · klasse),
// Terræn (ikon, + ord for endagsløb) og Hold (Klar/Mangler-pille). Ingen
// brede kolonner, så navne aldrig knækker.
//
// Kanoniske T2-dele (docs/design/PAGE_TEMPLATES.md): FilterBar (søg + 2 selects
// + "Flere filtre"), DataTable dense, StatusBadge, TerrainTypeGlyph. Ingen ny
// radius, padding eller sidehoved. Siden ejer Vis-vælgeren, sæsonvælgeren og
// skifteren; her bor kun filterlinjen og tabellen.
//
// Holdstatus = racePeek.myRaceStatus, samme regel som kalenderens status-prik
// og løbskortet.

const SQUAD_BADGE: Record<RaceStatus, string> = { selected: "won", missing: "closing", gtBound: "info" };
// Etapeløb med mange etaper (Grand Tours) ombrydes i stedet for at gøre kolonnen bred.
const STAGE_ICON_WRAP = "flex max-w-[11.5rem] flex-wrap items-center gap-x-0.5 gap-y-1";

export default function CalendarTable({
  entries,
  todayIso,
  division = null,
  poolId = null,
  mineOnly = false,
  divisionPending = false,
  onShowAll = null,
}: CalendarTableProps) {
  const { t, i18n } = useTranslation(["calendar", "races"]);
  const mobile = useIsMobileViewport();
  const locale = intlLocale(i18n.language);

  const [search, setSearch] = useState("");
  const [raceType, setRaceType] = useState("all");
  const [raceClass, setRaceClass] = useState("all");
  const [terrain, setTerrain] = useState("all");
  const [needsSquad, setNeedsSquad] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "date", dir: "asc" });

  const allRows = useMemo(() => buildCalendarTableRows(entries || [], todayIso), [entries, todayIso]);
  // Fanerne (division/pulje/mit hold) afgrænser først; filterlinjens valg tilbydes kun fra det.
  const scoped = useMemo(
    () => filterCalendarTableRows(allRows, { division, poolId, mineOnly }),
    [allRows, division, poolId, mineOnly],
  );
  const rows = useMemo(() => {
    const filtered = filterCalendarTableRows(scoped, { search, raceType, raceClass, terrain })
      .filter((r) => !needsSquad || r.status === "missing");
    return sortCalendarTableRows(filtered, sort);
  }, [scoped, search, raceType, raceClass, terrain, needsSquad, sort]);

  const showSquad = !divisionPending;
  const activeFilters = search.trim() !== "" || raceType !== "all" || raceClass !== "all" || terrain !== "all" || needsSquad;
  const clear = () => {
    setSearch("");
    setRaceType("all");
    setRaceClass("all");
    setTerrain("all");
    setNeedsSquad(false);
  };

  const typeFilter = {
    key: "type",
    value: raceType,
    onChange: (e: ChangeEvent<HTMLSelectElement>) => setRaceType(e.target.value),
    ariaLabel: t("table.type"),
    options: [
      { value: "all", label: t("table.allTypes") },
      { value: "single", label: t("table.typeOption.single") },
      { value: "stage_race", label: t("table.typeOption.stage_race") },
    ],
  };
  const classFilter = {
    key: "class",
    value: raceClass,
    onChange: (e: ChangeEvent<HTMLSelectElement>) => setRaceClass(e.target.value),
    ariaLabel: t("table.class"),
    options: [
      { value: "all", label: t("table.allClasses") },
      ...classOptions(scoped, raceClass).map((c) => ({ value: c, label: classLabel(t, c) })),
    ],
  };
  const terrainFilter = {
    key: "terrain",
    value: terrain,
    onChange: (e: ChangeEvent<HTMLSelectElement>) => setTerrain(e.target.value),
    ariaLabel: t("table.terrain"),
    options: [
      { value: "all", label: t("table.allTerrain") },
      ...terrainOptions(scoped, terrain).map((k) => ({ value: k, label: t(`terrain.${k}`) })),
    ],
  };

  // Mobil: type + klasse i linjen, terræn bag "Flere filtre" (begge mockups).
  // #7461 (ejer 1/11): desktop har type + terræn i linjen og klasse bag "Flere filtre".
  const filters = mobile ? [typeFilter, classFilter] : [typeFilter, terrainFilter];
  const moreSelect = (f: typeof terrainFilter) => (
    <Select key={f.key} size="sm" value={f.value} onChange={f.onChange} aria-label={f.ariaLabel}>
      {f.options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </Select>
  );
  const more = [
    moreSelect(mobile ? terrainFilter : classFilter),
    showSquad && (
      <Checkbox
        key="needs"
        id="cal-table-needs-squad"
        checked={needsSquad}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setNeedsSquad(e.target.checked)}
        label={t("table.needsSquadOnly")}
        className="text-cz-2"
      />
    ),
  ].filter(Boolean);

  const typeLabel = (r: CalendarTableRow) => t(`table.rowType.${r.stageRace ? "stage_race" : "single"}`);
  const dates = (r: CalendarTableRow, withWeekday: boolean) => formatRange(r.start, r.end, locale, withWeekday);

  const desktopColumns = [
    {
      key: "race",
      header: t("table.cols.race"),
      sticky: true,
      sortKey: "name",
      render: (r: CalendarTableRow) => <span className={r.isMine ? "text-cz-1" : "text-cz-2"}>{r.name}</span>,
      subline: (r: CalendarTableRow) => typeLabel(r),
    },
    {
      key: "dates",
      header: t("table.cols.dates"),
      sortKey: "date",
      render: (r: CalendarTableRow) => <span className="whitespace-nowrap tabular-nums">{dates(r, true)}</span>,
    },
    {
      key: "start",
      header: t("table.cols.start"),
      numeric: true,
      render: (r: CalendarTableRow) => r.startTime ?? <Dash />,
    },
    {
      key: "terrain",
      header: t("table.cols.terrain"),
      render: (r: CalendarTableRow) => <StageTerrain row={r} />,
    },
    {
      key: "stages",
      header: t("table.cols.stages"),
      numeric: true,
      sortKey: "stages",
      render: (r: CalendarTableRow) => r.stages,
    },
    {
      key: "class",
      header: t("table.cols.class"),
      render: (r: CalendarTableRow) => <span className="whitespace-nowrap">{r.raceClass ? classLabel(t, r.raceClass) : <Dash />}</span>,
    },
    ...(showSquad
      ? [{
          key: "squad",
          header: t("table.cols.squad"),
          render: (r: CalendarTableRow) => <SquadPill status={r.status} t={t} />,
        }]
      : []),
    {
      key: "open",
      header: <span className="sr-only">{t("table.cols.open")}</span>,
      render: (r: CalendarTableRow) => (
        <Link
          to={raceDetailHref(r.id)}
          aria-label={t("table.openRace", { name: r.name })}
          className={`${buttonClass({ variant: "secondary", size: "sm" })} whitespace-nowrap`}
          data-testid="calendar-table-open"
        >
          {t("table.cols.open")}
          <ChevronRightIcon size={14} aria-hidden="true" />
        </Link>
      ),
    },
  ];

  // B's mobil-rækker: navnet er selve linket til løbet (ingen bred "Åbn"-kolonne).
  const mobileColumns = [
    {
      key: "race",
      header: t("table.cols.race"),
      sticky: true,
      sortKey: "name",
      render: (r: CalendarTableRow) => (
        <Link to={raceDetailHref(r.id)} className={`hover:underline ${r.isMine ? "text-cz-1" : "text-cz-2"}`} data-testid="calendar-table-open">
          {r.name}
        </Link>
      ),
      subline: (r: CalendarTableRow) => [dates(r, false), r.raceClass ? classLabel(t, r.raceClass) : null].filter(Boolean).join(" · "),
    },
    {
      key: "terrain",
      header: t("table.cols.terrain"),
      render: (r: CalendarTableRow) => <CompactTerrain row={r} />,
    },
    ...(showSquad
      ? [{
          key: "squad",
          header: t("table.cols.squadShort"),
          render: (r: CalendarTableRow) => <SquadPill status={r.status} t={t} short />,
        }]
      : []),
  ];

  const empty = activeFilters ? (
    <EmptyState
      icon={<CalendarIcon size={24} aria-hidden="true" />}
      title={t("table.empty.title")}
      description={t("table.empty.desc")}
      action={<Button size="sm" variant="secondary" onClick={clear}>{t("table.empty.clear")}</Button>}
    />
  ) : (
    <EmptyState
      icon={<CalendarIcon size={24} aria-hidden="true" />}
      title={t("table.empty.noneTitle")}
      description={t("table.empty.noneDesc")}
      action={onShowAll ? <Button size="sm" variant="secondary" onClick={onShowAll}>{t("tabs.all")}</Button> : null}
    />
  );

  return (
    <div data-testid="calendar-table">
      <FilterBar
        className="mb-4"
        search={{
          value: search,
          onChange: (e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value),
          placeholder: t("table.search"),
          ariaLabel: t("table.search"),
          testId: "calendar-table-search",
        }}
        filters={filters}
        moreLabel={t("table.more")}
        meta={<span className="tabular-nums">{t("table.count", { count: rows.length })}</span>}
      >
        {more.length > 0 ? more : null}
      </FilterBar>
      <DataTable
        dense
        columns={mobile ? mobileColumns : desktopColumns}
        rows={rows}
        rowKey={(r: CalendarTableRow) => r.id}
        label={t("table.label")}
        sort={sort.key}
        sortDir={sort.dir}
        onSort={(key: string) => setSort((s) => nextSort(s, key))}
        empty={empty}
      />
    </div>
  );
}

// ── celler ───────────────────────────────────────────────────────────────────

function Dash() {
  return <span className="text-cz-3">–</span>;
}

// Desktop: ét ikon pr. etape (mockup A). Endagsløb: ikon + ord.
function StageTerrain({ row }: { row: CalendarTableRow }) {
  if (!row.stageRace) {
    return <TerrainTypeGlyph profileType={row.stageTypes[0]} size={16} showLabel className="gap-1.5 whitespace-nowrap text-cz-2" labelClassName="text-xs" />;
  }
  return (
    <span className={STAGE_ICON_WRAP}>
      {row.stageTypes.map((pt: string, i: number) => (
        <TerrainTypeGlyph key={i} profileType={pt} size={16} />
      ))}
    </span>
  );
}

// Mobil (B): endagsløb ikon + ord; etapeløb hver terræntype én gang, højst 3
// (samme regel som løbskortet, racePeek.raceTerrain), så kolonnen forbliver smal.
function CompactTerrain({ row }: { row: CalendarTableRow }) {
  if (!row.stageRace) {
    return <TerrainTypeGlyph profileType={row.stageTypes[0]} size={16} showLabel className="gap-1 whitespace-nowrap text-cz-2" labelClassName="text-2xs" />;
  }
  return (
    <span className="flex items-center gap-0.5">
      {raceTerrain(row.stageTypes).map((x) => (
        <TerrainTypeGlyph key={x.kind} profileType={x.profileType} size={16} />
      ))}
    </span>
  );
}

function SquadPill({ status, t, short = false }: { status: RaceStatus | null; t: Translate; short?: boolean }) {
  if (!status) return <Dash />;
  return (
    <StatusBadge state={SQUAD_BADGE[status]} emphasis className="whitespace-nowrap">
      {t(`table.${short ? "squadShort" : "squad"}.${status}`)}
    </StatusBadge>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function classLabel(t: Translate, value: string): string {
  return t(`classOption.${value}`, { ns: "races", defaultValue: value });
}

// "YYYY-MM-DD" bygges selv (aldrig new Date(iso), se calendarGrid.js) med
// middag-UTC som anker, så København-projektionen aldrig ruller en dag.
function formatDay(iso: string, locale: string, withWeekday: boolean): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Europe/Copenhagen",
    ...(withWeekday ? { weekday: "short" } : {}),
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

function formatRange(start: string | null, end: string | null, locale: string, withWeekday: boolean): string {
  if (!start) return "";
  const a = formatDay(start, locale, withWeekday);
  return end && end !== start ? `${a} – ${formatDay(end, locale, withWeekday)}` : a;
}
