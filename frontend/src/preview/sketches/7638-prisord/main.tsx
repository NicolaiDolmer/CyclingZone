// Indgang for prisord-skitsen (#7638). Åbnes via vite dev på
//   /src/preview/sketches/7638-prisord/index.html?id=a|b|c&w=d|m
// Uden id vises en oversigt. Ingen app-router, ingen backend.
import { createRoot } from "react-dom/client";
import "../../../index.css";
import { SketchPage } from "./Sketch.tsx";
import { VARIANTS, variantById } from "./data.ts";

const q = new URLSearchParams(window.location.search);
const mobile = q.get("w") === "m";
const variant = variantById(q.get("id"));
document.documentElement.lang = "da";
if (q.get("theme") === "dark") document.documentElement.dataset.theme = "dark";

function Index() {
  return (
    <main className="min-h-screen bg-cz-body px-4 py-7 sm:px-8">
      <h1 className="m-0 font-data text-[20px] font-bold text-cz-1">Skitse #7638: prisord på alle ordrer</h1>
      <ul className="m-0 mt-5 grid list-none gap-3 p-0">
        {VARIANTS.map((v) => (
          <li key={v.id} className="rounded-cz border border-cz-border bg-cz-card px-4 py-3">
            <a className="text-[15px] font-semibold text-cz-1 underline" href={`?id=${v.id}`}>
              {v.letter}: {v.name}
            </a>{" "}
            <a className="text-xs text-cz-3 underline" href={`?id=${v.id}&w=m`}>
              mobil
            </a>
            <p className="m-0 mt-1 text-xs text-cz-2">{v.line}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(variant ? <SketchPage variant={variant} mobile={mobile} /> : <Index />);
window.setTimeout(() => {
  document.body.dataset.ready = "1";
}, 60);
