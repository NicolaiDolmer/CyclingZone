// Indgang for skitsen #5101. Aabnes via vite dev paa
//   /src/preview/sketches/5101/index.html?v=now|a|b|c&lang=da|en&theme=light|dark&open=r1,r2
// Ingen app-router, ingen backend, intet login. Baandet oeverst er skitsens
// egen etiket (variantens navn og én saetning), saa billederne kan staa alene;
// det er ikke en del af det foreslaaede produkt.

import { createRoot } from "react-dom/client";
import "../../../index.css";
import Sketch from "./Sketch.tsx";
import { COPY, type VariantId } from "./copy.ts";
import type { Lang } from "./data.ts";

const q = new URLSearchParams(window.location.search);
const VARIANTS: VariantId[] = ["now", "a", "b", "c"];
const RECOMMENDED: VariantId = "c";
const variant = (VARIANTS.includes(q.get("v") as VariantId) ? q.get("v") : "c") as VariantId;
const lang: Lang = q.get("lang") === "en" ? "en" : "da";
const theme = q.get("theme") === "dark" ? "dark" : null;
const open = (q.get("open") ?? (variant === "c" ? "r2,r5" : "")).split(",").filter(Boolean);
document.documentElement.lang = lang;
if (theme) document.documentElement.setAttribute("data-theme", theme);

function Label() {
  const c = COPY[lang];
  const v = c.variants[variant];
  const link = (id: VariantId) => (
    <a
      key={id}
      href={`?v=${id}&lang=${lang}${theme ? `&theme=${theme}` : ""}`}
      aria-current={id === variant ? "page" : undefined}
      className={`inline-flex min-h-8 items-center rounded-cz border px-2.5 text-xs font-medium ${
        id === variant ? "border-cz-1 text-cz-1" : "border-cz-border text-cz-2 hover:text-cz-1"
      }`}
    >
      {id === "now" ? c.variants.now.name.split(" · ")[0] : id.toUpperCase()}
    </a>
  );
  return (
    <header className="border-b border-cz-border bg-cz-subtle">
      <div className="mx-auto max-w-[1600px] px-4 py-3 md:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="me-1 font-data text-2xs uppercase tracking-wide text-cz-3">{c.sketch}</span>
          {VARIANTS.map(link)}
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <span className="text-base font-bold text-cz-1">{v.name}</span>
          {variant === RECOMMENDED && (
            <span className="font-data text-2xs font-semibold uppercase tracking-wide text-cz-success">{c.recommended}</span>
          )}
        </div>
        <p className="m-0 mt-0.5 max-w-[80ch] text-sm text-cz-2">{v.line}</p>
      </div>
    </header>
  );
}

createRoot(document.getElementById("root")!).render(
  <div className="min-h-screen bg-cz-body">
    <Label />
    <Sketch variant={variant} lang={lang} open={open} />
  </div>,
);
