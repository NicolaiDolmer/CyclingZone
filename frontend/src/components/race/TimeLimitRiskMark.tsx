// #7715 (ejer 5/11): lille mærke på taktik og udtagelse, ingen indbakke. Serveren afgør
// om rytteren har risikoen og sender kun et ja: ingen tal eller formler her (fog of war).
// Et tryk folder forklaringen ud, så den også kan læses på en telefon.
//
// variant "risk":  varslet før etapen.
// variant "out":   samme sted efter etapen, hvorfor han røg ud.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangleIcon } from "../ui/index.js";

export default function TimeLimitRiskMark({ variant = "risk" }: { variant?: "risk" | "out" }) {
  const { t } = useTranslation("races");
  const [open, setOpen] = useState(false);
  const out = variant === "out";
  const short = t(out ? "timeLimitRisk.outShort" : "timeLimitRisk.short");
  const long = t(out ? "timeLimitRisk.outLong" : "timeLimitRisk.long");
  return (
    <span className="inline-flex flex-col items-start gap-1 max-w-[260px]" data-testid={`time-limit-${variant}`}>
      <button
        type="button"
        aria-expanded={open}
        title={long}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 text-3xs px-1.5 py-0.5 rounded-[5px] border whitespace-nowrap cursor-pointer ${out
          ? "bg-cz-danger/10 text-cz-danger border-cz-danger/20"
          : "bg-cz-subtle text-cz-warning border-cz-border"}`}
      >
        <AlertTriangleIcon size={11} aria-hidden="true" className="shrink-0" />
        {short}
      </button>
      {open && <span className="text-3xs text-cz-2 whitespace-normal text-left">{long}</span>}
    </span>
  );
}
