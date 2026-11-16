// Indgang for runde 2. Aabnes via vite dev paa
//   /src/preview/sketches/7947/runde2/index.html?v=then|d1|d2|d3|d4&lang=da|en&open=r2
// Ingen app-router, ingen backend, intet login. Standardsprog er dansk, fordi
// billederne er til ejeren.

import { createRoot } from "react-dom/client";
import "../../../../index.css";
import Round2 from "./Round2.tsx";
import type { VariantId } from "./copy2.ts";
import type { Lang } from "../copy.ts";

const IDS: VariantId[] = ["then", "d1", "d2", "d3", "d4"];
const q = new URLSearchParams(window.location.search);
const variant = (IDS.includes(q.get("v") as VariantId) ? q.get("v") : "d1") as VariantId;
const lang: Lang = q.get("lang") === "en" ? "en" : "da";
document.documentElement.lang = lang;
if (q.get("theme") === "dark") document.documentElement.setAttribute("data-theme", "dark");
// shot=1 skjuler skitsens egen navigation, saa billedet kun viser banneret og forslaget.
const shot = q.get("shot") === "1";

const LABELS: Record<VariantId, string> = {
  then: lang === "da" ? "Gammel flade" : "Old page",
  d1: "D1",
  d2: "D2",
  d3: "D3",
  d4: "D4",
};

function Nav() {
  return (
    <nav className="border-b border-cz-border bg-cz-card">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-4 py-2 sm:px-8">
        {IDS.map((v) => (
          <a
            key={v}
            href={`?v=${v}&lang=${lang}`}
            aria-current={v === variant ? "page" : undefined}
            className={`rounded-cz border px-3 py-1.5 text-xs font-medium ${
              v === variant ? "border-cz-accent/50 bg-cz-accent/10 text-cz-accent-t" : "border-cz-border text-cz-2 hover:text-cz-1"
            }`}
          >
            {LABELS[v]}
          </a>
        ))}
      </div>
    </nav>
  );
}

createRoot(document.getElementById("root")!).render(
  <>
    {!shot && <Nav />}
    <Round2 variant={variant} lang={lang} openId={q.get("open")} />
  </>,
);
