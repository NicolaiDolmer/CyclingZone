// #6150: fælles rækkedele for roadmap-fanerne (titel med "ny"-prik, meta-linje,
// gem-kvittering og skeleton-rækker), så de fem faner ser ens ud.
import type { ReactNode } from "react";
import { Skeleton } from "./roadmapUi.ts";
import { SKELETON_ROWS } from "../../lib/roadmapModel.ts";
import type { SaveState } from "./roadmapFormat.ts";

// #5673: prikken på det enkelte punkt, samme recipe som nav-prikken i Layout.jsx.
export function NewDot({ label }: { label: string }) {
  return (
    <span className="shrink-0 inline-flex items-center" title={label}>
      <span aria-hidden="true" className="block w-1.5 h-1.5 rounded-full bg-cz-accent" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function RowTitle({ children, isNew, newLabel }: { children: ReactNode; isNew?: boolean; newLabel: string }) {
  return (
    // Prikken står i en boks på præcis én tekstlinjes højde (1lh) og centreres
    // i den: samme linje som titlen, lodret midt for første linje, og rækken
    // bliver ikke højere end en række uden prik.
    <span className="inline-flex items-start gap-2 text-sm leading-relaxed">
      <span className="text-cz-1">{children}</span>
      {isNew && <span className="flex h-lh shrink-0 items-center"><NewDot label={newLabel} /></span>}
    </span>
  );
}

export function RowMeta({ children }: { children: ReactNode }) {
  return <div className="mt-0.5 text-cz-3 text-xs">{children}</div>;
}

export function SaveNote({ state, savedLabel, errorLabel }: { state: SaveState | undefined; savedLabel: string; errorLabel: string }) {
  return (
    <div aria-live="polite" className="min-h-4">
      {state === "saved" && <span className="text-cz-3 text-xs">{savedLabel}</span>}
      {state === "error" && <span className="text-cz-danger text-xs">{errorLabel}</span>}
    </div>
  );
}

/** Fast antal rækker i samme højde som en rigtig række (CLS-reglen fra #5177). */
export function SkeletonRows({ withScale = false }: { withScale?: boolean }) {
  return (
    <ul aria-hidden="true" className="divide-y divide-cz-border">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <li key={i} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          {withScale && <Skeleton className="h-[34px] sm:h-7 w-full sm:w-52" />}
        </li>
      ))}
    </ul>
  );
}

/** Korttitel med antal ("In beta now 5"), samme greb på alle fem faner. */
export function TitleCount({ label, count }: { label: string; count: number }) {
  return <span>{label} <span className="ms-1 font-data tabular-nums text-cz-3">{count}</span></span>;
}

export const ROW_LIST = "divide-y divide-cz-border";
export const ROW = "py-3";
