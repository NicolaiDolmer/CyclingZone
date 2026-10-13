import { useId } from "react";
import { useTranslation } from "react-i18next";
import Tooltip from "../ui/Tooltip.jsx";
import TerrainTypeGlyph from "./TerrainTypeGlyph.jsx";
import { formatNumber } from "../../lib/intl.js";
import type { StageAxes } from "../../lib/stageAxes";

// #6364 (spec §6): de tre akser hver for sig, som tre hairline-felter. Ingen farvede
// piller (TASTE P8): label i mikro-typografi, vaerdi som almindelig tekst, tal tabulaere.
// Afslutningen har den korte forklaring bag en tooltip (samme moenster som foer), manualen
// bor i Hjaelp (TASTE P9).
const CELL = "min-w-0 border border-cz-border rounded-cz px-3 py-2";
const LABEL = "text-cz-3 text-3xs uppercase tracking-wider font-semibold mb-0.5";
const VALUE = "text-cz-1 text-sm font-semibold leading-5";

export default function StageAxesStrip({ axes }: { axes: StageAxes }) {
  const { t } = useTranslation("races");
  const tipId = useId();
  const finishLabel = t(`detail.stageCard.finish.${axes.finish}`);
  const finishHint = axes.finish === "ttt"
    ? t("detail.stageCard.finishHintTtt")
    : t(`detail.finaleTypeHint.${axes.finish}`);
  const sector = axes.surface === "asphalt" ? null : axes.sectors[axes.surface];

  return (
    <div className="grid grid-cols-3 gap-2 mt-3" data-testid="stage-axes-strip">
      <div className={CELL}>
        <p className={LABEL}>{t("detail.stageCard.axes.terrain")}</p>
        <p className={`${VALUE} inline-flex items-center gap-1.5`}>
          <TerrainTypeGlyph profileType={axes.terrain} size={14} />
          {t(`detail.stageCard.terrain.${axes.terrain}`)}
        </p>
      </div>
      <div className={CELL}>
        <p className={LABEL}>{t("detail.stageCard.axes.finish")}</p>
        <Tooltip id={tipId} label={finishHint}>
          <button type="button" aria-describedby={tipId} className={`${VALUE} p-0 text-start cursor-help`}>
            {finishLabel}
          </button>
        </Tooltip>
      </div>
      <div className={CELL}>
        <p className={LABEL}>{t("detail.stageCard.axes.surface")}</p>
        <p className={VALUE}>{t(`detail.stageCard.surface.${axes.surface}`)}</p>
        {sector && sector.count > 0 && (
          <p className="text-cz-3 text-2xs tabular-nums mt-0.5">
            {t("detail.stageCard.sectors", {
              count: sector.count,
              km: formatNumber(sector.km, { maximumFractionDigits: 1 }),
            })}
          </p>
        )}
      </div>
    </div>
  );
}
