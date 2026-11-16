// Indgang for skitsen #7535 (faelles taktik-komponent). Aabnes via vite dev paa
//   /src/preview/sketches/taktik-faelles/index.html?v=race|plan&lang=da|en&theme=light|dark&edit=r1&notes=0
// Ingen app-router, ingen backend, intet login. Baandet oeverst er skitsens egen
// etiket (navn og én saetning), saa billederne kan staa alene; det er ikke en
// del af det foreslaaede produkt. Det stiplede omrids viser det faelles panel.

import { createRoot } from "react-dom/client";
import "flag-icons/css/flag-icons.min.css";
import "../../../index.css";
import { COPY, type ViewId } from "./copy.ts";
import type { Lang } from "./data.ts";
import { PlanHost, RaceHost } from "./Hosts.tsx";

const q = new URLSearchParams(window.location.search);
const VIEWS: ViewId[] = ["race", "plan"];
const view: ViewId = q.get("v") === "plan" ? "plan" : "race";
const lang: Lang = q.get("lang") === "en" ? "en" : "da";
const theme = q.get("theme") === "dark" ? "dark" : null;
const edit = q.get("edit");
const notes = q.get("notes") !== "0";
document.documentElement.lang = lang;
if (theme) document.documentElement.setAttribute("data-theme", theme);
document.title = `${COPY[lang].sketch} · ${COPY[lang].views[view].tab}`;

function Label() {
  const c = COPY[lang];
  const v = c.views[view];
  const href = (id: ViewId) => `?v=${id}&lang=${lang}${theme ? `&theme=${theme}` : ""}`;
  return (
    <header className="border-b border-cz-border bg-cz-subtle">
      <div className="mx-auto max-w-[1600px] px-4 py-3 md:px-8">
        <nav aria-label={c.sketch} className="flex flex-wrap items-center gap-2">
          <span className="me-1 font-data text-2xs uppercase tracking-wide text-cz-3">{c.sketch}</span>
          {VIEWS.map((id) => (
            <a
              key={id}
              href={href(id)}
              aria-current={id === view ? "page" : undefined}
              className={`inline-flex min-h-8 items-center rounded-cz border px-2.5 text-xs font-medium ${id === view ? "border-cz-1 text-cz-1" : "border-cz-border text-cz-2 hover:text-cz-1"}`}
            >
              {c.views[id].tab}
            </a>
          ))}
        </nav>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <span className="text-base font-bold text-cz-1">{v.name}</span>
          <span className="font-data text-2xs font-semibold uppercase tracking-wide text-cz-success">{c.recommended}</span>
        </div>
        <p className="m-0 mt-0.5 max-w-[95ch] text-sm text-cz-2">{v.line}</p>
      </div>
    </header>
  );
}

createRoot(document.getElementById("root")!).render(
  <div className="min-h-screen bg-cz-body">
    <Label />
    {view === "plan" ? <PlanHost lang={lang} edit={edit} notes={notes} /> : <RaceHost lang={lang} edit={edit} notes={notes} />}
  </div>,
);
