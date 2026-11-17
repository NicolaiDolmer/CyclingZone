// Indgang for #7947 samlet design. Aabnes via vite dev paa
//   /src/preview/sketches/7947-samlet/index.html?v=r1|r2|r3&pressed=1&open=r4:1&shot=1
// Ingen app-router, ingen backend, intet login. Dansk, fordi billederne er til ejeren.

import { createRoot } from "react-dom/client";
import "../../../index.css";
import Sketch from "./Sketch.tsx";
import Direction4 from "./R4.tsx";

const IDS = ["r4", "r1", "r2", "r3"] as const;
type Id = (typeof IDS)[number];
const q = new URLSearchParams(window.location.search);
const raw = q.get("v");
const id: Id = (IDS as readonly string[]).includes(raw ?? "") ? (raw as Id) : "r4";
document.documentElement.lang = "da";
if (q.get("theme") === "dark") document.documentElement.setAttribute("data-theme", "dark");
const shot = q.get("shot") === "1";
const pressed = q.get("pressed") === "1";
const openRaw = q.get("open");
const openDay = openRaw && openRaw.includes(":")
  ? { id: openRaw.split(":")[0], day: Number(openRaw.split(":")[1]) || 0 }
  : null;

const LABELS: Record<Id, string> = { r4: "Retning 4 · samlet (anbefalet)", r1: "Retning 1", r2: "Retning 2", r3: "Retning 3" };
const dateParam = Number(q.get("date") ?? "1");
const mobile = window.innerWidth < 640;

function Banner4() {
  return (
    <header data-testid="sketch-banner" className="border-b-2 border-cz-1 bg-cz-subtle">
      <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-8">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-3">Skitse #7947 · efter kravspec #8301</span>
          <span className="font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">Min anbefaling</span>
        </div>
        <h2 className="mt-1 font-data text-xl font-bold leading-tight text-cz-1 sm:text-2xl">Retning 4 · Hurtigvalg, fem felter og dagspile</h2>
        <p className="mt-1.5 max-w-[920px] text-sm text-cz-1">Pilene øverst skifter dag for hele holdet (i går, i dag og 7 dage frem). Rækkens hovedvalg er et hurtigvalg: Program, Let, Mellem, Hård eller Hvile, og spillet vælger træningerne mod rytterens type. Et tryk på et felt retter kun det felt. Under hvert felt står, hvor passet kommer fra.</p>
        <p className="mt-1.5 font-data text-xs font-semibold tabular-nums text-cz-2">Casual: 1 tryk pr. rytter · nørd: tryk på feltet · programmer: fanen Program · et valg gælder kun den valgte dato</p>
      </div>
    </header>
  );
}

function Nav() {
  return (
    <nav className="border-b border-cz-border bg-cz-card" aria-label="Skitser">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-4 py-2 sm:px-8">
        {IDS.map((v) => (
          <a
            key={v}
            href={`?v=${v}`}
            aria-current={v === id ? "page" : undefined}
            className={`rounded-cz border px-3 py-1.5 text-xs font-medium ${
              v === id ? "border-cz-accent/50 bg-cz-accent/10 text-cz-accent-t" : "border-cz-border text-cz-2 hover:text-cz-1"
            }`}
          >
            {LABELS[v]}
          </a>
        ))}
        <a href={`?v=${id}&pressed=${pressed ? "0" : "1"}`} className="ms-auto text-xs font-medium text-cz-2 hover:text-cz-1">
          {pressed ? "Før Træn nu" : "Efter Træn nu"}
        </a>
      </div>
    </nav>
  );
}

createRoot(document.getElementById("root")!).render(
  <>
    {!shot && <Nav />}
    {id === "r4" ? (
      <div className="min-h-screen bg-cz-body">
        <Banner4 />
        <Direction4 key={`r4-${pressed}-${dateParam}`} pressedAtStart={pressed} dateAtStart={dateParam} mobile={mobile} />
      </div>
    ) : (
      <Sketch key={`${id}-${pressed}`} id={id} pressed={pressed} openDay={openDay} />
    )}
  </>,
);
