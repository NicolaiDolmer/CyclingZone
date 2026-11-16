// Billedarket for #8254: caption brændt ind øverst (punkt, bogstav, navn, én sætning), wireframen
// fra 2/11 til venstre og varianten til højre, med nummererede afvigelser (røde) og noter (blå),
// der peger ind i billedet (TASTE P17). shoot.mjs lægger data i window.__COMPOSE før siden indlæses.
import { createRoot } from "react-dom/client";
import "../../../index.css";

export interface Mark {
  n: number;
  kind: "dev" | "note";
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComposeData {
  mobile: boolean;
  point: number;
  pointName: string;
  letter: string;
  name: string;
  line: string;
  recommended: boolean;
  wireframe: boolean;
  wfNote?: string;
  state: string | null;
  wfSrc: string;
  shotSrc: string;
  shotW: number;
  shotH: number;
  wfW: number;
  wfH: number;
  marks: Mark[];
}

const DEV = "var(--color-cz-danger)";
const NOTE = "var(--color-cz-info)";

function Tag({ children, tone }: { children: string; tone: "gold" | "line" | "plain" }) {
  const cls =
    tone === "gold"
      ? "bg-cz-accent text-cz-on-accent border-cz-accent"
      : tone === "line"
        ? "border-cz-sidebar-1 text-cz-sidebar-1"
        : "border-cz-sidebar-3 text-cz-sidebar-2";
  return <span className={`rounded-cz border px-[.6em] py-[.15em] font-data font-semibold uppercase tracking-[.08em] ${cls}`}>{children}</span>;
}

function Legend({ marks, kind, title, empty }: { marks: Mark[]; kind: Mark["kind"]; title: string; empty?: string }) {
  const seen = new Map<number, string>();
  for (const m of marks) if (m.kind === kind && !seen.has(m.n)) seen.set(m.n, m.text);
  if (!seen.size && !empty) return null;
  return (
    <div>
      <div className="font-data font-semibold uppercase tracking-[.1em] text-cz-sidebar-3" style={{ fontSize: ".72em" }}>
        {title}
      </div>
      {seen.size ? (
        <ol className="m-0 mt-[.3em] list-none p-0">
          {[...seen.entries()].map(([n, text]) => (
            <li key={n} className="mt-[.25em] flex items-start gap-[.5em]">
              <Num n={n} kind={kind} />
              <span>{text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="m-0 mt-[.3em] text-cz-sidebar-2">{empty}</p>
      )}
    </div>
  );
}

function Num({ n, kind, abs }: { n: number; kind: Mark["kind"]; abs?: { left: number; top: number; size: number } }) {
  const size = abs?.size;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[3px] font-data font-bold tabular-nums text-white"
      style={{
        background: kind === "dev" ? DEV : NOTE,
        minWidth: size ?? "1.4em",
        height: size ?? "1.4em",
        fontSize: size ? size * 0.62 : ".85em",
        padding: "0 .3em",
        ...(abs ? { position: "absolute", left: abs.left, top: abs.top, border: "2px solid var(--color-cz-card)" } : {}),
      }}
    >
      {n}
    </span>
  );
}

function Compose({ d }: { d: ComposeData }) {
  const gap = d.mobile ? 24 : 48;
  const pad = d.mobile ? 20 : 48;
  const wfShowW = d.mobile ? 375 : d.wfW;
  const width = pad * 2 + wfShowW + gap + d.shotW;
  const tag = d.mobile ? 22 : 30;
  const devCount = new Set(d.marks.filter((m) => m.kind === "dev").map((m) => m.n)).size;
  const stateText = d.state === "skjult" ? "Profil skjult · valget huskes" : d.state === "vist" ? "Profil vist" : null;
  return (
    <div className="bg-cz-body" style={{ width }}>
      <header className="bg-cz-sidebar text-cz-sidebar-1" style={{ padding: `${d.mobile ? 16 : 36}px ${pad}px`, fontSize: d.mobile ? 14 : 26 }}>
        <div className="flex flex-wrap items-center gap-x-[.7em] gap-y-[.4em]" style={{ fontSize: d.mobile ? 12 : 20 }}>
          <span className="font-data font-semibold uppercase tracking-[.12em] text-cz-sidebar-3">
            Punkt {d.point} · {d.pointName}
          </span>
          {d.recommended && <Tag tone="gold">Anbefalet i PR #8226</Tag>}
          {d.wireframe && <Tag tone="line">{d.wfNote ? `Som wireframen (${d.wfNote})` : "Som wireframen"}</Tag>}
          {stateText && <Tag tone="plain">{stateText}</Tag>}
          <span className="ms-auto font-data tabular-nums text-cz-sidebar-3">{d.mobile ? "390 px" : "1440 px"} · helside</span>
        </div>
        <h1 className="m-0 mt-[.25em] font-bold text-white" style={{ fontSize: d.mobile ? 22 : 46, lineHeight: 1.15 }}>
          {d.letter} · {d.name}
        </h1>
        <p className="m-0 mt-[.3em] text-cz-sidebar-1" style={{ maxWidth: d.mobile ? undefined : 2200 }}>
          {d.line}
        </p>
        <div className={`mt-[1em] grid gap-[1.2em] ${d.mobile ? "grid-cols-1" : "grid-cols-2"}`} style={{ fontSize: d.mobile ? 13 : 22 }}>
          <Legend marks={d.marks} kind="dev" title={`Afvigelser fra wireframen på dette punkt · ${devCount}`} empty="Ingen: punktet står som wireframen." />
          <Legend marks={d.marks} kind="note" title="Noter" />
        </div>
      </header>
      <div className="flex items-start" style={{ padding: pad, gap }}>
        <figure className="m-0 shrink-0" style={{ width: wfShowW }}>
          <figcaption className="mb-2 font-semibold text-cz-1" style={{ fontSize: d.mobile ? 13 : 24 }}>
            Wireframen 2/11 (prototype {d.mobile ? "375" : "1440"})
          </figcaption>
          <img src={d.wfSrc} alt="Wireframe" className="block border border-cz-border" style={{ width: wfShowW }} />
          {d.mobile && (
            <p className="m-0 mt-2 text-cz-2" style={{ fontSize: 12 }}>
              Wireframen har kun listen på mobil; arbejdsfladen til højre følger pc-wireframens rækkefølge.
            </p>
          )}
        </figure>
        <figure className="m-0 shrink-0" style={{ width: d.shotW }}>
          <figcaption className="mb-2 font-semibold text-cz-1" style={{ fontSize: d.mobile ? 13 : 24 }}>
            {d.letter} · {d.name}
            {stateText ? ` · ${stateText.toLowerCase()}` : ""}
          </figcaption>
          <div className="relative border border-cz-border" style={{ width: d.shotW, height: d.shotH }}>
            <img src={d.shotSrc} alt={`Variant ${d.letter}`} className="block" style={{ width: d.shotW, height: d.shotH }} />
            {d.marks.map((m, i) => (
              <span key={i}>
                <span
                  className="absolute"
                  style={{
                    left: m.x - 3,
                    top: m.y - 3,
                    width: m.w + 6,
                    height: m.h + 6,
                    outline: `2px ${m.kind === "dev" ? "solid" : "dashed"} ${m.kind === "dev" ? DEV : NOTE}`,
                    borderRadius: 3,
                  }}
                />
                <Num n={m.n} kind={m.kind} abs={{ left: Math.max(0, m.x - 4), top: m.y - tag - 5 >= 0 ? m.y - tag - 5 : m.y + 2, size: tag }} />
              </span>
            ))}
          </div>
        </figure>
      </div>
    </div>
  );
}

const data = (window as unknown as { __COMPOSE?: ComposeData }).__COMPOSE;
if (data) {
  createRoot(document.getElementById("root")!).render(<Compose d={data} />);
  window.setTimeout(() => {
    document.body.dataset.ready = "1";
  }, 60);
}
