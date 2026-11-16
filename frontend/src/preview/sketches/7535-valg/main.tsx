// Indgang for valg-skitserne. Åbnes via vite dev på
//   /src/preview/sketches/7535-valg/index.html?id=1a..8c&w=d|m
// Uden id vises en oversigt med links til alle varianter. Ingen app-router, ingen backend.
// Captionen øverst (punkt, bogstav, navn, én sætning) er en del af billedet, så ejeren kan
// se hvilket billede der er hvad.

import { useEffect, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "../../../index.css";
import { DesktopPage, MobilePage } from "./Sketch.tsx";
import { POINTS, VARIANTS, configFor, variantById, type Variant } from "./variants.ts";

const q = new URLSearchParams(window.location.search);
const mobile = q.get("w") === "m";
const variant = variantById(q.get("id"));
document.documentElement.lang = "da";

function Caption({ v }: { v: Variant }) {
  return (
    <div className={`bg-cz-sidebar text-cz-sidebar-1 ${mobile ? "px-4 py-3" : "px-8 py-3.5"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-data text-xs font-semibold uppercase tracking-[.12em] text-cz-sidebar-3">
          Punkt {v.point} · {POINTS[v.point]}
        </span>
        <span className={`font-semibold text-white ${mobile ? "text-[15px]" : "text-[17px]"}`}>
          {v.letter} · {v.name}
        </span>
        {v.recommended && (
          <span className="rounded-cz bg-cz-accent px-2 py-0.5 font-data text-2xs font-bold uppercase tracking-[.1em] text-cz-on-accent">
            Anbefalet{v.recNote ? ` · ${v.recNote}` : ""}
          </span>
        )}
        {!v.recommended && v.recNote && (
          <span className="rounded-cz border border-cz-accent px-2 py-0.5 font-data text-2xs font-bold uppercase tracking-[.1em] text-cz-accent">{v.recNote}</span>
        )}
        <span className="ms-auto font-data text-2xs tabular-nums text-cz-sidebar-3">{mobile ? "390 px" : "1440 px"}</span>
      </div>
      <p className={`m-0 mt-1 text-cz-sidebar-1 ${mobile ? "text-[12.5px] leading-snug" : "text-[13.5px]"}`}>{v.line}</p>
    </div>
  );
}

function Page({ v }: { v: Variant }) {
  const cap = useRef<HTMLDivElement | null>(null);
  const cfg = configFor(v);
  useLayoutEffect(() => {
    const h = cap.current?.offsetHeight ?? 0;
    document.documentElement.style.setProperty("--cap", `${h}px`);
  });
  useEffect(() => {
    const id = mobile ? cfg.mobileAnchor : cfg.anchor;
    if (!id) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const h = cap.current?.offsetHeight ?? 0;
      // Mobil: app-baren (48) og evt. den klæbende visningsvælger dækker toppen.
      const extra = mobile ? 48 + (cfg.sheet !== "today" && id !== "view-switch" && id !== "sheet-top" ? 52 : 0) : cfg.head !== "today" && id !== "workbench" ? 72 : 12;
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - h - extra);
      document.body.dataset.ready = "1";
    }, 60);
    return () => window.clearTimeout(t);
  });
  useEffect(() => {
    if (!(mobile ? cfg.mobileAnchor : cfg.anchor)) document.body.dataset.ready = "1";
  });
  return (
    <>
      <div ref={cap} className="fixed inset-x-0 top-0 z-50">
        <Caption v={v} />
      </div>
      <div style={{ paddingTop: "var(--cap)" }}>{mobile ? <MobilePage cfg={cfg} /> : <DesktopPage cfg={cfg} />}</div>
    </>
  );
}

function Index() {
  const points = Object.keys(POINTS).map(Number);
  return (
    <div className="min-h-screen bg-cz-body px-8 py-7">
      <h1 className="m-0 text-[20px] font-bold text-cz-1">#7535 · valg pr. punkt</h1>
      <p className="m-0 mt-1 text-[13px] text-cz-2">Planlægningssiden runde 3 (#8216), 8 punkter med 2-3 varianter hver.</p>
      <div className="mt-5 grid gap-3">
        {points.map((p) => (
          <div key={p} className="rounded-cz border border-cz-border bg-cz-card px-4 py-3">
            <div className="text-[15px] font-semibold text-cz-1">
              Punkt {p} · {POINTS[p]}
            </div>
            <ul className="m-0 mt-1 list-none p-0">
              {VARIANTS.filter((v) => v.point === p).map((v) => (
                <li key={v.id} className="mt-1 text-[13px] text-cz-2">
                  <a className="text-cz-accent-t" href={`?id=${v.id}`}>
                    {v.letter} · {v.name}
                  </a>{" "}
                  <a className="text-cz-3" href={`?id=${v.id}&w=m`}>
                    (mobil)
                  </a>
                  {v.recommended && <span className="ms-2 font-data text-2xs uppercase text-cz-accent-t">anbefalet</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(variant ? <Page v={variant} /> : <Index />);
