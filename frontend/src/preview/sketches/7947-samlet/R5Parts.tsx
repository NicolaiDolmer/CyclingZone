// #7947 retning 5: smaa faelles byggesten (navnecellen, traethedspladen, pilen).
import { Flag } from "../../../components/Flag.jsx";
import { ArrowDownIcon, ArrowUpIcon, UserIcon } from "../../../components/ui/icons/index.jsx";
import { fatigueStep, type Arrow } from "./r5model.ts";
import type { R5Rider } from "./r5data.ts";

const PLATE = "inline-flex min-w-[2.125rem] items-center justify-center rounded-cz border px-1 py-0.5 font-data text-[13px] font-semibold leading-none tabular-nums text-cz-1";
// Varm skala (#8364): neutral, rav, staerkere rav, roed. Trinene er skitse-trin.
const FATIGUE_PLATE = [
  "border-cz-border bg-cz-subtle",
  "border-cz-warning/30 bg-cz-warning/10",
  "border-cz-warning/50 bg-cz-warning/25",
  "border-cz-danger/50 bg-cz-danger/20",
];

export function FatiguePlate({ value }: { value: number }) {
  return <span className={`${PLATE} ${FATIGUE_PLATE[fatigueStep(value)]}`} aria-label={`Fatigue now ${value}`}>{value}</span>;
}

export function ArrowMark({ arrow }: { arrow: Arrow }) {
  if (arrow === "up") return <ArrowUpIcon size={13} aria-hidden="true" />;
  if (arrow === "flat") return <ArrowUpIcon size={13} aria-hidden="true" className="rotate-90" />;
  if (arrow === "down") return <ArrowDownIcon size={13} aria-hidden="true" />;
  return (
    <span className="inline-flex" aria-hidden="true">
      <ArrowDownIcon size={13} />
      <ArrowDownIcon size={13} className="-ms-1.5" />
    </span>
  );
}

export function RiderName({ rider, wrap = false }: { rider: R5Rider; wrap?: boolean }) {
  // Navnecellen (ejer punkt 2 + TASTE P12): flag, hover-ikon, navn. Aldrig typen.
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${wrap ? "items-start" : ""}`}>
      <Flag code={rider.nation} title={rider.country} className="shrink-0" />
      <UserIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
      <a href="#rider" className={`text-[13.5px] font-medium text-cz-1 hover:underline ${wrap ? "leading-tight" : "truncate"}`}>{rider.name}</a>
    </span>
  );
}
