// Indgang for skitsen. Aabnes via vite dev paa
//   /src/preview/sketches/7947/index.html?v=a|b|c&lang=en|da&theme=light|dark&open=r3
// Ingen app-router, ingen backend, intet login.

import { createRoot } from "react-dom/client";
import "../../../index.css";
import Sketch, { type VariantId } from "./Sketch.tsx";
import type { Lang } from "./copy.ts";

const q = new URLSearchParams(window.location.search);
const variant = (["now", "a", "b", "c"].includes(q.get("v") ?? "") ? q.get("v") : "a") as VariantId;
const lang: Lang = q.get("lang") === "da" ? "da" : "en";
document.documentElement.lang = lang;
if (q.get("theme") === "dark") document.documentElement.setAttribute("data-theme", "dark");

function Chrome() {
  const link = (v: string, label: string) => (
    <a
      key={v}
      href={`?v=${v}&lang=${lang}${q.get("theme") ? `&theme=${q.get("theme")}` : ""}`}
      aria-current={v === variant ? "page" : undefined}
      className={`rounded-cz border px-3 py-1.5 text-xs font-medium ${
        v === variant ? "border-cz-accent/50 bg-cz-accent/10 text-cz-accent-t" : "border-cz-border text-cz-2 hover:text-cz-1"
      }`}
    >
      {label}
    </a>
  );
  return (
    <div className="border-b border-cz-border bg-cz-subtle">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-4 py-2 sm:px-8">
        <span className="me-2 font-data text-2xs uppercase tracking-wide text-cz-3">Sketch #7947</span>
        {link("now", "Today")}
        {link("a", "A · two fields")}
        {link("b", "B · matrix")}
        {link("c", "C · effort first")}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <>
    <Chrome />
    <Sketch variant={variant} lang={lang} openId={q.get("open")} />
  </>,
);
