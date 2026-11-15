// #7664: lille, daempet "Opdateret kl."-tekst paa rytter- og holdranglisten.
// Vises KUN naar backenden laeser de nye tabeller (kontakten
// ranking_shadow_decoupled_6765 taendt). Tidspunktet hentes sammen med tallene
// (useRiderRankings / StandingsPage), saa det foelger med, hver gang tallene
// hentes igen. Uden tidspunkt tegnes intet, saa siden er praecis som i dag.
// Samme tekstnoegle (rankings.updatedAt) i den namespace siden selv bruger.
import { useTranslation } from "react-i18next";
import { formatUpdatedAtTime } from "../../lib/rankingFreshness.ts";

export default function UpdatedAtLine({ at, ns = "riders" }: { at: string | null; ns?: "riders" | "standings" }) {
  const { t, i18n } = useTranslation(ns);
  if (!at) return null;
  const time = formatUpdatedAtTime(at, i18n.language);
  if (!time) return null;
  // Inline i sidens meta-linje (saeson · ...), samme daempede trin som
  // "Afsluttet saeson"-noten. Ingen banner, ingen ny linje.
  return (
    <span className="ms-2 text-cz-3 tabular-nums">
      · {t("rankings.updatedAt", { time })}
    </span>
  );
}
