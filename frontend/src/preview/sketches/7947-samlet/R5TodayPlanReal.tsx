// Telefonens I dag-fane med den AEGTE raekke (TodayRowMobile): foer = i dag, efter = samme raekke
// med planen i en ekstra daempet linje. Dansk via spillets sprogfiler. Eksempeldata.
import "../../../i18n/index.js";
import i18n from "i18next";
import { useEffect, useState } from "react";
import TodayRowsMobile from "../../../components/training/TodayRowMobile.tsx";
import TodayRowsPlan from "./R5TodayRowPlan.tsx";
import type { QuickChoice } from "../../../components/training/todayRowModel.ts";

const RIDERS = [
  { id: "a", firstname: "Arne", lastname: "Deneve", squad: "senior" },
  { id: "b", firstname: "Lukas", lastname: "Moesgaard", squad: "senior" },
  { id: "c", firstname: "Owen", lastname: "Pellow", squad: "u23" },
  { id: "d", firstname: "Jesper", lastname: "Hollund", squad: "senior" },
];
const META: Record<string, string> = { a: "Klatrer · 26", b: "Klatrer · 23", c: "Sprinter · 21", d: "Baroudeur · 28" };
const PLAN: Record<string, string> = {
  a: "Egen plan · dag 3 af 7",
  b: "Gruppen Klatrere · uge 2 af 4",
  c: "Kun i dag: Restitution · programmet fortsætter i morgen",
  d: "Holdets program",
};
const SHORT: Record<string, string> = { a: "Egen plan 3/7", b: "Klatrere 2/4", c: "Kun i dag", d: "Holdets program" };
const CHOICES: readonly QuickChoice[] = ["rest", "recovery", "session"];
const PRESSED: Record<string, QuickChoice | null> = { a: "session", b: "session", c: "recovery", d: "session" };

function Rows({ mode }: { mode: "before" | "a" | "b" }) {
  const common = {
    riders: RIDERS, choices: CHOICES, metaFor: (id: string) => (mode === "b" ? `${META[id]} · ${SHORT[id]}` : META[id]) ?? null, stageToday: (id: string) => id === "b",
    forecastFor: () => null, pressedFor: (id: string) => PRESSED[id] ?? null, onChoose: () => {}, busyFor: () => false,
    locked: false, selectedRiderId: null, onSelectRider: () => {}, detailFor: () => null,
  };
  return mode === "a" ? <TodayRowsPlan {...common} planFor={(id) => PLAN[id] ?? null} /> : <TodayRowsMobile {...common} />;
}

export default function TodayPlanReal() {
  const [ready, setReady] = useState(false);
  useEffect(() => { void i18n.changeLanguage("da").then(() => i18n.loadNamespaces(["training", "common", "rider"])).then(() => setReady(true)); }, []);
  if (!ready) return null;
  return (
    <div id="shot" className="mx-auto max-w-[1240px] px-4 py-5">
      <div className="mb-1 font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">Telefon · Daglig træning · I dag</div>
      <p className="mb-4 max-w-[80ch] text-sm text-cz-2">Den ægte telefonrække fra spillet. Ingen farve og ingen mærker; planen står i samme grå tekst som typen og alderen.</p>
      <div className="grid gap-6 sm:grid-cols-3">
        <div><div className="mb-1.5 font-data text-xs font-semibold text-cz-1">Før (i dag)</div><Rows mode="before" /><p className="mt-2 text-2xs text-cz-2">Man kan ikke se, om rytteren følger en plan.</p></div>
        <div><div className="mb-1.5 font-data text-xs font-semibold text-cz-1">A · Egen linje under navnet (anbefalet)</div><Rows mode="a" /><p className="mt-2 text-2xs text-cz-2">Hele planen kan læses, også "programmet fortsætter i morgen". Rækken bliver lidt højere.</p></div>
        <div><div className="mb-1.5 font-data text-xs font-semibold text-cz-1">B · Kort i samme linje</div><Rows mode="b" /><p className="mt-2 text-2xs text-cz-2">Rækken er lige så lav som i dag. Planen står kort, så detaljen ses først ved tryk.</p></div>
      </div>
      <p className="mt-3 text-2xs text-cz-3">Eksempeldata.</p>
    </div>
  );
}
