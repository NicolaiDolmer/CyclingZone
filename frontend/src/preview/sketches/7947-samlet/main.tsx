// Indgang for #7947 samlet design. Aabnes via vite dev paa
//   /src/preview/sketches/7947-samlet/index.html?v=r1|r2|r3&pressed=1&open=r4:1&shot=1
// Ingen app-router, ingen backend, intet login. Dansk, fordi billederne er til ejeren.

import { createRoot } from "react-dom/client";
import "../../../index.css";
import Sketch from "./Sketch.tsx";

const IDS = ["r1", "r2", "r3"] as const;
type Id = (typeof IDS)[number];
const q = new URLSearchParams(window.location.search);
const raw = q.get("v");
const id: Id = (IDS as readonly string[]).includes(raw ?? "") ? (raw as Id) : "r2";
document.documentElement.lang = "da";
if (q.get("theme") === "dark") document.documentElement.setAttribute("data-theme", "dark");
const shot = q.get("shot") === "1";
const pressed = q.get("pressed") === "1";
const openRaw = q.get("open");
const openDay = openRaw && openRaw.includes(":")
  ? { id: openRaw.split(":")[0], day: Number(openRaw.split(":")[1]) || 0 }
  : null;

const LABELS: Record<Id, string> = { r1: "Retning 1", r2: "Retning 2", r3: "Retning 3" };

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
    <Sketch key={`${id}-${pressed}`} id={id} pressed={pressed} openDay={openDay} />
  </>,
);
