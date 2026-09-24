// #5631: evne-kolonnerne (de 15 CZ-evner) til trup-tabellernes "Abilities"-
// tilstand.
//
// Samme opskrift som My Teams evne-tilstand (TeamPage.jsx, #2906 punkt 1 +
// ejer-feedback 25/7): én kolonne pr. evne i den delte rækkefølge fra
// lib/abilities.js, `tight`-gutter så tallene læses som ÉN matrix, farve fra
// den delte statStyle, fuldt evnenavn som tooltip på den korte overskrift.
// Mobil (D-047): i evne-tilstanden er standard rating + de to første evner.
import { useTranslation } from "react-i18next";
import { ABILITY_STATS } from "../../lib/abilities.js";
import { statStyle } from "../../lib/statColor.js";
import type { DataTableColumn } from "./squadUi.ts";

interface AbilityStat { key: string; label: string }
const STATS = ABILITY_STATS as AbilityStat[];

export const ABILITY_MODE_MOBILE_DEFAULTS: string[] = ["rating", ...STATS.slice(0, 2).map((s) => s.key)];

/** Kolonne-definitionerne for de 15 evner, i den delte rækkefølge. */
export function useAbilityColumns<Row extends Record<string, unknown>>(): DataTableColumn<Row>[] {
  const { t: tRider } = useTranslation("rider");
  return STATS.map(({ key, label }) => ({
    key,
    header: <span title={tRider(`racePreview.derived.${key}`)}>{label}</span>,
    mobileLabel: label,
    sortKey: key,
    numeric: true,
    tight: true,
    render: (r: Row) => {
      const value = Number(r[key]) || 0;
      return (
        <span className="inline-block min-w-[24px] text-center text-xs font-mono px-1 py-0.5 rounded"
          style={statStyle(value)}>
          {value || "-"}
        </span>
      );
    },
  }));
}
