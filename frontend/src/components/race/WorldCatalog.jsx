// #3102 etape 3 — verdens-kataloget (Slice 09; før: /races?tab=world), flyttet
// til Resultat-hubbens Arkiv-fane som selvstændig komponent. Read-only katalog
// over alle løb i verdenspuljen med klasse-summering som filter. Komponenten
// mountes kun når Arkiv-fanen er aktiv, så mount-fetch = samme lazy-load som
// den gamle fanes tab==="world"-effekt. Ren flytning fra RacesPage.jsx (nedlagt).
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSortState, sortRows } from "../../lib/useTableSort.js";
import { RACE_CLASS_OPTIONS } from "../../lib/raceFilterOptions.js";
import { Section, SectionHeader, DataTable } from "../ui";

// Sorterbare kolonner (klient-side, delt useSortState/sortRows). Tekst-kolonner
// starter stigende; etaper (tal) starter faldende (flest først) via descFirstKeys.
const WORLD_ACCESSORS = {
  name: (r) => r.name,
  race_class: (r) => r.race_class ?? "",
  race_type: (r) => r.race_type ?? "",
  stages: (r) => r.stages ?? 0,
};
const WORLD_DESC_FIRST = new Set(["stages"]);

export default function WorldCatalog() {
  const { t } = useTranslation("races");

  const [worldPool, setWorldPool] = useState([]);
  const [worldSummary, setWorldSummary] = useState({});
  const [worldLoading, setWorldLoading] = useState(true);
  const [worldFilterClass, setWorldFilterClass] = useState("");

  const worldSort = useSortState({ descFirstKeys: WORLD_DESC_FIRST });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/race-pool`);
        const data = await res.json();
        if (cancelled) return;
        setWorldPool(data.pool || []);
        setWorldSummary(data.summary || {});
      } finally {
        if (!cancelled) setWorldLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (worldLoading) return <p className="text-cz-3 text-sm">{t("world.loading")}</p>;

  return (
    <div>
      <Section className="mb-4">
        <SectionHeader title={t("world.totalRaces", { count: worldPool.length })} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
          {RACE_CLASS_OPTIONS.map(opt => {
            const s = worldSummary[opt.value];
            if (!s || s.count === 0) return null;
            return (
              <button
                key={opt.value}
                onClick={() => setWorldFilterClass(worldFilterClass === opt.value ? "" : opt.value)}
                className={`flex justify-between items-center px-3 py-2 rounded-lg border text-left transition-all
                  ${worldFilterClass === opt.value
                    ? "bg-cz-accent/10 border-cz-accent/30 text-cz-accent-t"
                    : "border-cz-border text-cz-2 hover:bg-cz-subtle"}`}
              >
                <span className="truncate">{t(`classOption.${opt.value}`)}</span>
                <span className="text-cz-3 text-xs whitespace-nowrap ms-2">
                  {t("world.classSummary", { count: s.count, days: s.raceDays })}
                </span>
              </button>
            );
          })}
        </div>
        {worldFilterClass && (
          <p className="text-cz-3 text-xs mt-2">
            {t("world.filteredOn", { class: t(`classOption.${worldFilterClass}`) })}{" "}
            <button onClick={() => setWorldFilterClass("")} className="text-cz-accent-t underline">
              {t("world.clearFilter")}
            </button>
          </p>
        )}
      </Section>

      <DataTable
        label={t("tabs.world")}
        rowKey={(r) => r.id}
        sort={worldSort.sort}
        sortDir={worldSort.sortDir}
        onSort={worldSort.handleSort}
        rows={sortRows(
          worldPool.filter(r => !worldFilterClass || r.race_class === worldFilterClass),
          worldSort.sort ? WORLD_ACCESSORS[worldSort.sort] : null,
          worldSort.sortDir,
        )}
        columns={[
          { key: "name", header: t("world.thRace"), sticky: true, sortKey: "name" },
          { key: "race_class", header: t("world.thClass"), sortKey: "race_class", fold: true },
          {
            key: "race_type",
            header: t("world.thType"),
            sortKey: "race_type",
            fold: true,
            render: (r) => (r.race_type === "single" ? t("raceType.oneDayShort") : t("resultType.stage")),
            foldValue: (r) => (r.race_type === "single" ? t("raceType.oneDayShort") : t("resultType.stage")),
          },
          { key: "stages", header: t("world.thStages"), numeric: true, sortKey: "stages" },
        ]}
      />
    </div>
  );
}
