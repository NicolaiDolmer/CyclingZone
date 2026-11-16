// Indgang for valg-skitserne runde 2 (#8254). Åbnes via vite dev på
//   /src/preview/sketches/7535-valg-runde2/index.html?id=4b&state=skjult&w=d|m
// Uden id vises en oversigt. Ingen app-router, ingen backend. Siden tegner kun varianten;
// shoot.mjs lægger caption, wireframen og de nummererede afvigelser omkring den.

import { createRoot } from "react-dom/client";
import "../../../index.css";
import { DesktopPage, MobilePage } from "./Sketch.tsx";
import { POINTS, VARIANTS, configFor, statesFor, variantById, type ProfileState } from "./variants.ts";

const q = new URLSearchParams(window.location.search);
const mobile = q.get("w") === "m";
const variant = variantById(q.get("id"));
const rawState = q.get("state");
const state: ProfileState | null = rawState === "vist" || rawState === "skjult" ? rawState : null;
document.documentElement.lang = "da";

function Index() {
  const points = Object.keys(POINTS).map(Number);
  return (
    <div className="min-h-screen bg-cz-body px-8 py-7">
      <h1 className="m-0 text-[20px] font-bold text-cz-1">#8254 · punkt 4-8 mod wireframen</h1>
      <div className="mt-5 grid gap-3">
        {points.map((p) => (
          <div key={p} className="rounded-cz border border-cz-border bg-cz-card px-4 py-3">
            <div className="text-[15px] font-semibold text-cz-1">
              Punkt {p} · {POINTS[p]}
            </div>
            <ul className="m-0 mt-1 list-none p-0">
              {VARIANTS.filter((v) => v.point === p).flatMap((v) =>
                statesFor(v).map((st) => (
                  <li key={v.id + (st ?? "")} className="mt-1 text-[13px] text-cz-2">
                    <a className="text-cz-1 underline" href={`?id=${v.id}${st ? `&state=${st}` : ""}`}>
                      {v.letter} · {v.name}
                      {st ? ` (profil ${st})` : ""}
                    </a>{" "}
                    <a className="text-cz-3 underline" href={`?id=${v.id}${st ? `&state=${st}` : ""}&w=m`}>
                      mobil
                    </a>
                  </li>
                )),
              )}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
if (variant) {
  const cfg = configFor(variant, state);
  root.render(mobile ? <MobilePage cfg={cfg} /> : <DesktopPage cfg={cfg} />);
  window.setTimeout(() => {
    document.body.dataset.ready = "1";
  }, 60);
} else {
  root.render(<Index />);
}
